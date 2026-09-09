/**
 * The plant-and-payoff obligation walk (ADR 0004).
 *
 * A reverse index, not a search: for every scene's `pays_off` entries, look up the named plant
 * scene and append an obligation to it. Fan-in falls out for free in both directions — several
 * later scenes may pay off one plant, and one payoff may name the same fact against several
 * plant scenes.
 *
 * The walk exists so the writer sees an *obligation*, never the payoff: the plant-side
 * instruction never names the scene that will collect it, which is what keeps the prose from
 * foreshadowing too loudly.
 */

import type { SceneCard, StoryPackage } from '../schema/story-package';
import { scenesInOrder } from '../schema/story-package';

/** ADR 0004 decision 4's three author-time errors. All hard failures, never silently patched. */
export const PLANT_WALK_ERRORS = [
  /** The named plant scene does not come strictly before the payoff scene. */
  'plant_after_payoff',
  /** The plant scene exists and precedes the payoff, but never declares the fact itself. */
  'plant_not_declared',
  /** A `plant: null` payoff whose fact is not actually seed-known. */
  'unfounded_seed_payoff',
  /** The `pays_off` entry names a scene id no Scene Card carries. */
  'plant_scene_unknown',
] as const;

export type PlantWalkErrorCode = (typeof PLANT_WALK_ERRORS)[number];

export interface PlantWalkError {
  readonly code: PlantWalkErrorCode;
  readonly fact_ref: string;
  /** The scene declaring the `pays_off` entry. */
  readonly payoff_scene_id: string;
  /** The scene it named as the plant, or `null` for a seed-grounded payoff. */
  readonly plant_scene_id: string | null;
  readonly message: string;
}

/** One thing a scene owes the reader: plant this fact, without dwelling on it. */
export interface PlantObligation {
  readonly fact_ref: string;
  /** The scene that must plant it. */
  readonly scene_id: string;
  readonly instruction: string;
}

export interface PlantWalk {
  /** Plant scene id to the obligations that scene owes. */
  readonly obligations: Map<string, PlantObligation[]>;
  readonly errors: PlantWalkError[];
}

/**
 * Turn a `fact_ref` slug into the phrase the instruction reads.
 *
 * ADR 0004 decision 5 makes this a naming-discipline dependency on the author: the instruction is
 * only as specific as the slug is descriptive (`loose_stair_rail`, not `fact_17`).
 */
export function deslug(factRef: string): string {
  return factRef.replace(/_/g, ' ');
}

/**
 * The plant-side instruction, templated from the `fact_ref` alone (ADR 0004 decision 5).
 *
 * Deliberately never names the payoff scene — that is what keeps it vague enough not to telegraph
 * while staying specific enough to act on.
 */
export function plantInstruction(factRef: string): string {
  return `make the reader register ${deslug(factRef)} without dwelling on it — a detail that passes by, not a flagged clue`;
}

/**
 * The payoff-side instruction (ADR 0012 decision 3).
 *
 * ADR 0004 templated only the plant side. The paying-off scene needs its own, symmetric
 * instruction — not to invent the resolution (the required beats usually already narrate it), but
 * to tell the writer which `fact_ref` to report in `payoffs_closed`, so the post-hoc obligation
 * check has something to verify against.
 */
export function payoffInstruction(factRef: string): string {
  return `this scene resolves ${deslug(factRef)} (planted earlier — you do not need to invent where) — report it in payoffs_closed once resolved`;
}

/** Facts known from the World Model seed: `character_knowledge` rows with no learning scene. */
export function seedKnownFacts(pkg: StoryPackage): Set<string> {
  const facts = new Set<string>();
  for (const row of pkg.world_model_seed.character_knowledge) {
    if (row.learned_at_scene === null) facts.add(row.fact_ref);
  }
  return facts;
}

/**
 * Walk every `pays_off` declaration backward into per-scene plant obligations.
 *
 * Runs before generation, not after (ADR 0004 decision 4) — all three errors are statically
 * checkable from Scene Cards alone, and rejecting here costs no tokens.
 */
