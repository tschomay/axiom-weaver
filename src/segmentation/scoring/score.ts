/**
 * Rubric §3.5, §3.6 and §3.7, computed over one segmentation run.
 *
 * `docs/agents/story-authoring-eval.md` names these three sections and #117 could not score any of
 * them: they are "defined over Scene Cards, this pipeline stops before segmentation by design", so
 * its result file lists them as out of scope with that reason attached. This ticket is what
 * produces Scene Cards, so this module is what closes them out. §3.1–§3.4 stay #117's — they
 * measure the World Model seed and the event list, neither of which segmentation touches.
 *
 * Per §5: no composite score, bars carried next to the numbers rather than restated, and the
 * model that produced every result recorded.
 *
 * ## The alignment this reuses rather than rebuilds
 *
 * §3.1 is emphatic that entity- and event-level metrics are meaningless without a frozen
 * alignment, and that two runs are only comparable if the alignment was built the same way.
 * #117's scoring already built one and wrote it to `fixtures/extraction/runs/<story>/score.json`:
 * every fixture `required_beats` entry, judged against the candidate event list, with the matching
 * candidate event id or `null`. That file is the input here, not a second alignment built the same
 * way by different code.
 *
 * It buys the scene alignment for free and with no judge at all. A fixture beat names a fixture
 * scene; its aligned candidate event names a candidate scene (the `_segmentation` block records
 * which); so fixture scene ↔ candidate scene falls out of a table lookup. The cost is honest and
 * worth stating: a fixture scene whose beats went unaligned by #117 is unscoreable here, and the
 * denominators below say how many did.
 *
 * ## Two places this deviates from the rubric's literal wording, both on purpose
 *
 * - **§3.5's boundary agreement** is specified in source-text offsets with a ±2% window. That is
 *   what is computed, using the `source_span` each extracted event carries — but the *fixture's*
 *   boundaries have no offsets of their own, so a fixture boundary is located at the earliest
 *   source offset among the candidate events aligned into that fixture scene. It is a derived
 *   position, accurate only to the alignment underneath it, and a generated arc has no offsets at
 *   all, so this metric is reported as `null` there rather than faked.
 * - **§3.5's POV and location accuracy** says "against the source". What is computed is agreement
 *   with the fixture, mapped through #117's entity alignment. §2 is explicit that the fixtures are
 *   one valid authoring, so a disagreement here is *not* necessarily an error — the *Carol*'s own
 *   `loc_world_tour` is an invented location covering a montage, and no extractor would produce
 *   it. Read the number as agreement, which is what it measures.
 */

import type { ExtractionModel } from '../../extraction/call';
import {
  contextAround,
  judgeAlignment,
  judgeEventEntailment,
  judgeSpanSupport,
  type SupportItem,
} from '../../extraction/scoring/judge';
import type { GroundTruth } from '../../extraction/scoring/ground-truth';
import { lintPackage, type PackageProblem } from '../../authoring/lint';
import { scenesInOrder, type SceneCard, type StoryPackage } from '../../schema/story-package';
import { walkPlantObligations } from '../../plants/obligation-walk';

/** §3.5's suggested window for a boundary match: ±2% of the source's length. */
export const BOUNDARY_WINDOW_FRACTION = 0.02;
/** §3.7's threshold for a "long-range" plant/payoff pair. */
export const LONG_RANGE_SCENES = 5;
/** §3.2's minimum sample for a judged rate; reused for the beat-invention sample. */
export const BEAT_SAMPLE = 30;

export interface SavedAlignment {
  readonly events: ReadonlyArray<{ truth_id: string; truth_text: string; candidate_id: string | null }>;
  readonly rows: ReadonlyArray<{
    table: string;
    fixture_id: string;
    candidate_id: string | null;
  }>;
}

export interface SegmentationBlockScene {
  readonly id: string;
  readonly order: number;
  readonly event_ids: readonly string[];
}

