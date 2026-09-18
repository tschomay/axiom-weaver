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
 * §3.5 (segmentation), §3.6 (reveal order) and §3.7 (plant/payoff) are **not scored here**. They
 * are defined over Scene Cards, this pipeline stops before segmentation by design (#113's
 * boundary, #118's ticket), and a number computed over an empty `scene_cards` array would be a
 * zero that means "not attempted" while looking like a zero that means "failed". They are reported
 * as out-of-scope with that reason attached, and `src/segmentation/scoring/score.ts` is what
 * scores them once segmentation has drawn the cards. (The section numbers above previously read
 * §3.4/§3.5/§3.6, one off from the rubric's own numbering.)
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

/**
 * Every entity id some event actually refers to — the operative form of §2's "different valid
 * grain is not an error."
 *
 * A row is **load-bearing** when an event names it: in `participants`, as the event's
 * `location_id`, or as a `state_updates` entity or location value. A row nothing references is a
 * modeling-grain disagreement with the fixture, not a fidelity failure, and §2 says so directly.
 * It is the same opinion the linter already ships as `unused_seed_entity`, read one layer earlier.
 *
 * Deliberately a *reference* test and not a judgment: it needs no judge, no gold data and no new
 * field, so two runs are comparable without an alignment decision in the middle of the metric.
 *
 * **It is necessary, not sufficient, and the numbers say so.** At this threshold Cinderella lands
 * close to the fixture's grain (16 character rows against a 9-row target, versus 20 flat) while
 * *A Christmas Carol* still carries 99 against a 23-row target. The residue is #143's merge and
 * #144's under-extracted events, both of which change this input — which is why no second rule is
 * stacked here before those land.
 */
export function eventReferencedIds(
  events: ExtractionResult['sidecar']['events'],
): Set<string> {
  const referenced = new Set<string>();
  for (const event of events) {
    for (const participant of event.participants) referenced.add(participant);
    if (event.location_id !== null) referenced.add(event.location_id);
    for (const update of event.state_updates) {
      referenced.add(update.entity_id);
      if (update.column === 'location_id' && typeof update.value === 'string') {
        referenced.add(update.value);
      }
    }
  }
  return referenced;
}

/**
 * Objects are exempt, and the exemption is measured rather than assumed.
 *
 * Not one object row on either fixture is referenced by any event — 95 on *A Christmas Carol*, 12
 * on Cinderella, zero references between them — because no Fabula field can name one:
 * `participants` is characters-only by design, `location_id` is a `loc_` id, and every extracted
 * `state_updates.entity_id` on both fixtures is a character. Applying the rule here would empty
 * the table and report precision over a denominator of zero.
 *
 * That orphaning is #154's to fix. Until it lands, objects score on the flat denominator and the
 * result says which denominator it used, rather than quietly scoring one table a different way.
 */
const RULE_EXEMPT_TABLES: ReadonlySet<string> = new Set(['objects']);

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
  /**
   * The non-supporting verdicts, **truncated to 12 for a human reader**. Display only.
   *
   * It was briefly also the input to §3.4's fabricated-event count, which is why the truncation
   * is called out here rather than left implicit: a zero-tolerance metric computed off a list
   * that drops everything past the twelfth entry under-reports silently the moment a run has
   * more than twelve non-supporting spans. `contradicted_subjects` below is the complete list,
   * and is what any scored metric must read.
   */
  readonly worst: ReadonlyArray<{ subject: string; verdict: string; why: string }>;
  /** Every subject the judge read as contradicted by its own span. Complete, never truncated. */
  readonly contradicted_subjects: readonly string[];
}

export interface TableScore {
  readonly table: string;
  readonly fixture_rows: number;
  readonly candidate_rows: number;
  readonly aligned: number;
  readonly recall: number;
  /**
   * §3.3 precision over **load-bearing** rows — see `eventReferencedIds`.
   *
   * §2 splits disagreement three ways and says a *different valid grain* — a row the fixture chose
   * not to model — is "**not** an error; excluded from the denominator where the rule below says
   * so." No rule below ever said so, and this was `aligned / candidate_rows` flat, which measures
   * agreement with one author's grain rather than fidelity to the source. Cinderella is the proof:
   * it has no duplicate entities at all and still scored 0.40, on twelve unaligned rows that are
   * all entities the source names and the fixture folded away (`six mice`, `The King`, `coachman`).
   */
  readonly precision: number;
  /** The old flat number, published alongside so the change is auditable rather than silent. */
  readonly precision_flat: number;
  /** Rows in the precision denominator: referenced by some event, or aligned to the fixture. */
  readonly load_bearing_rows: number;
  /** Rows no event references — reported, never silently forgiven. */
  readonly over_extracted: number;
  readonly over_extracted_examples: readonly string[];
  /** Whether the load-bearing rule was applied to this table, and why not when it wasn't. */
  readonly denominator: string;
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
  /**
   * §3.4's zero-tolerance row: events the judge read against their own span and found the source
   * **contradicts**. Invention, and nothing else.
   *
   * It used to also count events whose quote would not resolve, and on *A Christmas Carol* that
   * made it 13 against a bar of 0 — while all ten published examples were events Dickens actually
   * narrates, flagged because the model paraphrased instead of copying. That is a real defect and
   * it is still reported, as `ungroundable_events` and as §3.2's `quote_resolution_rate`; it is
   * simply not invention, and folding it in here made a zero-tolerance row unreadable.
   */
  /**
   * Beats the entailment judge could not score, even one at a time (#167).
   *
   * They are counted as misses in `recall` because there is nothing else to do with them, but they
   * are a judge failure rather than a pipeline one. A nonzero value here means `recall` is a floor,
   * not a measurement — report it next to the number, never on its own.
   */
  readonly entailment_unresolved: number;
  readonly entailment_unresolved_beats: readonly string[];
  readonly fabricated: number;
  /**
   * How many spans the judge actually read. `fabricated` is a count out of *this*, never a bare
   * zero — a zero-tolerance row reported without its sample size overstates what was measured.
   */
  readonly fabricated_judged: number;
  readonly fabricated_examples: readonly string[];
  /** Events whose quote could not be resolved in the source. A §3.2 defect, not invention. */
  readonly ungroundable_events: number;
  readonly ungroundable_examples: readonly string[];
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
  // §2's grain rule, computed once: which seed rows any event actually refers to.
  const referenced = eventReferencedIds(result.sidecar.events);
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
    const ruleApplies = !RULE_EXEMPT_TABLES.has(table);
    // An aligned row is load-bearing whatever the events did: the fixture itself vouched for it,
    // and dropping one would let precision exceed 1 by shrinking the denominator under its own
    // numerator.
    const loadBearing = ruleApplies
      ? candidateRows.filter((row) => referenced.has(row.id) || used.has(row.id))
      : candidateRows;
    const overExtracted = candidateRows.filter((row) => !loadBearing.includes(row));
    const flat = candidateRows.length === 0 ? 0 : aligned / candidateRows.length;
    tables.push({
      table,
      fixture_rows: fixtureRows.length,
      candidate_rows: candidateRows.length,
      aligned,
      recall: fixtureRows.length === 0 ? 1 : aligned / fixtureRows.length,
      precision: loadBearing.length === 0 ? 0 : aligned / loadBearing.length,
      precision_flat: flat,
      load_bearing_rows: loadBearing.length,
      over_extracted: overExtracted.length,
      over_extracted_examples: overExtracted.slice(0, 20).map((row) => row.name),
      denominator: ruleApplies
        ? 'load-bearing rows (§2: referenced by some event, or aligned)'
        : 'all candidate rows — the load-bearing rule is not applied to this table (see #154)',
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
        section: '§3.5 Scene segmentation',
        reason:
          'this pipeline stops before segmentation by design (#113 boundary; #118 owns it), so ' +
          'scene_cards is empty and every §3.5 metric has an empty denominator. Scored by ' +
          'src/segmentation/scoring/score.ts once #118 has drawn the cards.',
      },
      {
        section: '§3.6 Reveal order',
        reason:
          'reader_must_learn / must_stay_hidden are Scene Card fields; §4.7 of the research is ' +
          'explicit that the told-ledger is derived from those, not extracted from prose',
      },
      {
        section: '§3.7 Plant/payoff graph',
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
    contradicted_subjects: verdicts
      .filter((entry) => entry.verdict === 'contradicts')
      .map((entry) => entry.subject),
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

/**
 * Split the two failures §3.4 used to add together: **invention** and **an unresolvable quote**.
 *
 * They look alike in the output — both are events you cannot point at a supporting span — and they
 * are opposite defects. An invented event is one the source does not contain; an ungroundable one
 * is usually an event the source contains perfectly well, whose `quote` the model paraphrased
 * instead of copying, so the span lookup missed. The first is a hallucination. The second is a
 * transcription failure, already counted by §3.2's `quote_resolution_rate`.
 *
 * §3.4 puts a zero bar on invention because "an invented event propagates into segmentation and
 * plant structure". That reasoning does not reach a real event with a sloppy quote, and counting
 * the two together is what made the *Carol* report 13 fabricated events while every published
 * example was something Dickens narrates.
 *
 * `contradicted` must be the **complete** list of contradicted subjects, never
 * `SpanGroundingScore.worst`, which is truncated to twelve for display.
 */
export function invention(
  ungroundedSubjects: readonly string[],
  contradicted: readonly string[],
): { fabricated: string[]; ungroundable: string[] } {
  const eventIds = (subjects: readonly string[]): string[] => [
    ...new Set(
      subjects
        .filter((subject) => subject.startsWith('event:'))
        .map((subject) => subject.slice('event:'.length)),
    ),
  ];
  return { fabricated: eventIds(contradicted), ungroundable: eventIds(ungroundedSubjects) };
}

async function scoreEvents(
  result: ExtractionResult,
  truth: GroundTruth,
  judge: ExtractionModel,
  spanGrounding: SpanGroundingScore,
): Promise<{ score: EventScore; matches: Map<string, string | null> }> {
  const candidates = result.sidecar.events.map((event) => ({ id: event.id, summary: event.summary }));
  const entailment = await judgeEventEntailment(judge, truth.events, candidates);
  const matches = entailment.matches;

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

  // §3.4's fabricated-event count — invention, and only invention. See `invention()`.
  const { fabricated, ungroundable } = invention(
    result.sidecar.grounding.ungrounded.map((entry) => entry.subject),
    spanGrounding.contradicted_subjects,
  );

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
      entailment_unresolved: entailment.unresolved.length,
      entailment_unresolved_beats: entailment.unresolved,
      fabricated: fabricated.length,
      fabricated_judged: spanGrounding.judged,
      fabricated_examples: fabricated.slice(0, 10).map((id) => byId.get(id)?.summary ?? id),
      ungroundable_events: ungroundable.length,
      ungroundable_examples: ungroundable.slice(0, 10).map((id) => byId.get(id)?.summary ?? id),
    },
  };
}
