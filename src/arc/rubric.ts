/**
 * The mechanical half of `docs/agents/story-authoring-eval.md` §4.1, scored over a generated arc.
 *
 * Every gate here either is `lintPackage` or sits explicitly next to it. Nothing in this module
 * re-implements plant validity: §1 of the rubric says "no orphaned payoffs, no unpaid plants" is
 * already the plant walk's four error codes plus `unpaid_fact`, and that a second implementation
 * is the wrong move. So `G0` is a call to `lintPackage` over the provisional projection, and the
 * rest are the things §4.1 names that the linter genuinely does not do.
 *
 * Two gates are promoted from warnings, exactly as §4.1 says to for generated arcs:
 * `no_required_beats` ("nothing else is holding a generated scene to anything") and `unpaid_fact`
 * (the ticket's own "no unpaid plants"). Both are warnings in `lintPackage` and stay warnings
 * there; the promotion is a property of *this* scoring pass, not a change to the linter.
 *
 * The plant-span histogram is deliberately not a gate and must not become one. It is the one
 * instrument that can see the failure `llm-arc-generation-prior-art.md` §6 accepts as the cost of
 * interleaved generation, and a gate would guarantee the number rather than improve the arc.
 */

import { lintPackage, type LintResult } from '../authoring/lint';
import { scenesInOrder, type StoryPackage } from '../schema/story-package';
import { seedKnownFacts } from '../plants/obligation-walk';
import {
  chainingCoverage,
  presenceProblems,
  stateChainingProblems,
  type ChainingProblem,
  type PresenceProblem,
} from './chaining';
import { eventsInOrder, provisionalPackage, type FabulaArc } from './fabula';

/**
 * The lexical mode-collapse canary (`llm-arc-generation-prior-art.md` §8).
 *
 * Hamilton & Mimno sampled 20,000 stories from four current models and found 11 words in 88.3% of
 * them. Checking for them costs nothing and catches collapse where it is cheapest to fix. A hit is
 * a flag to read, never a failure — a story genuinely about a lighthouse keeper is allowed.
 */
export const LEXICAL_CANARY = [
  'elias',
  'mara',
  'elara',
  'lighthouse',
  'clockmaker',
  'librarian',
  'whisper',
  'ember',
  'silas',
  'thorne',
  'cartographer',
] as const;

export interface PlantSpanRow {
  readonly fact_ref: string;
  readonly payoff_event: string;
  readonly plant_event: string | null;
  /** Events between plant and payoff. `null` for a seed-grounded payoff, which has no span. */
  readonly span: number | null;
}

export interface SpanHistogram {
  /** span → count, seed-grounded payoffs excluded (they have no span by construction). */
  readonly counts: Record<number, number>;
  readonly seed_grounded: number;
  readonly edges: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly min: number | null;
  readonly max: number | null;
  /** The number §6 cares about most: what fraction of edges are span 1. */
  readonly share_span_1: number | null;
}

export interface MechanicalScore {
  readonly story_id: string;
  readonly events: number;
  readonly g0: { passed: boolean; lint: LintResult };
  readonly payoff_reachability: { total: number; reachable: number; passed: boolean };
  readonly state_chaining: {
    problems: ChainingProblem[];
    coverage: { pairs: number; compared: number };
    /** True when nothing could be compared — a pass here means nothing (see `./chaining.ts`). */
    vacuous: boolean;
    passed: boolean;
  };
  /**
   * The Fabula-layer amnesia guard (see `./chaining.ts`). `gated` counts the two findings a
   * generated arc must not produce; `state_change_for_absentee` is reported and not gated, because
   * off-stage bookkeeping is sometimes exactly right.
   */
  readonly presence: { problems: PresenceProblem[]; gated: number; passed: boolean };
  readonly causal_reachability: {
    total: number;
    reachable: number;
    unreachable: string[];
    passed: boolean;
  };
  readonly required_beats: { scenes: number; empty: string[]; passed: boolean };
  readonly unpaid_facts: { facts: string[]; passed: boolean };
  readonly plant_spans: { rows: PlantSpanRow[]; histogram: SpanHistogram };
  readonly lexical_canary: string[];
  /** Every §4.1 gate, as one boolean. The histogram is excluded on purpose. */
  readonly all_gates_passed: boolean;
}

