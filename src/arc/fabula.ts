/**
 * The Fabula arc: a World Model seed plus a chronological event list, and the two things you can
 * turn it into.
 *
 * Issue #119's deliverable is *Fabula only* — `world_model_seed` populated, `scene_cards` empty,
 * valid against `DraftStoryPackageSchema` — because segmentation into Scene Cards is #118's job
 * and both entry points are meant to share it. That leaves one problem this module solves rather
 * than working around:
 *
 * **A `scene_cards: []` package cannot be linted.** `StoryPackageSchema` requires at least one
 * Scene Card, and `lintPackage` is where the plant-obligation walk (ADR 0004) lives — so the very
 * validator the eval rubric makes gate G0 refuses to look at the shape we are contracted to emit.
 * `provisionalPackage` closes that: it projects each Fabula event onto one provisional Scene Card
 * so the *real* linter rules on the *real* graph, rather than this prototype writing a second
 * opinion about plant validity that `story-authoring-eval.md` §1 explicitly forbids ("Do not write
 * a second one — cite these"). The projection is a measuring instrument and is never the
 * deliverable; `draftPackage` emits the deliverable.
 *
 * One-event-to-one-scene is the projection that preserves the graph exactly: `pays_off` edges name
 * event ids, event order is scene order, and segmentation downstream can only ever merge events,
 * which cannot turn a valid plant into an invalid one (a merge moves a plant later at worst into
 * the same scene as its payoff — which #118 will have to handle, and which is worth saying out
 * loud here rather than discovering there).
 */

import { z } from 'zod';

import {
  WorldModelSeedSchema,
  type SceneCard,
  type SceneState,
  type StoryPackage,
} from '../schema/story-package';
import type { ArcBrief } from './brief';

const slug = z.string().min(1);

/**
 * The World Model columns a Fabula event may change.
 *
 * Deliberately a closed enum rather than free text. `src/schema/tiers.ts` is the authority on what
 * columns exist, and the cross-reference pass rejects anything else with `unknown_column`; naming
 * the three that carry a tier and matter at this layer keeps the response schema lean (it is
 * billed as input on every call and is not cacheable) and removes a whole class of repair.
 */
export const EVENT_STATE_COLUMNS = ['location_id', 'status', 'goal'] as const;
export type EventStateColumn = (typeof EVENT_STATE_COLUMNS)[number];

export const StateChangeSchema = z.object({
  entity_id: slug,
  column: z.enum(EVENT_STATE_COLUMNS),
  value: z.union([z.string(), z.null()]),
});

export const FabulaPayoffSchema = z.object({
  fact_ref: z.string().min(1),
  /** The event that plants it, or `null` for a fact true from the World Model seed. */
  plant: slug.nullable(),
});

/**
 * One event of the Fabula, in chronological order.
 *
 * `caused_by` has no counterpart in the Story Package schema and is not smuggled toward one: it
 * exists because `docs/research/llm-arc-generation-prior-art.md` §3 reports that models decide
 * narrative causality by positional shortcut unless the causal graph is made an explicit object,
 * and because §4.2 of the rubric judges causal follow-through. It rides along in the deliverable's
 * `_fabula` block, where #118 can use it or ignore it.
 */
export const FabulaEventSchema = z.object({
  id: slug,
  /** Chronological position, 1-based. Fabula order, not told order. */
  sequence: z.number().int().positive(),
  summary: z.string().min(1),
  pov: slug,
  location_id: slug,
  characters_present: z.array(slug),
  dramatic_function: z.string().min(1),
  /** What must happen. Becomes `required_beats` downstream; never empty (rubric §4.1). */
  beats: z.array(z.string()).default([]),
  /** Earlier event ids this one follows *from*, not merely after. */
  caused_by: z.array(slug).default([]),
  /** `fact_ref`s the reader learns here. Becomes `reader_must_learn`. */
  reveals: z.array(z.string()).default([]),
  /** `fact_ref`s deliberately withheld here. Becomes `must_stay_hidden`. */
  conceals: z.array(z.string()).default([]),
  pays_off: z.array(FabulaPayoffSchema).default([]),
  state_changes: z.array(StateChangeSchema).default([]),
});

