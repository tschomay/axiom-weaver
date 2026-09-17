/**
 * Segmentation: a Fabula-only package in, a Story Package with real Scene Cards out.
 *
 * Issue #118, under the map issue #113. This is the shared entry point both upstream pipelines
 * feed — extraction (#117) from existing prose, generation (#119) from a premise — and #120's
 * whole claim is that it is *one* function, not two that happen to look alike. So the contract
 * here is narrow on purpose:
 *
 * - **In**: any object carrying a `_fabula` block, read through `readFabulaArc`
 *   (`src/schema/fabula.ts`). Only the fields ADR 0019 makes shared are required. Nothing reads
 *   source prose, nothing consults a fixture, and nothing assumes a correct answer exists — the
 *   three things that would make this work on extraction output and fail on generated input.
 * - **Out**: a plain object valid against `DraftStoryPackageSchema` *and* against the strict
 *   `StoryPackageSchema`, with `world_model_seed` and `scene_cards` both populated, plus a
 *   `_segmentation` block recording how each scene was drawn. Its landing path is the existing
 *   import escape hatch (`src/authoring/transfer.ts`, ADR 0017 §6) — not wired up here.
 *
 * ## The passes, and why there are four of them
 *
 * | Pass | Reads | Decides |
 * | --- | --- | --- |
 * | `signals` | the event list | mechanical evidence per adjacency — no model |
 * | `pass-boundaries` | overlapping windows of events | where scenes end |
 * | `pass-scene-cards` | one scene's events at a time | `pov`, `location_id`, `dramatic_function`, `required_beats` |
 * | `pass-plants` | the scene list | the plant/payoff graph and the told-ledger |
 *
 * ## Telling order, not chronology
 *
 * Everything below runs over the events in **Syuzhet order** — the order the story tells them —
 * taken from `narrated_index` where the input recorded one and falling back to the Fabula
 * `sequence` where it did not. `tellingOrder` in `signals.ts` carries the full argument; the short
 * version is that a Scene Card's `order` is the telling order, that is what a plant preceding its
 * payoff means, and segmenting *A Christmas Carol* chronologically both shreds the narration the
 * boundary pass is meant to read and makes the Stave IV withholding structurally inexpressible.
 *
 * `state.ts` runs between the last two with no model at all. The split follows
 * `docs/research/narrative-extraction-prior-art.md` §3.3 — boundaries and dramatic function "are
 * separate difficulties and should be separate passes" — and §10's general argument that the known
 * failure modes have mutually incompatible fixes, so no single call can be tuned against all of
 * them.
 *
 * ## Validation
 *
 * `lintPackage` — the real one, the one `publishManuscript` calls — runs on the assembled package
 * and its `LintResult` rides in the report. That is deliberate and is the whole difference between
 * this ticket's output and its inputs': a segmented package **is** a Story Package, so it is
 * checked by the one existing gate rather than by a projection, and ADR 0019's
 * `lintFabulaArc`/`FabulaProjectionLintResult` has no business here. No new lint entry point is
 * added by this module and none should be: a package that fails `lintPackage` is not publishable,
 * full stop, and there is nothing else for a second opinion to say.
 */

import { lintPackage, type LintResult } from '../authoring/lint';
import type { ExtractionModel, CallRecord } from '../extraction/call';
import {
  FABULA_BLOCK,
  eventsInOrder,
  readFabulaArc,
  storyIdOf,
  type FabulaArc,
  type FabulaEvent,
} from '../schema/fabula';
import { DraftStoryPackageSchema, type DraftStoryPackage } from '../schema/manuscript';
import {
  StoryPackageSchema,
  type SceneCard,
  type StoryPackage,
  type WorldModelSeed,
} from '../schema/story-package';
import { group, mechanicalBoundaries, type GroupingReport } from './grouping';
import {
  carryForward,
  findWithholding,
  proposePairs,
  unfoundedSeedPayoffs,
  verifyPairs,
  type PlantPair,
  type SceneSketch,
} from './pass-plants';
import { findBoundaries, type BoundaryPassResult } from './pass-boundaries';
import { describeScenes, draftScenes, type ScenePropertiesResult } from './pass-scene-cards';
import {
  adjacencies,
  signalAvailability,
  tellingOrder,
  type Adjacency,
  type SignalAvailability,
  type TellingOrder,
} from './signals';
import { replayStates, type StateReplayResult } from './state';

