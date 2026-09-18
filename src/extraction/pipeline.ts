/**
 * The extraction pipeline: existing prose → a World Model seed and a chronological Fabula event
 * list.
 *
 * Issue #117, under the map issue #113. Deliberately stops **before** segmentation into Scene
 * Cards: `scene_cards` comes out empty, and getting world state and the event list right in
 * isolation is the whole scope. #118 and #120 build on what this emits.
 *
 * ## Shape
 *
 * Multi-pass, per `docs/research/narrative-extraction-prior-art.md` §10, and the argument there
 * is the one this file is organised around: the documented failure modes have *mutually
 * incompatible* fixes — GraphRAG's gleaning loop is a recall re-ask, R²'s HAR is a precision
 * refinement — so no single call can be tuned against all of them at once. The passes:
 *
 * | Pass | Reads | Emits |
 * | --- | --- | --- |
 * | 1 `pass-entities` | one window of prose, + a gleaning re-ask | entity/relationship proposals |
 * | 2 `pass-reconcile` | proposals only | canonical rows with slug ids, merge report |
 * | 3 `pass-events` | one window of prose + the entity roster | events, spans, story-time, state updates |
 * | 4 `pass-chronology` | event summaries only | Fabula order |
 * | 5 `pass-seed` | the opening window + earliest events | seed-time attribute values |
 *
 * Passes 2 and 4 never see prose. That is §5's conclusion — read in bounded windows, reconcile
 * globally over the extracted structures — and it is also what keeps every response schema small
 * enough to avoid the `400`-rejectable, uncacheable, `MAX_TOKENS`-unrecoverable single giant
 * schema `docs/research/gemini-capabilities.md` §1 warns about.
 *
 * ## Output
 *
 * Two artifacts, and the split is deliberate.
 *
 * - **`package`** — a plain object valid against `DraftStoryPackageSchema`
 *   (`src/schema/manuscript.ts`), `world_model_seed` populated, `scene_cards` empty, and the
 *   chronological event list carried in a top-level **`_fabula`** block. This is #113's
 *   integration boundary, and its landing path is the existing import escape hatch
 *   (`src/authoring/transfer.ts`, ADR 0017 §6) — not wired up here, and not this ticket's job.
 * - **`sidecar`** — spans, the merge report, the diagnostics and the call log. Spans live here and
 *   **not** on the package, because a span is meaningless without the source text it indexes and
 *   the Story Package schema has no field for one. §8 anticipates exactly this ("it implies an
 *   extraction-only field the Story Package does not currently have") and #113 is explicit that a
 *   schema gap is an ADR discussion, not something to bend around — so nothing here invents a
 *   field on the shared schema.
 *
 * ## Convergence with #119
 *
 * #119 (the original-arc generator) hit the identical problem from the other side — a Fabula-only
 * deliverable with nowhere to put the event list — and answered it with `FABULA_BLOCK` in
 * `src/arc/fabula.ts`. This module **reuses that constant and its field names** rather than
 * inventing a second shape, so #118's segmentation and #120's shared-segmentation proof see one
 * object from both entry points. `_fabula`'s own carrier argument is #119's and holds here too:
 * `DraftStoryPackageSchema` is a `looseObject` precisely so a package can carry blocks the schema
 * has not heard of (both fixtures carry `_authoring_conventions` this way), and `transfer.ts`
 * reports them as `extra_blocks` rather than dropping them.
 *
 * Where the two shapes differ, they differ because extraction genuinely cannot fill a field — and
 * those are the interesting rows for the ADR, so they are listed on the block itself as
 * `fields_not_recovered` rather than filled with a plausible guess. See `fabulaBlock` below.
 */

