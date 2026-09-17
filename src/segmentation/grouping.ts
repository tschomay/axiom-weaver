/**
 * Turning boundary decisions into scene groups, and the two constraints a decision cannot break.
 *
 * `pass-boundaries.ts` decides, per adjacency, whether the story continues or a new scene starts.
 * That decision is a judgment and is allowed to be wrong. This module is where the judgments that
 * would destroy information get overruled — not by second-guessing the judgment, but by splitting
 * a group the judgment produced.
 *
 * ## Constraint 1: a merge may never swallow a plant into its own payoff
 *
 * #119 saw this coming and wrote it down before there was anywhere to fix it: *"a merge moves a
 * plant later at worst into the same scene as its payoff — which #118 will have to handle."*
 * `pays_off` edges at the Fabula layer name **event** ids, so segmentation has to rewrite each one
 * to the scene that swallowed the plant event. If the plant and the payoff land in the same scene,
 * the edge is no longer expressible: ADR 0004 requires the plant to *strictly* precede the payoff,
 * so the linter's `plant_after_payoff` fires and the package is unpublishable.
 *
 * There are two ways out and only one of them is honest. Dropping the edge keeps the package
 * lint-clean and quietly deletes the structure the Syuzhet layer exists to carry — a plant/payoff
 * pair is the one thing in an arc that is *about* the distance between two scenes. So the pair is
 * treated as a constraint on segmentation instead: a group containing both ends of a pair is split
 * at its strongest interior boundary signal, and the split is recorded as `forced_by_plant_span`.
 * A boundary nobody asked for is a smaller loss than an obligation nobody can see.
 *
 * ## Constraint 2: no scene may grow without bound
 *
 * A model asked "does the story continue here?" over a long event list can answer yes every time,
 * and the result — one Scene Card for a whole novel — would lint clean and be worthless. The cap
 * is a guardrail against a degenerate answer, not a target scene count: nothing here knows or
 * wants to know how many scenes the fixtures chose, because #120 runs the same code on generated
 * input where no fixture exists. Splits it forces are counted separately (`forced_by_size`) so a
 * run that hit the cap often is visibly a run whose boundary pass was not deciding anything.
 */

import type { FabulaEvent } from '../schema/fabula';
import type { Adjacency } from './signals';

/**
 * The guardrail, not a target.
 *
 * 40 is wide enough that neither fixture's own grain comes near it — the *Carol*'s 441-event
 * extraction at the fixture's 20 scenes averages 22 events per scene — and narrow enough that a
 * boundary pass which stopped deciding produces visibly wrong output instead of one giant scene.
 */
export const MAX_EVENTS_PER_SCENE = 40;

/** How strong a mechanical signal has to be to count as a boundary with no model in the loop. */
export const DEFAULT_BOUNDARY_THRESHOLD = 0.45;

export interface SceneGroup {
  /** Indices into the ordered event list, contiguous and ascending. */
  readonly event_indices: readonly number[];
  readonly forced_by_plant_span: boolean;
  readonly forced_by_size: boolean;
}

export interface GroupingReport {
  readonly groups: readonly SceneGroup[];
  readonly judged_boundaries: number;
  readonly forced_by_plant_span: number;
  readonly forced_by_size: number;
  /** Plant/payoff pairs that could not be separated because they sit on adjacent events. */
  readonly unseparable_plant_spans: ReadonlyArray<{ fact_ref: string; plant: string; payoff: string }>;
}

/**
 * The no-model fallback: a boundary wherever the mechanical evidence is strong enough.
 *
 * Deliberately available on its own. It is what a test runs, what a caller with no API key gets,
 * and — read next to the judged result — the measure of how much the judgment is actually adding.
 */
export function mechanicalBoundaries(
  adjacencies: readonly Adjacency[],
  threshold = DEFAULT_BOUNDARY_THRESHOLD,
): Set<number> {
  return new Set(
    adjacencies.filter((adjacency) => adjacency.score >= threshold).map((adjacency) => adjacency.index),
  );
}

