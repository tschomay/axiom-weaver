/**
 * Rubric §3, computed over one extraction run.
 *
 * Cites `docs/agents/story-authoring-eval.md`; does not restate its bars beyond carrying them
 * next to the numbers, per §5 ("Cite this file and name the sections you scored against. Don't
 * restate the bars."). **No composite score is produced**, deliberately — §3's opening sentence
 * and §5 both forbid one, because the failure modes have different costs and a mean hides which
 * one fired.
 *
 * Order matters here and follows the ticket: span grounding is computed first and reported first,
 * because it needs no ground truth and no judge and it is what separates "read the source" from
 * "produced plausible-looking output". Everything after it assumes it.
 *
 * §3.4 (segmentation), §3.5 (reveal order) and §3.6 (plant/payoff) are **not scored**. They are
 * defined over Scene Cards, this pipeline stops before segmentation by design (#113's boundary,
 * #118's ticket), and a number computed over an empty `scene_cards` array would be a zero that
 * means "not attempted" while looking like a zero that means "failed". They are reported as
 * out-of-scope with that reason attached.
 */

import type { ExtractionModel } from '../call';
import type { ExtractionResult } from '../pipeline';
import type { LoadedSource } from '../sources';
import { gateG0, type G0Report } from './gates';
import { loadGroundTruth, narratedOutOfOrder, type GroundTruth } from './ground-truth';
import {
  contextAround,
  judgeAlignment,
  judgeEventEntailment,
  judgeSeedAttributes,
  judgeSpanSupport,
  type AttributeItem,
  type AttributeJudgment,
  type SupportItem,
  type SupportJudgment,
} from './judge';

export interface SpanGroundingScore {
  readonly bar: string;
  readonly claims: number;
  readonly resolved_exact: number;
  readonly resolved_normalized: number;
  readonly unresolved: number;
  /** Fraction of claims whose quote was actually found in the source. */
  readonly quote_resolution_rate: number;
  readonly judged: number;
  readonly supports: number;
  readonly insufficient: number;
  readonly contradicts: number;
  readonly unjudged: number;
  /** Fraction of judged claims whose span actually supports them. */
  readonly support_rate: number;
  readonly worst: ReadonlyArray<{ subject: string; verdict: string; why: string }>;
}

export interface TableScore {
  readonly table: string;
  readonly fixture_rows: number;
  readonly candidate_rows: number;
  readonly aligned: number;
  readonly recall: number;
  readonly precision: number;
  readonly misses: readonly string[];
  readonly inventions: readonly string[];
}

export interface SeedAttributeScore {
  readonly judged: number;
  readonly supported_at_start: number;
  readonly seed_time_errors: number;
  readonly contradicted: number;
  readonly insufficient: number;
  readonly unjudged: number;
  readonly contradiction_rate: number;
  readonly examples: readonly AttributeJudgment[];
}

export interface EventScore {
  readonly ground_truth_events: number;
  readonly candidate_events: number;
  readonly matched: number;
  readonly recall: number;
  readonly missed: readonly string[];
  readonly pairwise_total: number;
  readonly pairwise_correct: number;
  readonly pairwise_accuracy: number;
  readonly high_confidence_total: number;
  readonly high_confidence_correct: number;
  readonly high_confidence_accuracy: number;
  readonly out_of_order_total: number;
  readonly out_of_order_correct: number;
  readonly out_of_order_accuracy: number | null;
  readonly fabricated: number;
  readonly fabricated_examples: readonly string[];
}

export interface AlignmentFile {
  readonly method: string;
  readonly rows: ReadonlyArray<{
    table: string;
    fixture_id: string;
    fixture_name: string;
    candidate_id: string | null;
    candidate_name: string | null;
    how: 'exact_name' | 'judged' | 'unaligned';
    why: string;
  }>;
  readonly events: ReadonlyArray<{ truth_id: string; truth_text: string; candidate_id: string | null }>;
}