import { FABULA_BLOCK } from '../schema/fabula';
import { DraftStoryPackageSchema, type DraftStoryPackage } from '../schema/manuscript';
import type { ModelClient } from '../writer/model-client';
import { ExtractionModel, type CallRecord } from './call';
import { extractEntities, type EntityPassResult } from './pass-entities';
import {
  dedupeBySpan,
  extractEvents,
  type ExtractedEvent,
  type StoryTime,
} from './pass-events';
import {
  canonicalize,
  redirectRelationships,
  type CanonicalizeResult,
} from './pass-canonicalize';
import { orderChronologically, type ChronologyResult } from './pass-chronology';
import { extractSeedState, type SeedRow } from './pass-seed';
import { reconcile, type MergeGroup, type ReconcileResult } from './pass-reconcile';
import {
  groundingReport,
  resolveQuote,
  type GroundingReport,
  type SourceSpan,
  type SpanClaim,
} from './spans';
import type { LoadedSource } from './sources';
import { DEFAULT_WINDOW_OPTIONS, windowsOf, type ReadingWindow, type WindowOptions } from './windows';

export interface SidecarEvent {
  readonly id: string;
  readonly summary: string;
  readonly story_time: StoryTime;
  readonly time_anchor: string;
  readonly participants: readonly string[];
  readonly location_id: string | null;
  /** Position in the Fabula order this pipeline produced. */
  readonly chronological_index: number;
  /** Position in the order the source narrates. */
  readonly narrated_index: number;
  readonly window: number;
  readonly span: SourceSpan | null;
  readonly quote: string;
  readonly state_updates: ReadonlyArray<{
    readonly entity_id: string;
    readonly column: string;
    readonly value: string | number | boolean | null;
    readonly quote: string;
    readonly span: SourceSpan | null;
  }>;
}

export interface ExtractionSidecar {
  readonly source: {
    readonly id: string;
    readonly title: string;
    readonly edition: string;
    readonly url: string;
    readonly lines: string;
    readonly words: number;
    readonly sha256: string;
  };
  readonly windows: ReadonlyArray<{ index: number; start: number; end: number; words: number }>;
  readonly entity_spans: ReadonlyArray<{ id: string; quote: string; span: SourceSpan | null }>;
  readonly relationship_spans: ReadonlyArray<{ id: string; quote: string; span: SourceSpan | null }>;
  readonly seed_attribute_spans: ReadonlyArray<{
    entity_id: string;
    columns: readonly string[];
    quote: string;
    span: SourceSpan | null;
  }>;
  /** The chronological Fabula event list — the ticket's second deliverable. */
  readonly events: readonly SidecarEvent[];
  readonly grounding: GroundingReport;
  readonly claims: readonly SpanClaim[];
  readonly diagnostics: ExtractionDiagnostics;
  readonly provenance: ExtractionProvenance;
}

export interface ExtractionDiagnostics {
  readonly windows: number;
  readonly entity_proposals: number;
  readonly gleaned_entities: number;
  readonly gleaned_relationships: number;
  readonly failed_entity_windows: readonly number[];
  readonly failed_event_windows: readonly number[];
  readonly failed_reconcile_batches: number;
  readonly failed_seed_batches: number;
  readonly merges: readonly MergeGroup[];
  readonly suspicious_merges: readonly MergeGroup[];
  /**
   * What pass 3b actually merged, and what it refused (#143).
   *
   * **`canonical_blocked` is normally empty, and that is correct** — an earlier version of this
   * comment said an empty list "deserves suspicion", which was wrong. The guard does its work
   * upstream in `mergeCandidates`, which never offers a co-occurring pair in the first place; a
   * block can only register when the model returns a merge for a pair it was not shown. So the
   * measured shape — 37 merges over 331 rows with zero blocks — is the expected one, and the
   * evidence the guard is working is in `canonical_candidate_pairs` being far smaller than every
   * same-kind pair, not in this list.
   */
  readonly canonical_merges: ReadonlyArray<{ kept: string; absorbed: readonly string[]; why: string }>;
  readonly canonical_blocked: ReadonlyArray<{ keep: string; absorb: string; reason: string }>;
  readonly canonical_candidate_pairs: number;
  readonly canonical_failed: boolean;
  readonly dropped_proposals: readonly string[];
  readonly dropped_state_updates: number;
  readonly dropped_participants: number;
  /**
   * What each window reported the narrative frame to be at its end (#145).
   *
   * Reported rather than logged because a wrong `story_time` bucket has two possible causes — the
   * frame never reached the window, or it reached it and was ignored — and nothing else in the
   * output distinguishes them. Windows with an empty frame are the story's ordinary present.
   */
  readonly event_frames: ReadonlyArray<{ window: number; frame: string }>;
  /**
   * `state_updates` written against an obj_ row (#154).
   *
   * Zero on both realist fixtures before #154, which is what made objects orphaned: participants
   * is characters-only and location_id is a place, so a state_update is the only way an object can
   * take part in an event at all. A run that extracts object rows and reports 0 here has produced
   * a World Model table nothing downstream consumes.
   */
  readonly object_state_updates: number;
  readonly duplicate_events_removed: number;
  readonly chronology_fallback_buckets: readonly StoryTime[];
  readonly chronology_repaired_ids: number;
  readonly chronology_rejected_ids: number;
}