export const SEGMENTATION_BLOCK = '_segmentation';

/**
 * Scene-level fields segmentation had to stand in for, in the same spirit as ADR 0019 decision 4.
 *
 * A `pov` invented because no event in the scene named a character is not a recovered POV, and a
 * result that does not separate the two is not a measurement.
 */
export interface SegmentationSubstitutions {
  readonly pov_from_seed: number;
  readonly location_from_seed: number;
  readonly pov_from_candidates: number;
  readonly location_from_candidates: number;
  readonly beats_from_events: number;
}

export interface SegmentationReport {
  readonly story_id: string;
  readonly generator: string;
  /** Every model that actually answered. A capacity swap makes these differ from the request. */
  readonly models_used: readonly string[];
  readonly requested_model: string;
  readonly segmented_at: string;
  readonly cost_usd: number;
  readonly calls: readonly CallRecord[];
  readonly events: number;
  readonly scenes: number;
  readonly events_per_scene: number;
  readonly signals_available: SignalAvailability;
  /** Which order the scenes were drawn in, and how far it differs from chronology. */
  readonly telling_order: Omit<TellingOrder, 'events'>;
  readonly boundaries: Omit<BoundaryPassResult, 'boundaries'>;
  readonly grouping: Omit<GroupingReport, 'groups'>;
  readonly scene_properties: Omit<ScenePropertiesResult, 'scenes'>;
  readonly substitutions: SegmentationSubstitutions;
  readonly state: Omit<StateReplayResult, 'states'>;
  readonly plants: {
    readonly carried_from_fabula: number;
    readonly dangling_plants: number;
    readonly proposed: number;
    readonly rejected_malformed: number;
    readonly verified: number;
    readonly rejected_by_verifier: number;
    readonly unverified_dropped: number;
    readonly seed_grounded_unrepresentable: number;
    readonly failed_batches: number;
    readonly accepted: readonly PlantPair[];
  };
  readonly told_ledger: {
    readonly facts: number;
    readonly withheld_scene_entries: number;
    readonly rejected_out_of_range: number;
    readonly failed_batches: number;
  };
  /** The real linter on the real package. Not a projection, and not a second opinion. */
  readonly lint: LintResult;
  /**
   * Checks that a *derived* package satisfies by construction rather than by getting anything
   * right. Read a G0 pass against this list, not instead of it.
   */
  readonly vacuous_checks: readonly string[];
}

export interface SegmentationResult {
  readonly package: DraftStoryPackage;
  readonly report: SegmentationReport;
}

export interface SegmentOptions {
  readonly maxEventsPerScene?: number;
  readonly windowSize?: number;
  readonly overlap?: number;
  /** Skip the plant/payoff proposal pass and keep only what the Fabula layer already carried. */
  readonly skipPlantProposals?: boolean;
  readonly onProgress?: (message: string) => void;
}

/** Checks a derived package cannot fail, listed so a clean lint is read for what it is. */
export const VACUOUS_ON_DERIVED_PACKAGES: readonly string[] = [
  'entry_exit_contradiction — entry_state is derived from the same replay that produces ' +
    'exit_state (src/segmentation/state.ts), so consecutive scenes agree by construction',
  'plant_not_declared — every accepted plant/payoff pair writes its fact into the plant scene\'s ' +
    'own reader_must_learn as it is applied',
  'unpaid_fact — reader_must_learn is populated only from facts that some scene pays off',
];

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function seedTables(seed: WorldModelSeed): {
  characters: Set<string>;
  locations: Set<string>;
} {
  return {
    characters: new Set(seed.characters.map((row) => row.id)),
    locations: new Set(seed.locations.map((row) => row.id)),
  };
}

/**
 * Assemble Scene Cards from a grouping and the per-scene answers. No model, no I/O.
 *
 * Split out so the shape of a Scene Card is decided in one readable place, and so a test can
 * exercise the whole assembly — including every substitution — without a network call.
 */