export interface ScoreReport {
  readonly story_id: string;
  readonly scored_at: string;
  readonly source: ExtractionResult['sidecar']['source'];
  readonly fixture_package_version: number;
  readonly extractor_models: readonly string[];
  readonly judge_model: string;
  readonly g0: G0Report;
  readonly span_grounding: SpanGroundingScore;
  readonly world_model: {
    readonly tables: readonly TableScore[];
    readonly relationship_recall: number;
    readonly relationship_matched: number;
    readonly relationship_fixture_rows: number;
    readonly relationship_candidate_rows: number;
    readonly seed_attributes: SeedAttributeScore;
  };
  readonly events: EventScore;
  readonly not_scored: ReadonlyArray<{ section: string; reason: string }>;
  readonly alignment: AlignmentFile;
  readonly judge_cost_usd: number;
  readonly judge_calls: number;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface ScoreOptions {
  /** Cap on span-support judgments, so a 28k-word source does not spend hundreds of calls. */
  readonly supportSampleSize?: number;
  readonly repoRoot?: string;
  readonly onProgress?: (message: string) => void;
}

export async function scoreExtraction(
  result: ExtractionResult,
  source: LoadedSource,
  judge: ExtractionModel,
  options: ScoreOptions = {},
): Promise<ScoreReport> {
  const progress = options.onProgress ?? ((): void => {});
  const truth: GroundTruth = await loadGroundTruth(source.manifest.id, options.repoRoot);
  const judgeCallsBefore = judge.calls.length;
  const judgeCostBefore = judge.costUsd;

  progress('G0 — lint gate');
  const g0 = gateG0(result.package);

  progress('§3.2 first — span grounding');
  const spanGrounding = await scoreSpanGrounding(result, source, judge, options);

  progress('§3.1 — alignment');
  const alignmentRows: Array<AlignmentFile['rows'][number]> = [];
  const seed = result.package.world_model_seed;
  const candidateByTable = {
    characters: seed.characters.map((row) => ({ id: row.id, name: row.name, note: '' })),
    locations: seed.locations.map((row) => ({ id: row.id, name: row.name, note: '' })),
    objects: seed.objects.map((row) => ({ id: row.id, name: row.name, note: '' })),
  };
  const fixtureSeed = truth.package.world_model_seed;
  const fixtureByTable = {
    characters: fixtureSeed.characters.map((row) => ({ id: row.id, name: row.name, note: '' })),
    locations: fixtureSeed.locations.map((row) => ({ id: row.id, name: row.name, note: '' })),
    objects: fixtureSeed.objects.map((row) => ({ id: row.id, name: row.name, note: '' })),
  };

  const tables: TableScore[] = [];
  const alignedByFixtureId = new Map<string, string>();

  for (const table of ['characters', 'locations', 'objects'] as const) {
    const fixtureRows = fixtureByTable[table];
    const candidateRows = candidateByTable[table];

    // §3.1 step 1: exact, case/punctuation-normalized name match, taken before any judgment.
    const candidateByName = new Map<string, string>();
    for (const row of candidateRows) {
      const key = normalizeName(row.name);
      if (!candidateByName.has(key)) candidateByName.set(key, row.id);
    }
    const used = new Set<string>();
    const pending: typeof fixtureRows = [];

    for (const row of fixtureRows) {
      const exact = candidateByName.get(normalizeName(row.name));
      if (exact !== undefined && !used.has(exact)) {
        used.add(exact);
        alignedByFixtureId.set(row.id, exact);
        alignmentRows.push({
          table,
          fixture_id: row.id,
          fixture_name: row.name,
          candidate_id: exact,
          candidate_name: candidateRows.find((c) => c.id === exact)?.name ?? null,
          how: 'exact_name',
          why: 'normalized name match',
        });
        continue;
      }
      pending.push(row);
    }

    // §3.1 step 2: everything else goes to the judge, and the decision is recorded.
    const remaining = candidateRows.filter((row) => !used.has(row.id));
    const judged = await judgeAlignment(judge, table, pending, remaining);
    for (const pair of judged) {
      const fixtureRow = pending.find((row) => row.id === pair.fixture_id);
      if (pair.candidate_id !== null) {
        used.add(pair.candidate_id);
        alignedByFixtureId.set(pair.fixture_id, pair.candidate_id);
      }
      alignmentRows.push({
        table,
        fixture_id: pair.fixture_id,
        fixture_name: fixtureRow?.name ?? '',
        candidate_id: pair.candidate_id,
        candidate_name:
          pair.candidate_id === null
            ? null
            : (candidateRows.find((row) => row.id === pair.candidate_id)?.name ?? null),
        how: pair.candidate_id === null ? 'unaligned' : 'judged',
        why: pair.why,
      });
    }

    const aligned = fixtureRows.filter((row) => alignedByFixtureId.has(row.id)).length;
    tables.push({
      table,
      fixture_rows: fixtureRows.length,
      candidate_rows: candidateRows.length,
      aligned,
      recall: fixtureRows.length === 0 ? 1 : aligned / fixtureRows.length,
      precision: candidateRows.length === 0 ? 0 : aligned / candidateRows.length,
      misses: fixtureRows.filter((row) => !alignedByFixtureId.has(row.id)).map((row) => row.name),
      inventions: candidateRows.filter((row) => !used.has(row.id)).map((row) => row.name),
    });
  }

  progress('§3.2 — relationships');
  const candidateEdges = new Set(
    seed.relationships.map((edge) => `${edge.from_id}|${edge.to_id}|${normalizeName(edge.kind ?? '')}`),
  );
  const candidateEdgesUntyped = new Set(
    seed.relationships.map((edge) => `${edge.from_id}|${edge.to_id}`),
  );
  let relationshipMatched = 0;
  for (const edge of fixtureSeed.relationships) {
    const from = alignedByFixtureId.get(edge.from_id);
    const to = alignedByFixtureId.get(edge.to_id);
    if (from === undefined || to === undefined) continue;
    // Triple match on `{from_id, to_id, kind}` per §3.2, with a relaxed fallback on the pair
    // alone: `stepmother_of` vs `step_mother_of` is the "different valid framing" case §2 says
    // not to score as a miss, and kind slugs are free text in the schema.
    if (
      candidateEdges.has(`${from}|${to}|${normalizeName(edge.kind)}`) ||
      candidateEdgesUntyped.has(`${from}|${to}`)
    ) {
      relationshipMatched += 1;
    }
  }

  progress('§3.2 — seed attributes');
  const seedAttributes = await scoreSeedAttributes(result, source, judge, alignedByFixtureId);

  progress('§3.3 — event recall and chronology');
  const events = await scoreEvents(result, truth, judge, spanGrounding);

  const eventAlignment = [...events.matches].map(([truthId, candidateId]) => ({
    truth_id: truthId,
    truth_text: truth.events.find((event) => event.id === truthId)?.text ?? '',
    candidate_id: candidateId,
  }));

  return {
    story_id: source.manifest.id,
    scored_at: new Date().toISOString(),
    source: result.sidecar.source,
    fixture_package_version: truth.package_version,
    extractor_models: result.sidecar.provenance.models_used,
    judge_model: judge.model,
    g0,
    span_grounding: spanGrounding,
    world_model: {
      tables,
      relationship_recall:
        fixtureSeed.relationships.length === 0
          ? 1
          : relationshipMatched / fixtureSeed.relationships.length,
      relationship_matched: relationshipMatched,
      relationship_fixture_rows: fixtureSeed.relationships.length,
      relationship_candidate_rows: seed.relationships.length,
      seed_attributes: seedAttributes,
    },
    events: events.score,
    not_scored: [
      {
        section: '§3.4 Scene segmentation',
        reason:
          'this pipeline stops before segmentation by design (#113 boundary; #118 owns it), so ' +
          'scene_cards is empty and every §3.4 metric has an empty denominator',
      },
      {
        section: '§3.5 Reveal order',
        reason:
          'reader_must_learn / must_stay_hidden are Scene Card fields; §4.7 of the research is ' +
          'explicit that the told-ledger is derived from those, not extracted from prose',
      },
      {
        section: '§3.6 Plant/payoff graph',
        reason: 'pays_off names scene ids, and no Scene Card exists at this stage',
      },
    ],
    alignment: {
      method:
        '§3.1: exact case/punctuation-normalized name match first, then a judged pass over the ' +
        `remainder using ${judge.model}. One candidate row is never given to two fixture rows.`,
      rows: alignmentRows,
      events: eventAlignment,
    },
    judge_cost_usd: judge.costUsd - judgeCostBefore,
    judge_calls: judge.calls.length - judgeCallsBefore,
  };
}

async function scoreSpanGrounding(
  result: ExtractionResult,
  source: LoadedSource,
  judge: ExtractionModel,
  options: ScoreOptions,
): Promise<SpanGroundingScore> {
  const grounding = result.sidecar.grounding;
  const sampleSize = options.supportSampleSize ?? 60;

  const resolved = result.sidecar.claims.filter((claim) => claim.span !== null);
  // An even stride rather than the first N: claims are emitted in pass order, so the head of the
  // list is all entities and the tail is all events. A prefix would judge one pass.
  const stride = Math.max(1, Math.ceil(resolved.length / sampleSize));
  const sample = resolved.filter((_, index) => index % stride === 0).slice(0, sampleSize);

  const items: SupportItem[] = sample.map((claim) => ({
    subject: claim.subject,
    claim: claim.claim,
    quote: claim.span!.text,
    context: contextAround(source.text, claim.span!),
  }));

  const { verdicts, unjudged } = await judgeSpanSupport(judge, items);
  const counted = (verdict: SupportJudgment['verdict']): number =>
    verdicts.filter((entry) => entry.verdict === verdict).length;

  const supports = counted('supports');
  return {
    bar:
      'no rubric bar: §8 of the prior-art survey defines the check, the rubric has no numeric ' +
      'threshold for it. Reported as the gate the ticket asks for, not as a scored metric.',
    claims: grounding.total,
    resolved_exact: grounding.exact,
    resolved_normalized: grounding.normalized,
    unresolved: grounding.unresolved,
    quote_resolution_rate: grounding.grounded_rate,
    judged: verdicts.length,
    supports,
    insufficient: counted('insufficient'),
    contradicts: counted('contradicts'),
    unjudged: unjudged.length,
    support_rate: verdicts.length === 0 ? 0 : supports / verdicts.length,
    worst: verdicts
      .filter((entry) => entry.verdict !== 'supports')
      .slice(0, 12)
      .map((entry) => ({ subject: entry.subject, verdict: entry.verdict, why: entry.why })),
  };
}

async function scoreSeedAttributes(
  result: ExtractionResult,
  source: LoadedSource,
  judge: ExtractionModel,
  alignedByFixtureId: ReadonlyMap<string, string>,
): Promise<SeedAttributeScore> {
  // §3.2 scores attribute contradiction over *aligned* rows only: an invented row's attributes
  // are already counted as an invention by the precision number.
  const alignedCandidateIds = new Set(alignedByFixtureId.values());
  const seed = result.package.world_model_seed;
  const citedByEntity = new Map(
    result.sidecar.seed_attribute_spans.map((entry) => [entry.entity_id, entry]),
  );

  const items: AttributeItem[] = [];
  const push = (id: string, name: string, column: string, value: unknown): void => {
    if (value === null || value === undefined || value === '') return;
    if (!alignedCandidateIds.has(id)) return;
    const cited = citedByEntity.get(id);
    items.push({
      subject: `${id}.${column}`,
      entity: name,
      column,
      value: String(value),
      cited: cited?.span === null || cited === undefined ? '' : contextAround(source.text, cited.span),
    });
  };

  for (const row of seed.characters) {
    push(row.id, row.name, 'location_id', row.location_id);
    push(row.id, row.name, 'status', row.status);
    push(row.id, row.name, 'goal', row.goal);
    for (const [key, value] of Object.entries(row.bag ?? {})) push(row.id, row.name, `bag.${key}`, value);
  }
  for (const row of seed.objects) {
    push(row.id, row.name, 'location_id', row.location_id);
    push(row.id, row.name, 'status', row.status);
    for (const [key, value] of Object.entries(row.bag ?? {})) push(row.id, row.name, `bag.${key}`, value);
  }
  for (const row of seed.locations) {
    for (const [key, value] of Object.entries(row.bag ?? {})) push(row.id, row.name, `bag.${key}`, value);
  }

  const opening = source.text.slice(0, 9000);
  const { verdicts, unjudged } = await judgeSeedAttributes(judge, opening, items);
  const counted = (verdict: AttributeJudgment['verdict']): number =>
    verdicts.filter((entry) => entry.verdict === verdict).length;

  const contradicted = counted('contradicted');
  return {
    judged: verdicts.length,
    supported_at_start: counted('supported_at_start'),
    seed_time_errors: counted('true_later_not_at_start'),
    contradicted,
    insufficient: counted('insufficient'),
    unjudged: unjudged.length,
    contradiction_rate: verdicts.length === 0 ? 0 : contradicted / verdicts.length,
    examples: verdicts
      .filter((entry) => entry.verdict === 'contradicted' || entry.verdict === 'true_later_not_at_start')
      .slice(0, 15),
  };
}

async function scoreEvents(
  result: ExtractionResult,
  truth: GroundTruth,
  judge: ExtractionModel,
  spanGrounding: SpanGroundingScore,
): Promise<{ score: EventScore; matches: Map<string, string | null> }> {
  const candidates = result.sidecar.events.map((event) => ({ id: event.id, summary: event.summary }));
  const matches = await judgeEventEntailment(judge, truth.events, candidates);

  const chronologicalIndex = new Map(
    result.sidecar.events.map((event) => [event.id, event.chronological_index]),
  );

  const matched = [...matches.values()].filter((id) => id !== null).length;

  // Pairwise ordering, per §3.3: over all pairs of aligned events, the fraction ordered
  // correctly relative to each other. Pairwise, never sequence-identity — one misplaced event
  // costs one event's worth, not the whole tail.
  const alignedTruth = truth.events.filter((event) => matches.get(event.id) != null);
  let pairwiseTotal = 0;
  let pairwiseCorrect = 0;
  let highTotal = 0;
  let highCorrect = 0;
  let outTotal = 0;
  let outCorrect = 0;

  for (let i = 0; i < alignedTruth.length; i += 1) {
    for (let j = i + 1; j < alignedTruth.length; j += 1) {
      const a = alignedTruth[i]!;
      const b = alignedTruth[j]!;
      const truthOrder = Math.sign(a.chronological_key - b.chronological_key);
      if (truthOrder === 0) continue;
      const candidateA = chronologicalIndex.get(matches.get(a.id)!)!;
      const candidateB = chronologicalIndex.get(matches.get(b.id)!)!;
      const candidateOrder = Math.sign(candidateA - candidateB);
      const correct = candidateOrder === truthOrder;

      pairwiseTotal += 1;
      if (correct) pairwiseCorrect += 1;

      if (a.confidence === 'high' && b.confidence === 'high') {
        highTotal += 1;
        if (correct) highCorrect += 1;
      }
      if (narratedOutOfOrder(a, b)) {
        outTotal += 1;
        if (correct) outCorrect += 1;
      }
    }
  }

  // §3.3's fabricated-event count. An event is fabricated when nothing in the source grounds it:
  // either its quote could not be found at all, or the judge read the span and said the prose
  // does not support the summary. Both are read off work already done — the ungrounded list and
  // the span-support verdicts — rather than spending a second judge pass on the same question.
  const ungroundedEventIds = result.sidecar.grounding.ungrounded
    .filter((entry) => entry.subject.startsWith('event:'))
    .map((entry) => entry.subject.slice('event:'.length));
  const unsupportedEventIds = spanGrounding.worst
    .filter((entry) => entry.subject.startsWith('event:') && entry.verdict === 'contradicts')
    .map((entry) => entry.subject.slice('event:'.length));
  const fabricated = new Set([...ungroundedEventIds, ...unsupportedEventIds]);

  const byId = new Map(result.sidecar.events.map((event) => [event.id, event]));

  return {
    matches,
    score: {
      ground_truth_events: truth.events.length,
      candidate_events: candidates.length,
      matched,
      recall: truth.events.length === 0 ? 0 : matched / truth.events.length,
      missed: truth.events.filter((event) => matches.get(event.id) == null).map((event) => event.text),
      pairwise_total: pairwiseTotal,
      pairwise_correct: pairwiseCorrect,
      pairwise_accuracy: pairwiseTotal === 0 ? 0 : pairwiseCorrect / pairwiseTotal,
      high_confidence_total: highTotal,
      high_confidence_correct: highCorrect,
      high_confidence_accuracy: highTotal === 0 ? 0 : highCorrect / highTotal,
      out_of_order_total: outTotal,
      out_of_order_correct: outCorrect,
      out_of_order_accuracy: outTotal === 0 ? null : outCorrect / outTotal,
      fabricated: fabricated.size,
      fabricated_examples: [...fabricated].slice(0, 10).map((id) => byId.get(id)?.summary ?? id),
    },
  };
}