export interface ExtractionProvenance {
  readonly requested_model: string;
  /** Every model that actually answered. A capacity swap makes these differ. */
  readonly models_used: readonly string[];
  readonly calls: readonly CallRecord[];
  readonly call_count: number;
  readonly cost_usd: number;
  readonly started_at: string;
  readonly finished_at: string;
  readonly window_options: WindowOptions;
  readonly max_gleanings: number;
}

export interface ExtractionResult {
  readonly package: DraftStoryPackage;
  readonly sidecar: ExtractionSidecar;
}

export interface ExtractOptions {
  readonly windowOptions?: WindowOptions;
  readonly maxGleanings?: number;
  readonly onProgress?: (message: string) => void;
}

export async function extractStoryPackage(
  source: LoadedSource,
  client: ModelClient,
  model: string,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const startedAt = new Date().toISOString();
  const windowOptions = options.windowOptions ?? DEFAULT_WINDOW_OPTIONS;
  const maxGleanings = options.maxGleanings ?? 1;
  const progress = options.onProgress ?? ((): void => {});

  const extraction = new ExtractionModel(client, model);
  const windows = windowsOf(source.text, windowOptions);
  progress(`${windows.length} windows over ${source.words} words`);

  progress('pass 1/5 — entities and relationships, per window (+ gleaning)');
  const proposals: EntityPassResult = await extractEntities(extraction, windows, { maxGleanings });

  progress(`pass 2/5 — reconcile ${proposals.entities.length} entity proposals`);
  const reconciled: ReconcileResult = await reconcile(
    extraction,
    proposals.entities,
    proposals.relationships,
  );

  progress(`pass 3/5 — events, per window (${reconciled.entities.length} entities in roster)`);
  const eventPass = await extractEvents(extraction, windows, reconciled.entities);

  const windowOf = (index: number): ReadingWindow | undefined => windows[index];
  const eventSpans = new Map<string, SourceSpan | null>();
  for (const event of eventPass.events) {
    eventSpans.set(event.id, resolveQuote(source.text, event.quote, windowOf(event.window)));
  }
  const deduped = dedupeBySpan(eventPass.events, (event) => eventSpans.get(event.id) ?? null);
  progress(
    `      ${deduped.kept.length} events (${deduped.removed.length} duplicates at window seams removed)`,
  );

  progress(`pass 3b/5 — canonicalize ${reconciled.entities.length} rows against event co-occurrence`);
  const canonical: CanonicalizeResult = await canonicalize(extraction, reconciled.entities, deduped.kept);
  if (canonical.applied.length > 0) {
    progress(
      `      ${canonical.applied.length} merges, ${canonical.entities.length} rows remain ` +
        `(${canonical.blocked.length} refused by the co-occurrence guard)`,
    );
  }

  progress('pass 4/5 — chronological ordering');
  const chronology: ChronologyResult = await orderChronologically(extraction, canonical.events);
  const chronologicalIndex = new Map(chronology.order.map((id, index) => [id, index]));
  const byId = new Map(canonical.events.map((event) => [event.id, event]));
  const orderedEvents = chronology.order
    .map((id) => byId.get(id))
    .filter((event): event is ExtractedEvent => event !== undefined);

  progress('pass 5/5 — seed-time world state');
  const opening = windows[0]?.text ?? source.text.slice(0, 8000);
  const seed = await extractSeedState(
    extraction,
    canonical.entities,
    opening,
    orderedEvents,
  );

  const finishedAt = new Date().toISOString();

  // --- Assemble -------------------------------------------------------------------------

  const seedById = new Map(seed.rows.map((row) => [row.id, row]));
  const claims: SpanClaim[] = [];

  const firstProposalQuote = new Map<string, string>();
  for (const entity of canonical.entities) {
    const names = new Set(entity.merged_from.map((name) => name.toLowerCase()));
    names.add(entity.name.toLowerCase());
    const match = proposals.entities.find(
      (proposal) => names.has(proposal.name.toLowerCase()) && proposal.quote !== '',
    );
    firstProposalQuote.set(entity.id, match?.quote ?? '');
  }

  const entitySpans = canonical.entities.map((entity) => {
    const quote = firstProposalQuote.get(entity.id) ?? '';
    const span = quote === '' ? null : resolveQuote(source.text, quote);
    claims.push({
      subject: `${entity.kind}:${entity.id}`,
      claim: `${entity.name} exists in this story as a ${entity.kind}`,
      quote,
      span,
    });
    return { id: entity.id, quote, span };
  });

  // Through the merge map first (#143): an edge naming a row pass 3b absorbed would otherwise
  // point at an id the seed no longer carries, which is an `unknown_entity` G0 error.
  const relationships = redirectRelationships(reconciled.relationships, canonical.redirect).map(
    (edge, index) => ({
      ...edge,
      id: `rel_${String(index + 1).padStart(3, '0')}`,
    }),
  );

  const relationshipSpans = relationships.map((edge) => {
    const proposal = proposals.relationships[edge.from_proposal];
    const quote = proposal?.quote ?? '';
    const span =
      quote === ''
        ? null
        : resolveQuote(source.text, quote, proposal === undefined ? undefined : windowOf(proposal.window));
    claims.push({
      subject: `relationship:${edge.id}`,
      claim: `${edge.from_id} ${edge.kind} ${edge.to_id}`,
      quote,
      span,
    });
    return { id: edge.id, quote, span };
  });

  const seedAttributeSpans = seed.rows.map((row) => {
    const columns = describedColumns(row);
    const span = row.quote === '' ? null : resolveQuote(source.text, row.quote, windows[0]);
    if (columns.length > 0) {
      claims.push({
        subject: `seed:${row.id}`,
        claim: `at the story's start, ${row.id} has ${columns.join(', ')}`,
        quote: row.quote,
        span,
      });
    }
    return { entity_id: row.id, columns, quote: row.quote, span };
  });

  const sidecarEvents: SidecarEvent[] = orderedEvents.map((event) => {
    const span = eventSpans.get(event.id) ?? null;
    claims.push({
      subject: `event:${event.id}`,
      claim: event.summary,
      quote: event.quote,
      span,
    });
    const updates = event.state_updates.map((update) => {
      const updateSpan =
        update.quote === ''
          ? null
          : resolveQuote(source.text, update.quote, windowOf(event.window));
      claims.push({
        subject: `state_update:${event.id}:${update.entity_id}.${update.column}`,
        claim: `${update.entity_id}.${update.column} becomes ${JSON.stringify(update.value)}`,
        quote: update.quote,
        span: updateSpan,
      });
      return { ...update, span: updateSpan };
    });
    return {
      id: event.id,
      summary: event.summary,
      story_time: event.story_time,
      time_anchor: event.time_anchor,
      participants: event.participants,
      location_id: event.location_id,
      chronological_index: chronologicalIndex.get(event.id) ?? 0,
      narrated_index: event.narrated_index,
      window: event.window,
      span,
      quote: event.quote,
      state_updates: updates,
    };
  });

  const sidecarSource: ExtractionSidecar['source'] = {
    id: source.manifest.id,
    title: source.manifest.title,
    edition: source.manifest.edition,
    url: source.manifest.url,
    lines: `${source.manifest.first_line}\u2013${source.manifest.last_line}`,
    words: source.words,
    sha256: source.sha256,
  };

  const provenance: ExtractionProvenance = {
    requested_model: model,
    models_used: extraction.modelsUsed,
    calls: extraction.calls,
    call_count: extraction.calls.length,
    cost_usd: extraction.costUsd,
    started_at: startedAt,
    finished_at: finishedAt,
    window_options: windowOptions,
    max_gleanings: maxGleanings,
  };

  const draft = DraftStoryPackageSchema.parse({
    schema_version: '1.0',
    package_version: 1,
    story_id: source.manifest.id,
    world_model_seed: {
      characters: canonical.entities
        .filter((entity) => entity.kind === 'character')
        .map((entity) => ({
          id: entity.id,
          name: entity.name,
          location_id: seedById.get(entity.id)?.location_id ?? null,
          status: seedById.get(entity.id)?.status ?? null,
          goal: seedById.get(entity.id)?.goal ?? null,
          bag: bagOf(seedById.get(entity.id)),
        })),
      locations: canonical.entities
        .filter((entity) => entity.kind === 'location')
        .map((entity) => ({
          id: entity.id,
          name: entity.name,
          bag: bagOf(seedById.get(entity.id)),
        })),
      objects: canonical.entities
        .filter((entity) => entity.kind === 'object')
        .map((entity) => ({
          id: entity.id,
          name: entity.name,
          location_id: seedById.get(entity.id)?.location_id ?? null,
          status: seedById.get(entity.id)?.status ?? null,
          bag: bagOf(seedById.get(entity.id)),
        })),
      relationships: relationships.map((edge) => ({
        id: edge.id,
        from_id: edge.from_id,
        to_id: edge.to_id,
        kind: edge.kind,
        sentiment: edge.sentiment,
        bag: {},
      })),
      // Empty on purpose: `character_knowledge` is Discourse-Record-adjacent and §4 of the
      // research is unambiguous that nothing in the literature recovers reader- or
      // character-knowledge from prose. Populating it would be invention dressed as extraction.
      character_knowledge: [],
    },
    // Empty at this stage — segmentation is #118, and #113's boundary says this pipeline stops
    // before it.
    scene_cards: [],
    voice_card: {},
    metadata: {
      title: source.manifest.title,
      source: `${source.manifest.edition} — ${source.manifest.url}`,
      created_at: startedAt,
    },
    // The chronological Fabula event list, in #119's block and #119's field names.
    [FABULA_BLOCK]: fabulaBlock(sidecarEvents, provenance, sidecarSource),
  }) as DraftStoryPackage;

  return {
    package: draft,
    sidecar: {
      source: sidecarSource,
      windows: windows.map((window) => ({
        index: window.index,
        start: window.start,
        end: window.end,
        words: window.words,
      })),
      entity_spans: entitySpans,
      relationship_spans: relationshipSpans,
      seed_attribute_spans: seedAttributeSpans,
      events: sidecarEvents,
      grounding: groundingReport(claims),
      claims,
      diagnostics: {
        windows: windows.length,
        entity_proposals: proposals.entities.length,
        gleaned_entities: proposals.gleaned_entities,
        gleaned_relationships: proposals.gleaned_relationships,
        failed_entity_windows: proposals.failed_windows,
        failed_event_windows: eventPass.failed_windows,
        failed_reconcile_batches: reconciled.failed_batches,
        failed_seed_batches: seed.failed_batches,
        merges: reconciled.merges,
        suspicious_merges: reconciled.suspicious_merges,
        dropped_proposals: reconciled.dropped_proposals,
        canonical_merges: canonical.applied,
        canonical_blocked: canonical.blocked,
        canonical_candidate_pairs: canonical.candidate_pairs,
        canonical_failed: canonical.failed,
        dropped_state_updates: eventPass.dropped_state_updates,
        dropped_participants: eventPass.dropped_participants,
        event_frames: eventPass.frames,
        object_state_updates: eventPass.object_state_updates,
        duplicate_events_removed: deduped.removed.length,
        chronology_fallback_buckets: chronology.fallback_buckets,
        chronology_repaired_ids: chronology.repaired_ids,
        chronology_rejected_ids: chronology.rejected_ids,
      },
      provenance,
    },
  };
}