function histogram(rows: readonly PlantSpanRow[]): SpanHistogram {
  const spans = rows
    .map((row) => row.span)
    .filter((span): span is number => span !== null)
    .sort((a, b) => a - b);
  const counts: Record<number, number> = {};
  for (const span of spans) counts[span] = (counts[span] ?? 0) + 1;
  const middle = spans[Math.floor(spans.length / 2)];
  return {
    counts,
    seed_grounded: rows.length - spans.length,
    edges: rows.length,
    mean: spans.length === 0 ? null : spans.reduce((a, b) => a + b, 0) / spans.length,
    median: middle ?? null,
    min: spans[0] ?? null,
    max: spans[spans.length - 1] ?? null,
    share_span_1: spans.length === 0 ? null : (counts[1] ?? 0) / spans.length,
  };
}

/** The plant-span rows of any package — generated or human-authored, so fixtures calibrate too. */
export function plantSpans(pkg: StoryPackage): PlantSpanRow[] {
  const scenes = scenesInOrder(pkg);
  const orderById = new Map(scenes.map((scene) => [scene.id, scene.order]));
  const rows: PlantSpanRow[] = [];
  for (const scene of scenes) {
    for (const payoff of scene.pays_off) {
      const plantOrder = payoff.plant === null ? undefined : orderById.get(payoff.plant);
      rows.push({
        fact_ref: payoff.fact_ref,
        payoff_event: scene.id,
        plant_event: payoff.plant,
        span: plantOrder === undefined ? null : scene.order - plantOrder,
      });
    }
  }
  return rows;
}

export function spanHistogram(pkg: StoryPackage): SpanHistogram {
  return histogram(plantSpans(pkg));
}

/**
 * §4.1's causal-reachability proxy: from plant to payoff, is there a path through intermediate
 * scenes that share an entity or a location with both ends?
 *
 * The rubric calls this "a weak structural proxy for causality, and it is honest to call it that";
 * this implementation keeps that honesty and adds nothing. Scenes between plant and payoff are the
 * nodes; two nodes are adjacent when they share any character, object or location. A span-1 edge
 * is reachable when the two ends themselves share something.
 */
function causallyReachable(pkg: StoryPackage): {
  total: number;
  reachable: number;
  unreachable: string[];
} {
  const scenes = scenesInOrder(pkg);
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const touchesOf = (id: string): Set<string> => {
    const scene = byId.get(id);
    if (scene === undefined) return new Set();
    return new Set([scene.location_id, ...scene.characters_present, ...Object.keys(scene.exit_state)]);
  };
  const shares = (a: string, b: string): boolean => {
    const left = touchesOf(a);
    for (const item of touchesOf(b)) if (left.has(item)) return true;
    return false;
  };

  const unreachable: string[] = [];
  let total = 0;
  let reachable = 0;

  for (const scene of scenes) {
    for (const payoff of scene.pays_off) {
      if (payoff.plant === null) continue;
      const plant = byId.get(payoff.plant);
      if (plant === undefined) continue;
      total += 1;

      const window = scenes.filter(
        (candidate) => candidate.order >= plant.order && candidate.order <= scene.order,
      );
      const frontier = [plant.id];
      const seen = new Set(frontier);
      let found = false;
      while (frontier.length > 0) {
        const current = frontier.pop();
        if (current === undefined) continue;
        if (current === scene.id) {
          found = true;
          break;
        }
        for (const candidate of window) {
          if (seen.has(candidate.id)) continue;
          if (!shares(current, candidate.id)) continue;
          seen.add(candidate.id);
          frontier.push(candidate.id);
        }
      }
      if (found) reachable += 1;
      else unreachable.push(`${payoff.fact_ref} (${payoff.plant} → ${scene.id})`);
    }
  }

  return { total, reachable, unreachable };
}

function canaryHits(arc: FabulaArc): string[] {
  const haystack = JSON.stringify(arc).toLowerCase();
  return LEXICAL_CANARY.filter((word) => new RegExp(`\\b${word}`).test(haystack));
}