export interface CandidateEventSpan {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

export interface SceneAlignmentRow {
  readonly fixture_scene: string;
  readonly candidate_scene: string | null;
  readonly aligned_beats: number;
  readonly fixture_beats: number;
  readonly how: 'majority_of_aligned_beats' | 'unaligned';
}

export interface BoundaryScore {
  readonly bar: '≥ 0.70 precision and recall (§3.5)';
  readonly window_chars: number | null;
  readonly fixture_boundaries: number;
  readonly candidate_boundaries: number;
  readonly matched: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly note: string;
}

export interface BeatScore {
  readonly coverage_bar: '≥ 0.80 mean, no aligned scene below 0.5 (§3.5)';
  readonly invention_bar: '≤ 0.10 (§3.5)';
  readonly scored_scenes: number;
  readonly mean_coverage: number | null;
  readonly worst_scene: { scene: string; coverage: number } | null;
  readonly scenes_below_half: readonly string[];
  readonly sampled_beats: number;
  readonly supported: number;
  readonly insufficient: number;
  readonly contradicted: number;
  readonly invention_rate: number | null;
}

export interface PovLocationScore {
  readonly bar: '≥ 0.95, read as agreement with the fixture rather than against the source (§3.5)';
  readonly scored: number;
  readonly pov_agreements: number;
  readonly location_agreements: number;
  readonly pov_accuracy: number | null;
  readonly location_accuracy: number | null;
  readonly disagreements: ReadonlyArray<{ fixture_scene: string; field: string; fixture: string; candidate: string }>;
}

export interface CoverageScore {
  readonly bar: '≥ 0.95 (§3.5)';
  readonly source_chars: number | null;
  readonly covered_chars: number | null;
  readonly coverage: number | null;
  /** Unassigned stretches, longest first — §3.5 asks where they fall, not only how much. */
  readonly gaps: ReadonlyArray<{ start: number; end: number; chars: number }>;
  /**
   * The part of this number segmentation is actually responsible for.
   *
   * §3.5 reads source coverage as a segmentation defect — "a segmentation that quietly drops a
   * stretch of the middle still scores well on the boundaries it did produce". That reading holds
   * only for a pipeline that reads the source itself. This one never sees prose: it can only
   * assign the events it was handed, so an uncovered stretch is a stretch the *upstream* event
   * list never reached. `events_assigned` versus `events_supplied` is the check that separates the
   * two, and anything below 1.0 there is segmentation losing events, which is the real defect this
   * metric is looking for.
   */
  readonly events_supplied: number;
  readonly events_assigned: number;
  readonly assignment_rate: number | null;
}

export interface RevealOrderScore {
  readonly order_bar: '≥ 0.90 pairwise (§3.6)';
  readonly premature_bar: '0 (§3.6)';
  readonly hidden_bar: '≥ 0.80 recall (§3.6)';
  readonly fixture_facts: number;
  readonly candidate_facts: number;
  readonly aligned_facts: number;
  readonly pairwise_total: number;
  readonly pairwise_correct: number;
  readonly pairwise_accuracy: number | null;
  readonly premature: ReadonlyArray<{ fact: string; fixture_scene: number; candidate_scene: number }>;
  readonly fixture_hidden_facts: number;
  readonly hidden_recovered: number;
  readonly hidden_recall: number | null;
}

export interface PlantScore {
  readonly pair_bar: '≥ 0.70 recall (§3.7)';
  readonly long_range_bar: '≥ 0.60 recall (§3.7)';
  readonly fixture_pairs: number;
  /**
   * Where the fixture side of this metric came from (#153).
   *
   * `declared_graph` means the package's own `pays_off` edges alone — 2, 3 and 5 across the three
   * fixtures, a denominator too small to read a recall number at. `annotation_sidecar` means
   * `fixtures/<story>/plants.annotation.json` was found and its implicit pairs were scored too.
   */
  readonly fixture_pairs_source: 'declared_graph' | 'annotation_sidecar';
  readonly fixture_pairs_declared: number;
  readonly fixture_pairs_annotated: number;
  readonly candidate_pairs: number;
  readonly matched: number;
  readonly matched_declared: number;
  readonly matched_annotated: number;
  readonly recall: number | null;
  readonly long_range_fixture_pairs: number;
  readonly long_range_matched: number;
  readonly long_range_recall: number | null;
  readonly misattributed: number;
  /** §1: the graph's own validity, which G0 already guarantees — restated because #118 built it. */
  readonly orphans: readonly string[];
  readonly plant_walk_errors: readonly string[];
  readonly span_histogram: Readonly<Record<string, number>>;
}

export interface SegmentationScore {
  readonly story_id: string;
  readonly scored_at: string;
  readonly fixture_package_version: number;
  readonly segmenter_models: readonly string[];
  readonly judge_model: string;
  readonly judge_cost_usd: number;
  readonly g0: {
    readonly bar: 'publishable === true (§1)';
    readonly publishable: boolean;
    readonly errors: readonly PackageProblem[];
    readonly warning_counts: Readonly<Record<string, number>>;
  };
  readonly scene_count: {
    readonly fixture: number;
    readonly candidate: number;
    /** §3.5: reported, never barred. Outside 0.5–2.0, distrust the boundary numbers. */
    readonly ratio: number;
    readonly trustworthy_band: boolean;
  };
  readonly scene_alignment: readonly SceneAlignmentRow[];
  readonly boundaries: BoundaryScore;
  readonly beats: BeatScore;
  readonly pov_location: PovLocationScore;
  readonly source_coverage: CoverageScore;
  readonly reveal_order: RevealOrderScore;
  readonly plants: PlantScore;
  readonly caveats: readonly string[];
}

export interface ScoreInputs {
  readonly storyId: string;
  readonly candidate: StoryPackage;
  readonly sceneBlock: readonly SegmentationBlockScene[];
  readonly spans: readonly CandidateEventSpan[];
  readonly truth: GroundTruth;
  readonly alignment: SavedAlignment;
  readonly segmenterModels: readonly string[];
  readonly source: { readonly text: string } | null;
  readonly onProgress?: (message: string) => void;
}

// --- Scene alignment ----------------------------------------------------------------------

function sceneAlignment(
  truth: GroundTruth,
  alignment: SavedAlignment,
  sceneOfEvent: ReadonlyMap<string, string>,
): SceneAlignmentRow[] {
  const beatsPerFixtureScene = new Map<string, number>();
  for (const event of truth.events) {
    beatsPerFixtureScene.set(event.scene_id, (beatsPerFixtureScene.get(event.scene_id) ?? 0) + 1);
  }

  const votes = new Map<string, Map<string, number>>();
  for (const row of alignment.events) {
    if (row.candidate_id === null) continue;
    const fixtureScene = row.truth_id.split('#')[0] ?? '';
    const candidateScene = sceneOfEvent.get(row.candidate_id);
    if (fixtureScene === '' || candidateScene === undefined) continue;
    const tally = votes.get(fixtureScene) ?? new Map<string, number>();
    tally.set(candidateScene, (tally.get(candidateScene) ?? 0) + 1);
    votes.set(fixtureScene, tally);
  }

  const used = new Set<string>();
  const rows: SceneAlignmentRow[] = [];
  for (const [fixtureScene, fixtureBeats] of beatsPerFixtureScene) {
    const tally = votes.get(fixtureScene);
    if (tally === undefined || tally.size === 0) {
      rows.push({
        fixture_scene: fixtureScene,
        candidate_scene: null,
        aligned_beats: 0,
        fixture_beats: fixtureBeats,
        how: 'unaligned',
      });
      continue;
    }
    // Most-voted candidate scene, preferring one not already claimed so a merged candidate scene
    // does not silently absorb every fixture scene it overlaps.
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const pick = ranked.find(([id]) => !used.has(id)) ?? ranked[0]!;
    used.add(pick[0]);
    rows.push({
      fixture_scene: fixtureScene,
      candidate_scene: pick[0],
      aligned_beats: pick[1],
      fixture_beats: fixtureBeats,
      how: 'majority_of_aligned_beats',
    });
  }

  return rows;
}

// --- §3.5 boundaries ----------------------------------------------------------------------

function boundaryScore(
  truth: GroundTruth,
  alignment: SavedAlignment,
  scenes: readonly SceneCard[],
  sceneBlock: readonly SegmentationBlockScene[],
  spanOf: ReadonlyMap<string, CandidateEventSpan>,
  sourceChars: number | null,
): BoundaryScore {
  if (sourceChars === null || spanOf.size === 0) {
    return {
      bar: '≥ 0.70 precision and recall (§3.5)',
      window_chars: null,
      fixture_boundaries: 0,
      candidate_boundaries: 0,
      matched: 0,
      precision: null,
      recall: null,
      note:
        'not computed: this input carries no source spans, so neither boundary set has a position ' +
        'in the source. Expected for a generated arc.',
    };
  }

  const window = Math.round(sourceChars * BOUNDARY_WINDOW_FRACTION);

  const earliestFor = (eventIds: readonly string[]): number | null => {
    let best: number | null = null;
    for (const id of eventIds) {
      const span = spanOf.get(id);
      if (span === undefined) continue;
      if (best === null || span.start < best) best = span.start;
    }
    return best;
  };

  const alignedByFixtureScene = new Map<string, string[]>();
  for (const row of alignment.events) {
    if (row.candidate_id === null) continue;
    const fixtureScene = row.truth_id.split('#')[0] ?? '';
    const list = alignedByFixtureScene.get(fixtureScene) ?? [];
    list.push(row.candidate_id);
    alignedByFixtureScene.set(fixtureScene, list);
  }

  const fixtureOrder = [...new Set(truth.events.map((event) => event.scene_id))];
  const fixtureBoundaries: number[] = [];
  for (const sceneId of fixtureOrder.slice(1)) {
    const at = earliestFor(alignedByFixtureScene.get(sceneId) ?? []);
    if (at !== null) fixtureBoundaries.push(at);
  }

  const blockById = new Map(sceneBlock.map((entry) => [entry.id, entry]));
  const candidateBoundaries: number[] = [];
  for (const scene of scenes.slice(1)) {
    const at = earliestFor(blockById.get(scene.id)?.event_ids ?? []);
    if (at !== null) candidateBoundaries.push(at);
  }

  const unmatched = [...candidateBoundaries];
  let matched = 0;
  for (const fixtureAt of fixtureBoundaries) {
    const index = unmatched.findIndex((at) => Math.abs(at - fixtureAt) <= window);
    if (index !== -1) {
      unmatched.splice(index, 1);
      matched += 1;
    }
  }

  return {
    bar: '≥ 0.70 precision and recall (§3.5)',
    window_chars: window,
    fixture_boundaries: fixtureBoundaries.length,
    candidate_boundaries: candidateBoundaries.length,
    matched,
    precision: candidateBoundaries.length === 0 ? null : matched / candidateBoundaries.length,
    recall: fixtureBoundaries.length === 0 ? null : matched / fixtureBoundaries.length,
    note:
      'fixture boundaries are located at the earliest source offset among the candidate events ' +
      "#117's alignment assigned to that fixture scene; the fixtures carry no offsets of their own",
  };
}

// --- §3.5 source coverage -----------------------------------------------------------------

function coverageScore(
  sceneBlock: readonly SegmentationBlockScene[],
  spanOf: ReadonlyMap<string, CandidateEventSpan>,
  sourceChars: number | null,
): CoverageScore {
  const assigned = new Set(sceneBlock.flatMap((scene) => [...scene.event_ids]));
  const supplied = spanOf.size;
  const assignedWithSpans = [...assigned].filter((id) => spanOf.has(id)).length;

  if (sourceChars === null || spanOf.size === 0) {
    return {
      bar: '≥ 0.95 (§3.5)',
      source_chars: sourceChars,
      covered_chars: null,
      coverage: null,
      gaps: [],
      events_supplied: supplied,
      events_assigned: assignedWithSpans,
      assignment_rate: supplied === 0 ? null : assignedWithSpans / supplied,
    };
  }

  const ranges: Array<{ start: number; end: number }> = [];
  for (const scene of sceneBlock) {
    let start: number | null = null;
    let end: number | null = null;
    for (const id of scene.event_ids) {
      const span = spanOf.get(id);
      if (span === undefined) continue;
      start = start === null ? span.start : Math.min(start, span.start);
      end = end === null ? span.end : Math.max(end, span.end);
    }
    if (start !== null && end !== null) ranges.push({ start, end });
  }

  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const covered = merged.reduce((sum, range) => sum + (range.end - range.start), 0);
  const gaps: Array<{ start: number; end: number; chars: number }> = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) gaps.push({ start: cursor, end: range.start, chars: range.start - cursor });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < sourceChars) gaps.push({ start: cursor, end: sourceChars, chars: sourceChars - cursor });
  gaps.sort((a, b) => b.chars - a.chars);

  return {
    bar: '≥ 0.95 (§3.5)',
    source_chars: sourceChars,
    covered_chars: covered,
    coverage: sourceChars === 0 ? null : covered / sourceChars,
    gaps: gaps.slice(0, 10),
    events_supplied: supplied,
    events_assigned: assignedWithSpans,
    assignment_rate: supplied === 0 ? null : assignedWithSpans / supplied,
  };
}