/**
 * The five `FabulaEvent` fields #119 requires that extraction cannot fill, and why.
 *
 * Stated as data on the emitted block, not as prose in a report nobody re-reads. Every one of
 * them is a **Syuzhet-layer** field: a generator inventing an arc chooses the POV and the
 * dramatic function as part of inventing it, and decides what the reader learns when. An
 * extractor reading someone else's prose cannot recover any of them before segmentation —
 * `pov` and `dramatic_function` are properties of a *scene*, which does not exist until #118
 * draws the boundaries, and `reveals`/`conceals` are the told-ledger, which
 * `narrative-extraction-prior-art.md` §4 establishes has no extraction method at all (§4.7:
 * "the told-ledger cannot be extracted; it has to be derived" — from Scene Cards that, again,
 * do not exist yet). `caused_by` is the one that is merely not-yet-attempted rather than
 * structurally unavailable.
 *
 * The honest reading, and the reason this list is worth an ADR rather than a patch: **#119's
 * `FabulaEvent` is not a Fabula-only shape.** It carries Syuzhet fields because a generator
 * produces Fabula and Syuzhet in one act. Extraction cannot, so the two entry points converge on
 * the block and diverge on its required fields.
 */
export const FIELDS_NOT_RECOVERED: Readonly<Record<string, string>> = {
  pov: 'a property of a scene; no scene boundaries exist before #118',
  dramatic_function: 'same — a scene-level judgment, not an event-level fact',
  reveals:
    'told-ledger; research §4.7 — derived from Scene Cards, never extracted from prose',
  conceals: 'told-ledger, same reason; the Syuzhet-critical field with no prior art at all',
  caused_by: 'not attempted at this stage; causal-graph extraction is a pass this ticket does not run',
};