/** Score an arc against §4.1. The projection is what the linter sees; see `./fabula.ts`. */
export function scoreMechanical(arc: FabulaArc, storyId: string): MechanicalScore {
  const pkg = provisionalPackage(arc, storyId);
  const lint = lintPackage(pkg);
  const scenes = scenesInOrder(pkg);
  const seedFacts = seedKnownFacts(pkg);

  // Payoff reachability, re-asserted per §4.1 rather than assumed from G0.
  const declaredBy = new Map(scenes.map((scene) => [scene.id, new Set(scene.reader_must_learn)]));
  let payoffTotal = 0;
  let payoffReachable = 0;
  for (const scene of scenes) {
    for (const payoff of scene.pays_off) {
      payoffTotal += 1;
      const ok =
        payoff.plant === null
          ? seedFacts.has(payoff.fact_ref)
          : (declaredBy.get(payoff.plant)?.has(payoff.fact_ref) ?? false);
      if (ok) payoffReachable += 1;
    }
  }

  const chaining = stateChainingProblems(pkg);
  const coverage = chainingCoverage(pkg);
  const presence = presenceProblems(arc);
  const gatedPresence = presence.filter((problem) => problem.code !== 'state_change_for_absentee');
  const causal = causallyReachable(pkg);
  const emptyBeats = scenes.filter((scene) => scene.required_beats.length === 0).map((s) => s.id);
  const unpaid = [
    ...new Set(
      lint.warnings
        .filter((warning) => warning.code === 'unpaid_fact')
        .map((warning) => warning.message.replace(/^"(.*)" is shown.*$/, '$1')),
    ),
  ];
  const rows = plantSpans(pkg);

  const gates = [
    lint.publishable,
    payoffTotal === payoffReachable,
    chaining.length === 0,
    gatedPresence.length === 0,
    causal.total === causal.reachable,
    emptyBeats.length === 0,
    unpaid.length === 0,
  ];

  return {
    story_id: storyId,
    events: scenes.length,
    g0: { passed: lint.publishable, lint },
    payoff_reachability: {
      total: payoffTotal,
      reachable: payoffReachable,
      passed: payoffTotal === payoffReachable,
    },
    state_chaining: {
      problems: chaining,
      coverage,
      vacuous: coverage.compared === 0,
      passed: chaining.length === 0,
    },
    presence: {
      problems: presence,
      gated: gatedPresence.length,
      passed: gatedPresence.length === 0,
    },
    causal_reachability: { ...causal, passed: causal.total === causal.reachable },
    required_beats: { scenes: scenes.length, empty: emptyBeats, passed: emptyBeats.length === 0 },
    unpaid_facts: { facts: unpaid, passed: unpaid.length === 0 },
    plant_spans: { rows, histogram: histogram(rows) },
    lexical_canary: canaryHits(arc),
    all_gates_passed: gates.every(Boolean),
  };
}

// --- Cross-arc diversity ------------------------------------------------------------------

const STOPWORDS = new Set(
  ('a an and are as at be been but by for from had has have he her his in into is it its of on ' +
    'once or she that the their them there they this to was were what when where which who will ' +
    'with would his hers him not no nor so if then than about after before while during over ' +
    'under again more most other some such only own same too very can just now')
    .split(' '),
);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface DiversityScore {
  readonly arcs: number;
  /** Mean pairwise Jaccard over event-summary content words. Lower is more diverse. */
  readonly mean_pairwise_overlap: number;
  /** Mean pairwise Jaccard over cast/location *names*. The bluntest mode-collapse signal. */
  readonly mean_name_overlap: number;
  readonly shared_names: string[];
}

/**
 * Cross-arc diversity over N arcs from one configuration (§4.1's cross-arc check, via §8).
 *
 * MoPS measures Semantic Breadth and Density over embeddings; there is no embedding endpoint in
 * this repo's budget or its one adapter, so this is a **lexical** proxy and is labelled one. It
 * answers "are these ten arcs ten arcs" at the level of vocabulary and cast, which is the level
 * the documented collapse actually shows up at (11 words in 88.3% of 20,000 stories), and it does
 * not pretend to answer it at the level of structure.
 */
export function scoreDiversity(arcs: readonly FabulaArc[]): DiversityScore {
  const summaries = arcs.map((arc) =>
    contentWords(eventsInOrder(arc).map((event) => `${event.summary} ${event.beats.join(' ')}`).join(' ')),
  );
  const names = arcs.map(
    (arc) =>
      new Set(
        [
          ...arc.world_model_seed.characters.map((row) => row.name.toLowerCase()),
          ...arc.world_model_seed.locations.map((row) => row.name.toLowerCase()),
        ].flatMap((name) => name.split(/\s+/).filter((part) => part.length > 2)),
      ),
  );

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < arcs.length; i += 1) {
    for (let j = i + 1; j < arcs.length; j += 1) pairs.push([i, j]);
  }
  const mean = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

  const shared = new Set<string>();
  for (const [i, j] of pairs) {
    const left = names[i];
    const right = names[j];
    if (left === undefined || right === undefined) continue;
    for (const name of left) if (right.has(name)) shared.add(name);
  }

  return {
    arcs: arcs.length,
    mean_pairwise_overlap: mean(
      pairs.map(([i, j]) => jaccard(summaries[i] ?? new Set(), summaries[j] ?? new Set())),
    ),
    mean_name_overlap: mean(
      pairs.map(([i, j]) => jaccard(names[i] ?? new Set(), names[j] ?? new Set())),
    ),
    shared_names: [...shared].sort(),
  };
}