// --- §3.5 pov / location ------------------------------------------------------------------

function povLocationScore(
  truth: GroundTruth,
  rows: readonly SceneAlignmentRow[],
  candidateById: ReadonlyMap<string, SceneCard>,
  entityAlignment: ReadonlyMap<string, string>,
): PovLocationScore {
  const fixtureScenes = new Map(truth.package.scene_cards.map((scene) => [scene.id, scene]));
  const disagreements: Array<{ fixture_scene: string; field: string; fixture: string; candidate: string }> = [];
  let scored = 0;
  let povAgree = 0;
  let locationAgree = 0;

  for (const row of rows) {
    if (row.candidate_scene === null) continue;
    const fixture = fixtureScenes.get(row.fixture_scene);
    const candidate = candidateById.get(row.candidate_scene);
    if (fixture === undefined || candidate === undefined) continue;
    scored += 1;

    const expectedPov = entityAlignment.get(fixture.pov);
    if (expectedPov !== undefined && expectedPov === candidate.pov) povAgree += 1;
    else {
      disagreements.push({
        fixture_scene: row.fixture_scene,
        field: 'pov',
        fixture: `${fixture.pov}${expectedPov === undefined ? ' (unaligned)' : ` → ${expectedPov}`}`,
        candidate: candidate.pov,
      });
    }

    const expectedLocation = entityAlignment.get(fixture.location_id);
    if (expectedLocation !== undefined && expectedLocation === candidate.location_id) locationAgree += 1;
    else {
      disagreements.push({
        fixture_scene: row.fixture_scene,
        field: 'location_id',
        fixture: `${fixture.location_id}${expectedLocation === undefined ? ' (unaligned)' : ` → ${expectedLocation}`}`,
        candidate: candidate.location_id,
      });
    }
  }

  return {
    bar: '≥ 0.95, read as agreement with the fixture rather than against the source (§3.5)',
    scored,
    pov_agreements: povAgree,
    location_agreements: locationAgree,
    pov_accuracy: scored === 0 ? null : povAgree / scored,
    location_accuracy: scored === 0 ? null : locationAgree / scored,
    disagreements: disagreements.slice(0, 20),
  };
}