export function assembleScenes(
  arc: FabulaArc,
  grouped: ReadonlyArray<readonly FabulaEvent[]>,
  properties: ScenePropertiesResult,
  states: StateReplayResult,
): { scenes: SceneCard[]; substitutions: SegmentationSubstitutions } {
  const { characters, locations } = seedTables(arc.world_model_seed);
  const seedCharacter = arc.world_model_seed.characters[0]?.id ?? '';
  const seedLocation = arc.world_model_seed.locations[0]?.id ?? '';

  const substitutions = {
    pov_from_seed: 0,
    location_from_seed: 0,
    pov_from_candidates: properties.pov_fallbacks,
    location_from_candidates: properties.location_fallbacks,
    beats_from_events: properties.beat_fallbacks,
  };

  let lastPov = '';
  let lastLocation = '';

  const scenes = grouped.map((events, index): SceneCard => {
    const props = properties.scenes[index]!;
    const present: string[] = [];
    for (const event of events) {
      for (const id of event.characters_present) {
        if (characters.has(id) && !present.includes(id)) present.push(id);
      }
    }

    let pov = characters.has(props.pov) ? props.pov : '';
    if (pov === '') {
      // Nobody the seed knows is in this scene at all. Carrying the previous scene's POV forward
      // is the same deterministic, counted substitution ADR 0019 decision 4 makes for the
      // projection — a scene with no cast is a real finding about the event list, not a licence
      // to invent an entity.
      pov = characters.has(lastPov) ? lastPov : seedCharacter;
      substitutions.pov_from_seed += 1;
    }
    if (pov !== '' && !present.includes(pov)) present.push(pov);
    lastPov = pov;

    let location = locations.has(props.location_id) ? props.location_id : '';
    if (location === '') {
      location = locations.has(lastLocation) ? lastLocation : seedLocation;
      substitutions.location_from_seed += 1;
    }
    lastLocation = location;

    const state = states.states[index] ?? { entry_state: {}, exit_state: {} };

    return {
      id: props.id,
      order: index + 1,
      pov,
      location_id: location,
      characters_present: present,
      dramatic_function: props.dramatic_function,
      entry_state: state.entry_state,
      exit_state: state.exit_state,
      required_beats: [...props.required_beats],
      reader_must_learn: [],
      must_stay_hidden: [],
      force_reintroduce: [],
      invariants: [],
      pays_off: [],
    };
  });

  return { scenes, substitutions };
}

/**
 * Apply a plant/payoff graph to assembled scenes.
 *
 * ADR 0004's rules are enforced here, before the linter runs, so every rejection is a counted
 * decision rather than a lint error a caller has to interpret. What survives: a plant scene that
 * exists and strictly precedes, a `plant: null` that the seed genuinely grounds. Applying a pair
 * writes the fact into the plant scene's own `reader_must_learn`, which is not flattery of the
 * linter but the definition — a scene that plants a fact for the reader is a scene the reader
 * learns it in (research §4.7: the told-ledger is derived from Scene Cards, never read off prose).
 */
export function applyPlantGraph(
  scenes: SceneCard[],
  pairs: readonly PlantPair[],
  seedFacts: ReadonlySet<string>,
): { applied: PlantPair[]; unrepresentable: PlantPair[] } {
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const applied: PlantPair[] = [];
  const unrepresentable: PlantPair[] = [];

  for (const pair of pairs) {
    const payoffScene = byId.get(pair.payoff);
    if (payoffScene === undefined) {
      unrepresentable.push(pair);
      continue;
    }
    if (pair.plant === null) {
      if (!seedFacts.has(pair.fact_ref)) {
        unrepresentable.push(pair);
        continue;
      }
      payoffScene.pays_off.push({ fact_ref: pair.fact_ref, plant: null });
      applied.push(pair);
      continue;
    }
    const plantScene = byId.get(pair.plant);
    if (plantScene === undefined || plantScene.order >= payoffScene.order) {
      unrepresentable.push(pair);
      continue;
    }
    if (!plantScene.reader_must_learn.includes(pair.fact_ref)) {
      plantScene.reader_must_learn.push(pair.fact_ref);
    }
    if (!payoffScene.pays_off.some((entry) => entry.fact_ref === pair.fact_ref)) {
      payoffScene.pays_off.push({ fact_ref: pair.fact_ref, plant: pair.plant });
    }
    applied.push(pair);
  }

  return { applied, unrepresentable };
}