export const FabulaArcSchema = z.object({
  title: z.string().min(1),
  world_model_seed: WorldModelSeedSchema,
  events: z.array(FabulaEventSchema).min(1),
});

export type StateChange = z.infer<typeof StateChangeSchema>;
export type FabulaEvent = z.infer<typeof FabulaEventSchema>;
export type FabulaArc = z.infer<typeof FabulaArcSchema>;

/** Events in Fabula order. `sequence` is the field; array position is incidental. */
export function eventsInOrder(arc: FabulaArc): FabulaEvent[] {
  return [...arc.events].sort((a, b) => a.sequence - b.sequence);
}

/** Collapse an event's `state_changes` into the `exit_state` block a Scene Card carries. */
export function exitStateFor(event: FabulaEvent): SceneState {
  const state: Record<string, Record<string, string | null>> = {};
  for (const change of event.state_changes) {
    const row = state[change.entity_id] ?? {};
    row[change.column] = change.value;
    state[change.entity_id] = row;
  }
  return state as SceneState;
}

/**
 * Project the arc onto a Story Package whose Scene Cards are one-per-event.
 *
 * The measuring instrument, not the deliverable. Everything `lintPackage` needs is here and
 * nothing that would flatter it is: `required_beats` is the event's own beats (so
 * `no_required_beats` still fires on an empty one), `reader_must_learn` is the event's own
 * reveals (so `plant_not_declared` still fires), and `voice_card` is left `{}` rather than filled
 * with a preset — a Fabula-layer deliverable has no Voice Card, and `voice_card_untouched` firing
 * is the truth about it.
 */
export function provisionalPackage(arc: FabulaArc, storyId: string): StoryPackage {
  const scenes: SceneCard[] = eventsInOrder(arc).map((event) => ({
    id: event.id,
    order: event.sequence,
    pov: event.pov,
    location_id: event.location_id,
    characters_present: event.characters_present,
    dramatic_function: event.dramatic_function,
    entry_state: {},
    exit_state: exitStateFor(event),
    required_beats: event.beats,
    reader_must_learn: event.reveals,
    must_stay_hidden: event.conceals,
    force_reintroduce: [],
    invariants: [],
    pays_off: event.pays_off.map((payoff) => ({ ...payoff })),
  }));

  return {
    schema_version: '1.0',
    package_version: 1,
    story_id: storyId,
    world_model_seed: arc.world_model_seed,
    scene_cards: scenes,
    voice_card: {},
    metadata: { title: arc.title },
  };
}

/** Where the event list rides in the deliverable. A top-level block the loose schema preserves. */
export const FABULA_BLOCK = '_fabula';

export interface FabulaBlock {
  readonly generator: string;
  /** The model that produced the arc. A result that does not say this is not a measurement. */
  readonly model: string;
  readonly generated_at: string;
  readonly brief: ArcBrief;
  readonly events: FabulaEvent[];
  /** Atomic repairs applied after the first pass, in order. Empty when the arc linted clean. */
  readonly repairs: string[];
}

/**
 * The deliverable: `world_model_seed` populated, `scene_cards` empty, event list carried alongside.
 *
 * `DraftStoryPackageSchema` is a `looseObject` exactly so a package can hold blocks the schema has
 * never heard of — both long fixtures carry `_authoring_conventions` the same way, and
 * `src/authoring/transfer.ts` reports them as `extra_blocks` rather than dropping them. That is
 * the seam the event list uses, so #120 can hand this object straight to #118's segmentation
 * without a second file format existing.
 */
export function draftPackage(
  arc: FabulaArc,
  storyId: string,
  block: Omit<FabulaBlock, 'events'>,
): Record<string, unknown> {
  return {
    schema_version: '1.0',
    package_version: 1,
    story_id: storyId,
    world_model_seed: arc.world_model_seed,
    scene_cards: [],
    voice_card: {},
    metadata: {
      title: arc.title,
      source: `original arc generated by ${block.generator} (${block.model})`,
      created_at: block.generated_at,
    },
    [FABULA_BLOCK]: { ...block, events: eventsInOrder(arc) },
  };
}