// --- §3.7 plant/payoff --------------------------------------------------------------------

function plantScore(
  candidate: StoryPackage,
  truth: GroundTruth,
  sceneMap: ReadonlyMap<string, string>,
  factMap: ReadonlyMap<string, string>,
): PlantScore {
  const fixtureOrder = new Map(truth.package.scene_cards.map((scene) => [scene.id, scene.order]));
  const candidateOrder = new Map(candidate.scene_cards.map((scene) => [scene.id, scene.order]));

  const fixturePairs: Array<{
    fact: string;
    plant: string | null;
    payoff: string;
    span: number;
    declared: boolean;
  }> = [];
  for (const scene of truth.package.scene_cards) {
    for (const payoff of scene.pays_off) {
      const plantOrder = payoff.plant === null ? null : (fixtureOrder.get(payoff.plant) ?? null);
      fixturePairs.push({
        fact: payoff.fact_ref,
        plant: payoff.plant,
        payoff: scene.id,
        span: plantOrder === null ? 0 : scene.order - plantOrder,
        declared: true,
      });
    }
  }
  // #153: the pairs the source supports that the package does not declare. Scored identically —
  // the point of the sidecar is a denominator §3.7 can actually be read at, not a softer test.
  for (const pair of truth.plant_annotation?.implicit ?? []) {
    const payoffOrder = fixtureOrder.get(pair.payoff);
    if (payoffOrder === undefined) continue;
    const plantOrder = pair.plant === null ? null : (fixtureOrder.get(pair.plant) ?? null);
    fixturePairs.push({
      fact: pair.fact_ref,
      plant: pair.plant,
      payoff: pair.payoff,
      span: plantOrder === null ? 0 : payoffOrder - plantOrder,
      declared: false,
    });
  }

  const candidatePairs: Array<{ fact: string; plant: string | null; payoff: string; span: number }> = [];
  const histogram: Record<string, number> = {};
  for (const scene of candidate.scene_cards) {
    for (const payoff of scene.pays_off) {
      const plantOrder = payoff.plant === null ? null : (candidateOrder.get(payoff.plant) ?? null);
      const span = plantOrder === null ? 0 : scene.order - plantOrder;
      candidatePairs.push({ fact: payoff.fact_ref, plant: payoff.plant, payoff: scene.id, span });
      const bucket = span === 0 ? 'seed' : span >= LONG_RANGE_SCENES ? `${LONG_RANGE_SCENES}+` : String(span);
      histogram[bucket] = (histogram[bucket] ?? 0) + 1;
    }
  }

  let matched = 0;
  let matchedDeclared = 0;
  let matchedAnnotated = 0;
  let longRangeMatched = 0;
  let misattributed = 0;
  let longRangeFixture = 0;

  for (const pair of fixturePairs) {
    const isLongRange = pair.span >= LONG_RANGE_SCENES;
    if (isLongRange) longRangeFixture += 1;
    const expectedFact = factMap.get(pair.fact);
    const expectedPayoff = sceneMap.get(pair.payoff);
    const expectedPlant = pair.plant === null ? null : (sceneMap.get(pair.plant) ?? undefined);
    if (expectedFact === undefined || expectedPayoff === undefined) continue;

    const samePayoff = candidatePairs.filter(
      (entry) => entry.fact === expectedFact && entry.payoff === expectedPayoff,
    );
    if (samePayoff.length === 0) continue;
    const exact = samePayoff.some((entry) => entry.plant === (expectedPlant ?? null));
    if (exact) {
      matched += 1;
      if (pair.declared) matchedDeclared += 1;
      else matchedAnnotated += 1;
      if (isLongRange) longRangeMatched += 1;
    } else {
      misattributed += 1;
    }
  }

  const walk = walkPlantObligations(candidate);
  const paidOff = new Set(candidate.scene_cards.flatMap((scene) => scene.pays_off.map((p) => p.fact_ref)));
  const orphans: string[] = [];
  for (const scene of candidate.scene_cards) {
    for (const fact of scene.reader_must_learn) {
      if (!paidOff.has(fact)) orphans.push(`${scene.id}:${fact}`);
    }
  }

  return {
    pair_bar: '≥ 0.70 recall (§3.7)',
    long_range_bar: '≥ 0.60 recall (§3.7)',
    fixture_pairs: fixturePairs.length,
    fixture_pairs_source:
      (truth.plant_annotation?.implicit.length ?? 0) > 0 ? 'annotation_sidecar' : 'declared_graph',
    fixture_pairs_declared: fixturePairs.filter((pair) => pair.declared).length,
    fixture_pairs_annotated: fixturePairs.filter((pair) => !pair.declared).length,
    matched_declared: matchedDeclared,
    matched_annotated: matchedAnnotated,
    candidate_pairs: candidatePairs.length,
    matched,
    recall: fixturePairs.length === 0 ? null : matched / fixturePairs.length,
    long_range_fixture_pairs: longRangeFixture,
    long_range_matched: longRangeMatched,
    long_range_recall: longRangeFixture === 0 ? null : longRangeMatched / longRangeFixture,
    misattributed,
    orphans,
    plant_walk_errors: walk.errors.map((error) => `[${error.code}] ${error.message}`),
    span_histogram: histogram,
  };
}