export async function segmentFabulaPackage(
  envelope: unknown,
  model: ExtractionModel,
  options: SegmentOptions = {},
): Promise<SegmentationResult> {
  const startedAt = new Date().toISOString();
  const progress = options.onProgress ?? ((): void => {});
  const storyId = storyIdOf(envelope);
  const { arc } = readFabulaArc(envelope);
  const telling = tellingOrder(eventsInOrder(arc));
  const events = [...telling.events];
  const gaps = adjacencies(events);

  progress(
    `${events.length} Fabula events, ${gaps.length} adjacencies, drawn in ${telling.basis} order` +
      (telling.displaced === 0 ? '' : ` (${telling.displaced} events displaced from chronology)`),
  );

  progress('pass 1/4 — scene boundaries');
  const boundaries = await findBoundaries(model, events, gaps, {
    windowSize: options.windowSize,
    overlap: options.overlap,
    onProgress: progress,
  });

  const grouping = group(events, gaps, boundaries.boundaries, {
    maxEventsPerScene: options.maxEventsPerScene,
  });
  const grouped = grouping.groups.map((scene) => scene.event_indices.map((at) => events[at]!));
  progress(
    `      ${grouped.length} scenes (${grouping.forced_by_plant_span} splits forced by a plant span, ` +
      `${grouping.forced_by_size} by the size guardrail)`,
  );

  progress('pass 2/4 — scene properties');
  const drafts = draftScenes(grouped, arc.world_model_seed);
  const properties = await describeScenes(model, drafts, arc.world_model_seed, {
    onProgress: progress,
  });

  progress('pass 3/4 — entry/exit state replay (no model)');
  const states = replayStates(arc.world_model_seed, grouped);

  const { scenes, substitutions } = assembleScenes(arc, grouped, properties, states);

  progress('pass 4/4 — plant/payoff graph and told-ledger');
  const carried = carryForward(
    scenes.map((scene, index) => ({ id: scene.id, events: grouped[index]! })),
  );
  const carriedPairs: PlantPair[] = [];
  for (const [sceneId, entries] of carried.paysOff) {
    for (const entry of entries) {
      carriedPairs.push({
        fact_ref: entry.fact_ref,
        plant: entry.plant,
        payoff: sceneId,
        why: 'carried forward from the Fabula layer',
        type: '',
      });
    }
  }
  for (const scene of scenes) {
    const revealed = carried.reveals.get(scene.id) ?? [];
    for (const fact of revealed) {
      if (!scene.reader_must_learn.includes(fact)) scene.reader_must_learn.push(fact);
    }
    const hidden = carried.conceals.get(scene.id) ?? [];
    for (const fact of hidden) {
      if (!scene.must_stay_hidden.includes(fact)) scene.must_stay_hidden.push(fact);
    }
  }

  const sketches: SceneSketch[] = scenes.map((scene) => ({
    id: scene.id,
    order: scene.order,
    dramatic_function: scene.dramatic_function,
    required_beats: scene.required_beats,
  }));

  let proposed = 0;
  let malformed = 0;
  let rejectedByVerifier = 0;
  let unverifiedDropped = 0;
  let plantFailedBatches = 0;
  let verifiedPairs: PlantPair[] = [];

  if (options.skipPlantProposals !== true) {
    const proposals = await proposePairs(model, sketches, { onProgress: progress });
    proposed = proposals.pairs.length;
    malformed = proposals.rejected_malformed;
    plantFailedBatches += proposals.failed_batches;

    // Anything the Fabula layer already asserted is not re-proposed: a generated arc's own graph
    // is authored, not inferred, and putting it through a verifier would be second-guessing the
    // entry point rather than deriving anything.
    const alreadyKnown = new Set(carriedPairs.map((pair) => pair.fact_ref));
    const fresh = proposals.pairs.filter((pair) => !alreadyKnown.has(pair.fact_ref));

    const verified = await verifyPairs(model, fresh, sketches, { onProgress: progress });
    plantFailedBatches += verified.failed_batches;
    rejectedByVerifier = verified.rejected.length;
    // An unverified pair is dropped, not kept: §4.6's pipeline is identify-verify-filter, and a
    // proposal nobody checked is the stage before evidence.
    unverifiedDropped = verified.unverified.length;
    verifiedPairs = [...verified.accepted];
  }

  const seedFacts = new Set(
    arc.world_model_seed.character_knowledge
      .filter((row) => row.learned_at_scene === null)
      .map((row) => row.fact_ref),
  );
  const { applied, unrepresentable } = applyPlantGraph(
    scenes,
    [...carriedPairs, ...verifiedPairs],
    seedFacts,
  );

  const revealedAt = new Map<string, string>();
  for (const scene of scenes) {
    for (const fact of scene.reader_must_learn) {
      if (!revealedAt.has(fact)) revealedAt.set(fact, scene.id);
    }
  }

  const withholding =
    options.skipPlantProposals === true || revealedAt.size === 0
      ? { hidden: new Map<string, string[]>(), failed_batches: 0, rejected_out_of_range: 0 }
      : await findWithholding(model, revealedAt, sketches, { onProgress: progress });

  let withheldEntries = 0;
  for (const scene of scenes) {
    for (const fact of withholding.hidden.get(scene.id) ?? []) {
      if (!scene.must_stay_hidden.includes(fact)) {
        scene.must_stay_hidden.push(fact);
        withheldEntries += 1;
      }
    }
  }

  const finishedAt = new Date().toISOString();

  const candidate: StoryPackage = {
    schema_version: '1.0',
    package_version: 1,
    story_id: storyId,
    world_model_seed: arc.world_model_seed,
    scene_cards: scenes,
    voice_card: {},
    metadata: {
      title: arc.title,
      source: `segmented from a Fabula-only package by ${model.model}`,
      created_at: finishedAt,
    },
  };

  const lint = lintPackage(candidate);

  const draft = DraftStoryPackageSchema.parse({
    ...candidate,
    // The Fabula layer rides along untouched, so a segmented package can be re-segmented with
    // different settings and #120 can compare two runs over the same events.
    [FABULA_BLOCK]: (envelope as Record<string, unknown> | null)?.[FABULA_BLOCK] ?? null,
    [SEGMENTATION_BLOCK]: {
      segmenter: 'segmentation pipeline (#118)',
      model: model.modelsUsed.join(', '),
      segmented_at: finishedAt,
      started_at: startedAt,
      scenes: scenes.map((scene, index) => ({
        id: scene.id,
        order: scene.order,
        event_ids: grouped[index]!.map((event) => event.id),
        forced_by_plant_span: grouping.groups[index]?.forced_by_plant_span ?? false,
        forced_by_size: grouping.groups[index]?.forced_by_size ?? false,
      })),
      vacuous_checks: VACUOUS_ON_DERIVED_PACKAGES,
    },
  }) as DraftStoryPackage;

  // The report carries every diagnostic and none of the bulk: the boundary set, the groups, the
  // per-scene answers and the replayed states are all already visible in the package itself.
  const boundaryReport = omit(boundaries, 'boundaries');
  const groupingReport = omit(grouping, 'groups');
  const propertiesReport = omit(properties, 'scenes');
  const stateReport = omit(states, 'states');

  return {
    package: draft,
    report: {
      story_id: storyId,
      generator: 'segmentation pipeline (#118)',
      models_used: model.modelsUsed,
      requested_model: model.model,
      segmented_at: finishedAt,
      cost_usd: model.costUsd,
      calls: model.calls,
      events: events.length,
      scenes: scenes.length,
      events_per_scene: scenes.length === 0 ? 0 : events.length / scenes.length,
      signals_available: signalAvailability(events),
      telling_order: omit(telling, 'events'),
      boundaries: boundaryReport,
      grouping: groupingReport,
      scene_properties: propertiesReport,
      substitutions,
      state: stateReport,
      plants: {
        carried_from_fabula: carriedPairs.length,
        dangling_plants: carried.dangling_plants,
        proposed,
        rejected_malformed: malformed,
        verified: verifiedPairs.length,
        rejected_by_verifier: rejectedByVerifier,
        unverified_dropped: unverifiedDropped,
        seed_grounded_unrepresentable: unrepresentable.length,
        failed_batches: plantFailedBatches,
        accepted: applied,
      },
      told_ledger: {
        facts: revealedAt.size,
        withheld_scene_entries: withheldEntries,
        rejected_out_of_range: withholding.rejected_out_of_range,
        failed_batches: withholding.failed_batches,
      },
      lint,
      vacuous_checks: VACUOUS_ON_DERIVED_PACKAGES,
    },
  };
}