function groupsFrom(eventCount: number, boundaries: ReadonlySet<number>): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  for (let index = 0; index < eventCount; index += 1) {
    current.push(index);
    if (boundaries.has(index) || index === eventCount - 1) {
      groups.push(current);
      current = [];
    }
  }
  return groups;
}

/** The adjacency inside `[from, to)` with the strongest mechanical evidence; ties go to the middle. */
function strongestInterior(
  adjacencies: readonly Adjacency[],
  from: number,
  to: number,
): number | null {
  let best: number | null = null;
  let bestScore = -1;
  const middle = (from + to - 1) / 2;
  for (let index = from; index < to; index += 1) {
    const adjacency = adjacencies[index];
    if (adjacency === undefined) continue;
    const tieBreak = -Math.abs(index - middle) / 1_000_000;
    const score = adjacency.score + tieBreak;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

/**
 * Apply the boundary decisions, then the two constraints, and report what each one cost.
 */
export function group(
  events: readonly FabulaEvent[],
  adjacencies: readonly Adjacency[],
  judged: ReadonlySet<number>,
  options: { maxEventsPerScene?: number } = {},
): GroupingReport {
  const cap = options.maxEventsPerScene ?? MAX_EVENTS_PER_SCENE;
  const boundaries = new Set(judged);
  const plantSpanForced = new Set<number>();
  const sizeForced = new Set<number>();
  const unseparable: Array<{ fact_ref: string; plant: string; payoff: string }> = [];

  const positionOf = new Map(events.map((event, index) => [event.id, index]));

  // --- Constraint 1: plant/payoff pairs ---------------------------------------------------
  //
  // Re-derived after each split, because splitting one group can leave another pair still
  // co-resident: the loop runs until no group holds both ends of any pair.
  for (let guard = 0; guard < events.length; guard += 1) {
    const groups = groupsFrom(events.length, boundaries);
    const groupOf = new Map<number, number>();
    groups.forEach((members, groupIndex) => {
      for (const member of members) groupOf.set(member, groupIndex);
    });

    let split = false;
    for (const payoffEvent of events) {
      const payoffAt = positionOf.get(payoffEvent.id);
      if (payoffAt === undefined) continue;
      for (const payoff of payoffEvent.pays_off) {
        if (payoff.plant === null) continue;
        const plantAt = positionOf.get(payoff.plant);
        // A `plant` naming no event at all is a defect of the input, not of the segmentation.
        // It survives into the Scene Card untouched and the linter reports it as
        // `plant_scene_unknown`, which is the truth about it.
        if (plantAt === undefined || plantAt >= payoffAt) continue;
        if (groupOf.get(plantAt) !== groupOf.get(payoffAt)) continue;

        const at = strongestInterior(adjacencies, plantAt, payoffAt);
        if (at === null) {
          unseparable.push({
            fact_ref: payoff.fact_ref,
            plant: payoff.plant,
            payoff: payoffEvent.id,
          });
          continue;
        }
        boundaries.add(at);
        plantSpanForced.add(at);
        split = true;
        break;
      }
      if (split) break;
    }
    if (!split) break;
  }

  // --- Constraint 2: the size guardrail ---------------------------------------------------
  for (let guard = 0; guard < events.length; guard += 1) {
    const groups = groupsFrom(events.length, boundaries);
    const oversized = groups.find((members) => members.length > cap);
    if (oversized === undefined) break;
    const first = oversized[0]!;
    const last = oversized[oversized.length - 1]!;
    const at = strongestInterior(adjacencies, first, last);
    if (at === null || boundaries.has(at)) break;
    boundaries.add(at);
    sizeForced.add(at);
  }

  const finalGroups = groupsFrom(events.length, boundaries).map((members) => {
    const closingBoundary = members[members.length - 1]!;
    return {
      event_indices: members,
      forced_by_plant_span: plantSpanForced.has(closingBoundary),
      forced_by_size: sizeForced.has(closingBoundary),
    };
  });

  return {
    groups: finalGroups,
    judged_boundaries: judged.size,
    forced_by_plant_span: plantSpanForced.size,
    forced_by_size: sizeForced.size,
    unseparable_plant_spans: unseparable,
  };
}