/**
 * The event list as it rides in the deliverable, in #119's field names.
 *
 * `state_changes` narrows to `string | null` to match `StateChangeSchema` exactly, with the
 * unnarrowed value kept in the sidecar. `beats` is the event's own summary as a single beat:
 * these events are already at roughly `required_beats` grain, and wrapping the summary is honest
 * where inventing a beat list would not be.
 */
export function fabulaBlock(
  events: readonly SidecarEvent[],
  provenance: ExtractionProvenance,
  source: ExtractionSidecar['source'],
): Record<string, unknown> {
  return {
    generator: 'extraction pipeline (#117)',
    model: provenance.models_used.join(', '),
    generated_at: provenance.finished_at,
    source: { id: source.id, edition: source.edition, sha256: source.sha256 },
    fields_not_recovered: FIELDS_NOT_RECOVERED,
    events: events.map((event, index) => ({
      id: event.id,
      sequence: index + 1,
      summary: event.summary,
      location_id: event.location_id,
      characters_present: event.participants,
      beats: [event.summary],
      pays_off: [],
      state_changes: event.state_updates.map((update) => ({
        entity_id: update.entity_id,
        column: update.column,
        value: typeof update.value === 'string' || update.value === null ? update.value : String(update.value),
      })),
      // Extraction-only, additive to #119's shape: the Fabula/Syuzhet offset this pipeline
      // actually measured, and the span that grounds the event.
      story_time: event.story_time,
      time_anchor: event.time_anchor,
      narrated_index: event.narrated_index,
      source_span:
        event.span === null
          ? null
          : { start: event.span.start, end: event.span.end, resolution: event.span.resolution },
    })),
  };
}

function describedColumns(row: SeedRow): string[] {
  const columns: string[] = [];
  if (row.location_id !== null) columns.push(`location_id=${row.location_id}`);
  if (row.status !== null) columns.push(`status=${row.status}`);
  if (row.goal !== null) columns.push(`goal=${row.goal}`);
  for (const entry of row.bag) columns.push(`${entry.key}=${entry.value}`);
  return columns;
}

/** The bag arrives as a key/value array (a map is awkward in a response schema) and lands flat. */
function bagOf(row: SeedRow | undefined): Record<string, string> {
  if (row === undefined) return {};
  const bag: Record<string, string> = {};
  for (const entry of row.bag) bag[entry.key] = entry.value;
  return bag;
}