// --- §3.6 reveal order --------------------------------------------------------------------

function revealOrderScore(
  candidate: StoryPackage,
  truth: GroundTruth,
  factMap: ReadonlyMap<string, string>,
): RevealOrderScore {
  const fixtureReveal = new Map<string, number>();
  for (const scene of scenesInOrder(truth.package)) {
    for (const fact of scene.reader_must_learn) {
      if (!fixtureReveal.has(fact)) fixtureReveal.set(fact, scene.order);
    }
  }
  const candidateReveal = new Map<string, number>();
  for (const scene of scenesInOrder(candidate)) {
    for (const fact of scene.reader_must_learn) {
      if (!candidateReveal.has(fact)) candidateReveal.set(fact, scene.order);
    }
  }

  const aligned: Array<{ fact: string; fixture: number; candidate: number }> = [];
  for (const [fixtureFact, fixtureOrder] of fixtureReveal) {
    const candidateFact = factMap.get(fixtureFact);
    if (candidateFact === undefined) continue;
    const candidateOrder = candidateReveal.get(candidateFact);
    if (candidateOrder === undefined) continue;
    aligned.push({ fact: fixtureFact, fixture: fixtureOrder, candidate: candidateOrder });
  }

  let pairwiseTotal = 0;
  let pairwiseCorrect = 0;
  for (let i = 0; i < aligned.length; i += 1) {
    for (let j = i + 1; j < aligned.length; j += 1) {
      const a = aligned[i]!;
      const b = aligned[j]!;
      const fixtureSign = Math.sign(a.fixture - b.fixture);
      if (fixtureSign === 0) continue;
      pairwiseTotal += 1;
      if (Math.sign(a.candidate - b.candidate) === fixtureSign) pairwiseCorrect += 1;
    }
  }

  // §3.6's asymmetric error, scaled onto the candidate's own scene count so a candidate with a
  // different scene count is not automatically "premature" everywhere.
  const fixtureScenes = truth.package.scene_cards.length;
  const candidateScenes = candidate.scene_cards.length;
  const premature: Array<{ fact: string; fixture_scene: number; candidate_scene: number }> = [];
  for (const entry of aligned) {
    const expected = (entry.fixture / Math.max(1, fixtureScenes)) * candidateScenes;
    if (entry.candidate < expected - 1) {
      premature.push({ fact: entry.fact, fixture_scene: entry.fixture, candidate_scene: entry.candidate });
    }
  }

  const fixtureHidden = new Set(truth.package.scene_cards.flatMap((scene) => scene.must_stay_hidden));
  const candidateHidden = new Set(candidate.scene_cards.flatMap((scene) => scene.must_stay_hidden));
  let hiddenRecovered = 0;
  for (const fact of fixtureHidden) {
    const mapped = factMap.get(fact);
    if (mapped !== undefined && candidateHidden.has(mapped)) hiddenRecovered += 1;
  }

  return {
    order_bar: '≥ 0.90 pairwise (§3.6)',
    premature_bar: '0 (§3.6)',
    hidden_bar: '≥ 0.80 recall (§3.6)',
    fixture_facts: fixtureReveal.size,
    candidate_facts: candidateReveal.size,
    aligned_facts: aligned.length,
    pairwise_total: pairwiseTotal,
    pairwise_correct: pairwiseCorrect,
    pairwise_accuracy: pairwiseTotal === 0 ? null : pairwiseCorrect / pairwiseTotal,
    premature,
    fixture_hidden_facts: fixtureHidden.size,
    hidden_recovered: hiddenRecovered,
    hidden_recall: fixtureHidden.size === 0 ? null : hiddenRecovered / fixtureHidden.size,
  };
}