/**
 * The no-model path: boundaries from the mechanical signals alone.
 *
 * Not a shortcut and not the deliverable — it is the baseline the judged pass has to beat, and the
 * only way to exercise grouping, the state replay and assembly in a test without a network call.
 */
export function segmentMechanically(
  envelope: unknown,
  options: { maxEventsPerScene?: number; threshold?: number } = {},
): { package: StoryPackage; grouping: GroupingReport; lint: LintResult } {
  const storyId = storyIdOf(envelope);
  const { arc } = readFabulaArc(envelope);
  const events = [...tellingOrder(eventsInOrder(arc)).events];
  const gaps = adjacencies(events);
  const grouping = group(events, gaps, mechanicalBoundaries(gaps, options.threshold), {
    maxEventsPerScene: options.maxEventsPerScene,
  });
  const grouped = grouping.groups.map((scene) => scene.event_indices.map((at) => events[at]!));
  const drafts = draftScenes(grouped, arc.world_model_seed);

  const properties: ScenePropertiesResult = {
    scenes: drafts.map((draft) => ({
      order: draft.order,
      id: `scene_${String(draft.order).padStart(2, '0')}`,
      pov: draft.candidate_characters[0] ?? '',
      location_id: draft.candidate_locations[0] ?? '',
      dramatic_function: draft.events[0]?.summary ?? 'unspecified',
      required_beats: [...new Set(draft.events.flatMap((event) => event.beats))],
      pov_from_fallback: true,
      location_from_fallback: true,
      beats_from_fallback: true,
    })),
    failed_batches: 0,
    pov_fallbacks: drafts.length,
    location_fallbacks: drafts.length,
    location_inherited: drafts.filter((draft) => draft.location_inherited).length,
    beat_fallbacks: drafts.length,
    function_fallbacks: drafts.length,
  };

  const states = replayStates(arc.world_model_seed, grouped);
  const { scenes } = assembleScenes(arc, grouped, properties, states);

  const carried = carryForward(
    scenes.map((scene, index) => ({ id: scene.id, events: grouped[index]! })),
  );
  const pairs: PlantPair[] = [];
  for (const [sceneId, entries] of carried.paysOff) {
    for (const entry of entries) {
      pairs.push({ fact_ref: entry.fact_ref, plant: entry.plant, payoff: sceneId, why: 'carried', type: '' });
    }
  }
  for (const scene of scenes) {
    for (const fact of carried.reveals.get(scene.id) ?? []) {
      if (!scene.reader_must_learn.includes(fact)) scene.reader_must_learn.push(fact);
    }
    for (const fact of carried.conceals.get(scene.id) ?? []) {
      if (!scene.must_stay_hidden.includes(fact)) scene.must_stay_hidden.push(fact);
    }
  }
  const seedFacts = new Set(
    arc.world_model_seed.character_knowledge
      .filter((row) => row.learned_at_scene === null)
      .map((row) => row.fact_ref),
  );
  applyPlantGraph(scenes, pairs, seedFacts);

  const pkg = StoryPackageSchema.parse({
    schema_version: '1.0',
    package_version: 1,
    story_id: storyId,
    world_model_seed: arc.world_model_seed,
    scene_cards: scenes,
    voice_card: {},
    metadata: { title: arc.title },
  }) as StoryPackage;

  return { package: pkg, grouping, lint: lintPackage(pkg) };
}

/** Facts a package's `pays_off` entries claim are seed-grounded but the seed does not carry. */
export { unfoundedSeedPayoffs };

export type { Adjacency };