export function walkPlantObligations(pkg: StoryPackage): PlantWalk {
  const scenes = scenesInOrder(pkg);
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const seedFacts = seedKnownFacts(pkg);

  const obligations = new Map<string, PlantObligation[]>();
  const errors: PlantWalkError[] = [];

  for (const payoffScene of scenes) {
    for (const payoff of payoffScene.pays_off) {
      const { fact_ref, plant } = payoff;

      // Seed-grounded: checked against seed-known facts, and creates no obligation, because
      // there is nothing to plant (ADR 0004 decision 3).
      if (plant === null) {
        if (!seedFacts.has(fact_ref)) {
          errors.push({
            code: 'unfounded_seed_payoff',
            fact_ref,
            payoff_scene_id: payoffScene.id,
            plant_scene_id: null,
            message: `"${payoffScene.id}" pays off "${fact_ref}" as seed-grounded, but no character_knowledge row establishes it before the story opens`,
          });
        }
        continue;
      }

      const plantScene = byId.get(plant);
      if (plantScene === undefined) {
        errors.push({
          code: 'plant_scene_unknown',
          fact_ref,
          payoff_scene_id: payoffScene.id,
          plant_scene_id: plant,
          message: `"${payoffScene.id}" names plant scene "${plant}", which no Scene Card carries`,
        });
        continue;
      }

      if (plantScene.order >= payoffScene.order) {
        errors.push({
          code: 'plant_after_payoff',
          fact_ref,
          payoff_scene_id: payoffScene.id,
          plant_scene_id: plant,
          message: `plant "${plant}" (order ${plantScene.order}) does not come before payoff "${payoffScene.id}" (order ${payoffScene.order})`,
        });
        continue;
      }

      // The compiler never invents where a plant lands: the plant scene must independently
      // declare the fact (ADR 0004 decision 2).
      if (!plantScene.reader_must_learn.includes(fact_ref)) {
        errors.push({
          code: 'plant_not_declared',
          fact_ref,
          payoff_scene_id: payoffScene.id,
          plant_scene_id: plant,
          message: `plant "${plant}" never lists "${fact_ref}" in its own reader_must_learn`,
        });
        continue;
      }

      const existing = obligations.get(plant) ?? [];
      // Fan-in: two payoffs of the same fact against the same plant scene are one obligation.
      if (!existing.some((entry) => entry.fact_ref === fact_ref)) {
        existing.push({
          fact_ref,
          scene_id: plant,
          instruction: plantInstruction(fact_ref),
        });
      }
      obligations.set(plant, existing);
    }
  }

  return { obligations, errors };
}

export function obligationsFor(walk: PlantWalk, scene: SceneCard): PlantObligation[] {
  return walk.obligations.get(scene.id) ?? [];
}

/** The payoff-side instructions a scene carries — one per `pays_off` entry it declares. */
export function payoffInstructionsFor(scene: SceneCard): PlantObligation[] {
  return scene.pays_off.map((payoff) => ({
    fact_ref: payoff.fact_ref,
    scene_id: scene.id,
    instruction: payoffInstruction(payoff.fact_ref),
  }));
}

/**
 * Post-generation verification: did an obligated scene actually plant what it owed?
 *
 * ADR 0004 decision 6 — this logs, it never blocks. Returns the `fact_ref`s that went missing;
 * the caller decides retry-versus-log by occasion, the same escalation every other mechanism on
 * this map uses.
 */
export function missedPlants(
  owed: readonly PlantObligation[],
  plantsOpened: readonly string[],
): string[] {
  const opened = new Set(plantsOpened);
  return owed.filter((entry) => !opened.has(entry.fact_ref)).map((entry) => entry.fact_ref);
}

/** The mirror check on the payoff side: which declared payoffs did the scene fail to close? */
export function missedPayoffs(scene: SceneCard, payoffsClosed: readonly string[]): string[] {
  const closed = new Set(payoffsClosed);
  return scene.pays_off.map((payoff) => payoff.fact_ref).filter((fact) => !closed.has(fact));
}