// --- the run ------------------------------------------------------------------------------

export async function scoreSegmentation(
  judge: ExtractionModel,
  inputs: ScoreInputs,
): Promise<SegmentationScore> {
  const progress = inputs.onProgress ?? ((): void => {});
  const scenes = scenesInOrder(inputs.candidate);
  const candidateById = new Map(scenes.map((scene) => [scene.id, scene]));
  const spanOf = new Map(inputs.spans.map((span) => [span.id, span]));
  const sourceChars = inputs.source === null ? null : inputs.source.text.length;

  const sceneOfEvent = new Map<string, string>();
  for (const entry of inputs.sceneBlock) {
    for (const id of entry.event_ids) sceneOfEvent.set(id, entry.id);
  }

  progress('§3.5 — scene alignment from #117\'s frozen event alignment');
  const alignmentRows = sceneAlignment(inputs.truth, inputs.alignment, sceneOfEvent);
  const sceneMap = new Map<string, string>();
  for (const row of alignmentRows) {
    if (row.candidate_scene !== null) sceneMap.set(row.fixture_scene, row.candidate_scene);
  }

  const entityAlignment = new Map<string, string>();
  for (const row of inputs.alignment.rows) {
    if (row.candidate_id !== null) entityAlignment.set(row.fixture_id, row.candidate_id);
  }

  progress('§3.5 — boundary agreement and source coverage');
  const boundaries = boundaryScore(
    inputs.truth,
    inputs.alignment,
    scenes,
    inputs.sceneBlock,
    spanOf,
    sourceChars,
  );
  const coverage = coverageScore(inputs.sceneBlock, spanOf, sourceChars);

  progress('§3.5 — required_beats coverage (judged)');
  const perSceneCoverage: Array<{ scene: string; coverage: number }> = [];
  for (const row of alignmentRows) {
    if (row.candidate_scene === null) continue;
    const fixtureScene = inputs.truth.package.scene_cards.find(
      (scene) => scene.id === row.fixture_scene,
    );
    const candidateScene = candidateById.get(row.candidate_scene);
    if (fixtureScene === undefined || candidateScene === undefined) continue;
    const matches = await judgeEventEntailment(
      judge,
      fixtureScene.required_beats.map((beat, index) => ({ id: `${row.fixture_scene}#${index}`, text: beat })),
      candidateScene.required_beats.map((beat, index) => ({
        id: `${candidateScene.id}#${index}`,
        summary: beat,
      })),
    );
    const covered = [...matches.values()].filter((value) => value !== null).length;
    perSceneCoverage.push({
      scene: row.fixture_scene,
      coverage: fixtureScene.required_beats.length === 0 ? 1 : covered / fixtureScene.required_beats.length,
    });
  }

  progress('§3.5 — beat invention (judged against the source)');
  const inventionItems: SupportItem[] = [];
  if (inputs.source !== null) {
    const blockById = new Map(inputs.sceneBlock.map((entry) => [entry.id, entry]));
    const step = Math.max(1, Math.floor(scenes.length / Math.max(1, Math.ceil(BEAT_SAMPLE / 3))));
    for (let index = 0; index < scenes.length && inventionItems.length < BEAT_SAMPLE; index += step) {
      const scene = scenes[index]!;
      let start: number | null = null;
      let end: number | null = null;
      for (const id of blockById.get(scene.id)?.event_ids ?? []) {
        const span = spanOf.get(id);
        if (span === undefined) continue;
        start = start === null ? span.start : Math.min(start, span.start);
        end = end === null ? span.end : Math.max(end, span.end);
      }
      if (start === null || end === null) continue;
      const context = contextAround(inputs.source.text, { start, end, resolution: 'exact' } as never);
      for (const [beatIndex, beat] of scene.required_beats.entries()) {
        if (inventionItems.length >= BEAT_SAMPLE) break;
        inventionItems.push({
          subject: `beat:${scene.id}#${beatIndex}`,
          claim: beat,
          quote: inputs.source.text.slice(start, Math.min(end, start + 400)),
          context,
        });
      }
    }
  }
  const inventionVerdicts =
    inventionItems.length === 0
      ? { verdicts: [], unjudged: [] }
      : await judgeSpanSupport(judge, inventionItems);

  const supported = inventionVerdicts.verdicts.filter((v) => v.verdict === 'supports').length;
  const insufficient = inventionVerdicts.verdicts.filter((v) => v.verdict === 'insufficient').length;
  const contradicted = inventionVerdicts.verdicts.filter((v) => v.verdict === 'contradicts').length;

  progress('§3.6 / §3.7 — aligning fact_refs');
  const fixtureFacts = new Set<string>();
  for (const scene of inputs.truth.package.scene_cards) {
    for (const fact of scene.reader_must_learn) fixtureFacts.add(fact);
    for (const fact of scene.must_stay_hidden) fixtureFacts.add(fact);
    for (const payoff of scene.pays_off) fixtureFacts.add(payoff.fact_ref);
  }
  // #153's sidecar facts go through the same alignment judge as the declared ones. Without this
  // the annotated pairs would be unalignable and score a guaranteed zero.
  for (const pair of inputs.truth.plant_annotation?.implicit ?? []) fixtureFacts.add(pair.fact_ref);
  const candidateFacts = new Set<string>();
  for (const scene of scenes) {
    for (const fact of scene.reader_must_learn) candidateFacts.add(fact);
    for (const fact of scene.must_stay_hidden) candidateFacts.add(fact);
    for (const payoff of scene.pays_off) candidateFacts.add(payoff.fact_ref);
  }

  const factMap = new Map<string, string>();
  if (fixtureFacts.size > 0 && candidateFacts.size > 0) {
    const judged = await judgeAlignment(
      judge,
      'fact_ref',
      [...fixtureFacts].map((fact) => ({ id: fact, name: fact.replace(/_/g, ' '), note: '' })),
      [...candidateFacts].map((fact) => ({ id: fact, name: fact.replace(/_/g, ' '), note: '' })),
    );
    for (const row of judged) {
      if (row.candidate_id !== null) factMap.set(row.fixture_id, row.candidate_id);
    }
  }

  const lint = lintPackage(inputs.candidate);
  const warningCounts: Record<string, number> = {};
  for (const warning of lint.warnings) {
    warningCounts[warning.code] = (warningCounts[warning.code] ?? 0) + 1;
  }

  const meanCoverage =
    perSceneCoverage.length === 0
      ? null
      : perSceneCoverage.reduce((sum, entry) => sum + entry.coverage, 0) / perSceneCoverage.length;
  const worst = [...perSceneCoverage].sort((a, b) => a.coverage - b.coverage)[0] ?? null;

  return {
    story_id: inputs.storyId,
    scored_at: new Date().toISOString(),
    fixture_package_version: inputs.truth.package_version,
    segmenter_models: inputs.segmenterModels,
    judge_model: judge.model,
    judge_cost_usd: judge.costUsd,
    g0: {
      bar: 'publishable === true (§1)',
      publishable: lint.publishable,
      errors: lint.errors,
      warning_counts: warningCounts,
    },
    scene_count: {
      fixture: inputs.truth.package.scene_cards.length,
      candidate: scenes.length,
      ratio: scenes.length / Math.max(1, inputs.truth.package.scene_cards.length),
      trustworthy_band:
        scenes.length / Math.max(1, inputs.truth.package.scene_cards.length) >= 0.5 &&
        scenes.length / Math.max(1, inputs.truth.package.scene_cards.length) <= 2.0,
    },
    scene_alignment: alignmentRows,
    boundaries,
    beats: {
      coverage_bar: '≥ 0.80 mean, no aligned scene below 0.5 (§3.5)',
      invention_bar: '≤ 0.10 (§3.5)',
      scored_scenes: perSceneCoverage.length,
      mean_coverage: meanCoverage,
      worst_scene: worst,
      scenes_below_half: perSceneCoverage.filter((e) => e.coverage < 0.5).map((e) => e.scene),
      sampled_beats: inventionVerdicts.verdicts.length,
      supported,
      insufficient,
      contradicted,
      invention_rate:
        inventionVerdicts.verdicts.length === 0
          ? null
          : (insufficient + contradicted) / inventionVerdicts.verdicts.length,
    },
    pov_location: povLocationScore(inputs.truth, alignmentRows, candidateById, entityAlignment),
    source_coverage: coverage,
    reveal_order: revealOrderScore(inputs.candidate, inputs.truth, factMap),
    plants: plantScore(inputs.candidate, inputs.truth, sceneMap, factMap),
    caveats: [
      '§2: the fixtures are one valid authoring, not the unique correct one — a deviation is not ' +
        'automatically an error, and both fixtures sit at the easy end of the difficulty range.',
      'The scene alignment is derived from #117\'s frozen event alignment; a fixture scene whose ' +
        'beats went unaligned there is unscoreable here and is listed with candidate_scene: null.',
      '§3.5 POV/location is agreement with the fixture, not a judgment against the source.',
      'Beat invention is judged against the source window the scene\'s own spans cover, so a beat ' +
        'supported elsewhere in the story reads as "insufficient" rather than "contradicts" — the ' +
        'two are reported separately for that reason.',
    ],
  };
}
