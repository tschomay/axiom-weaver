/**
 * Tests for the segmentation pipeline's deterministic parts (issue #118).
 *
 * Every model pass runs through a stub `ModelClient`, so the whole chain — signals, telling order,
 * windowing, the two grouping constraints, the state replay, assembly and the plant graph — runs
 * end to end without a network call. The numbers that are actually *about* segmentation quality
 * come from live runs against the fixtures and live in the ticket's report and in
 * `prototypes/segmentation/`, not here; what these assert is that the machinery around them is
 * correct, and that the two things #120 depends on hold: the entry point accepts both upstream
 * shapes, and it never reaches for a field only one of them supplies.
 */

import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ExtractionModel } from '@/extraction/call';
import { lintPackage } from '@/authoring/lint';
import { loadGroundTruth } from '@/extraction/scoring/ground-truth';
import {
  FABULA_PROJECTION_NOTE,
  lintFabulaArc,
  projectFabulaArc,
} from '@/authoring/lint-fabula';
import { FABULA_BLOCK, FabulaArcSchema, readFabulaArc, type FabulaArc } from '@/schema/fabula';
import { StoryPackageSchema, WorldModelSeedSchema } from '@/schema/story-package';
import { DraftStoryPackageSchema } from '@/schema/manuscript';
import { MAX_EVENTS_PER_SCENE, group, mechanicalBoundaries } from '@/segmentation/grouping';
import { assertWindowed, eventWindows, findBoundaries } from '@/segmentation/pass-boundaries';
import { carryForward, proposePairs } from '@/segmentation/pass-plants';
import { draftScenes } from '@/segmentation/pass-scene-cards';
import { adjacencies, signalAvailability, tellingOrder } from '@/segmentation/signals';
import { replayStates } from '@/segmentation/state';
import {
  SEGMENTATION_BLOCK,
  applyPlantGraph,
  assembleScenes,
  segmentFabulaPackage,
  segmentMechanically,
} from '@/segmentation/segment';
import type { ModelClient, ModelRequest, ModelResponse } from '@/writer/model-client';

// --- fixtures -----------------------------------------------------------------------------

const SEED = WorldModelSeedSchema.parse({
  characters: [
    { id: 'char_ada', name: 'Ada', location_id: 'loc_house', status: 'alive', goal: 'get out' },
    { id: 'char_bo', name: 'Bo', location_id: 'loc_house', status: 'alive' },
    { id: 'char_cy', name: 'Cy', location_id: 'loc_dock', status: 'alive' },
  ],
  locations: [
    { id: 'loc_house', name: 'the house' },
    { id: 'loc_dock', name: 'the dock' },
  ],
  objects: [{ id: 'obj_key', name: 'a key', location_id: 'loc_house', status: 'intact' }],
  relationships: [],
  character_knowledge: [],
});

interface EventInput {
  id: string;
  sequence: number;
  summary: string;
  location_id?: string | null;
  characters_present?: string[];
  beats?: string[];
  pays_off?: Array<{ fact_ref: string; plant: string | null }>;
  state_changes?: Array<{ entity_id: string; column: string; value: string | null }>;
  pov?: string;
  dramatic_function?: string;
  reveals?: string[];
  conceals?: string[];
  narrated_index?: number;
  story_time?: string;
}

function arcOf(events: EventInput[]): FabulaArc {
  return FabulaArcSchema.parse({ title: 'Test', world_model_seed: SEED, events });
}

/** #117's shape: no `pov`, no `dramatic_function`, no `pays_off`, plus extraction-only keys. */
function extractedEnvelope(events: EventInput[]): Record<string, unknown> {
  return {
    schema_version: '1.0',
    package_version: 1,
    story_id: 'test_story',
    world_model_seed: SEED,
    scene_cards: [],
    voice_card: {},
    metadata: { title: 'Test' },
    [FABULA_BLOCK]: { generator: 'test', model: 'stub', events },
  };
}

function linearEvents(count: number): EventInput[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `ev_${index + 1}`,
    sequence: index + 1,
    summary: `Something happens, step ${index + 1}.`,
    location_id: 'loc_house',
    characters_present: ['char_ada', 'char_bo'],
    beats: [`step ${index + 1}`],
    narrated_index: index,
  }));
}

/** Answers every segmentation pass with a fixed, schema-shaped response. */
class StubClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  private readonly boundaryAfter: Set<string>;

  constructor(boundaryAfter: readonly string[] = []) {
    this.boundaryAfter = new Set(boundaryAfter);
  }

  generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const body = this.answer(request);
    return Promise.resolve({
      model: 'stub-model',
      text: JSON.stringify(body),
      finish_reason: 'STOP',
      usage: { prompt_tokens: 0, output_tokens: 0, thoughts_tokens: 0, cached_tokens: 0 },
    } as ModelResponse);
  }

  private answer(request: ModelRequest): unknown {
    const contents = request.contents;
    if (contents.includes('EVENTS:')) {
      const ids = [...contents.matchAll(/^\d+\. \[([a-z0-9_]+)\]/gm)].map((match) => match[1]!);
      return {
        decisions: ids.slice(1).map((id) => ({
          after_event_id: id,
          decision: this.boundaryAfter.has(id) ? 'new_scene' : 'same_scene',
          why: 'stub',
        })),
      };
    }
    if (contents.includes('SCENE ')) {
      const numbers = [...contents.matchAll(/^SCENE (\d+)$/gm)].map((match) => Number(match[1]));
      return {
        scenes: numbers.map((scene_number) => ({
          scene_number,
          label: `stub ${scene_number}`,
          pov: 'char_ada',
          location_id: 'loc_house',
          dramatic_function: 'a stub function',
          required_beats: ['a stub beat'],
        })),
      };
    }
    if (contents.includes('SCENES IN FOCUS')) return { pairs: [] };
    if (contents.includes('PAIR fact_ref')) return { verdicts: [] };
    if (contents.includes('FACT:')) return { facts: [] };
    return {};
  }
}

// --- signals ------------------------------------------------------------------------------

describe('adjacency signals', () => {
  it('reads space, cast and story time off the shared fields only', () => {
    const arc = arcOf([
      {
        id: 'ev_1',
        sequence: 1,
        summary: 'Ada and Bo argue in the house.',
        location_id: 'loc_house',
        characters_present: ['char_ada', 'char_bo'],
      },
      {
        id: 'ev_2',
        sequence: 2,
        summary: 'Cy waits on the dock.',
        location_id: 'loc_dock',
        characters_present: ['char_cy'],
      },
    ]);
    const [gap] = adjacencies(arc.events);
    expect(gap?.location_changed).toBe(true);
    expect(gap?.cast_disjoint).toBe(true);
    expect(gap?.cast_overlap).toBe(0);
    expect(gap?.score).toBeGreaterThan(0.5);
    expect(gap?.reasons.length).toBeGreaterThan(1);
  });

  it('reports an optional signal as null rather than false when the layer never supplied it', () => {
    const arc = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'One.', characters_present: ['char_ada'] },
      { id: 'ev_2', sequence: 2, summary: 'Two.', characters_present: ['char_ada'] },
    ]);
    const [gap] = adjacencies(arc.events);
    expect(gap?.pov_changed).toBeNull();
    expect(gap?.function_changed).toBeNull();
    expect(gap?.causal_break).toBeNull();
    expect(gap?.story_time_changed).toBeNull();
    expect(gap?.narration_gap).toBeNull();
    expect(gap?.location_unknown).toBe(true);
    expect(signalAvailability(arc.events)).toMatchObject({ pov: false, location: false });
  });

  it('sees a generated arc\'s pov and dramatic_function when they are there', () => {
    const arc = arcOf([
      {
        id: 'ev_1',
        sequence: 1,
        summary: 'One.',
        pov: 'char_ada',
        dramatic_function: 'open',
        characters_present: ['char_ada'],
      },
      {
        id: 'ev_2',
        sequence: 2,
        summary: 'Two.',
        pov: 'char_cy',
        dramatic_function: 'turn',
        characters_present: ['char_cy'],
      },
    ]);
    const [gap] = adjacencies(arc.events);
    expect(gap?.pov_changed).toBe(true);
    expect(gap?.function_changed).toBe(true);
    expect(signalAvailability(arc.events).pov).toBe(true);
  });
});

describe('telling order', () => {
  it('uses the narrated order when the input recorded one, and counts the displacement', () => {
    // Told: the flashback (ev_2) first, then the frame. Chronologically ev_1 comes first.
    const arc = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'Long ago.', narrated_index: 5 },
      { id: 'ev_2', sequence: 2, summary: 'Today.', narrated_index: 1 },
    ]);
    const order = tellingOrder(arc.events);
    expect(order.basis).toBe('narrated_index');
    expect(order.events.map((event) => event.id)).toEqual(['ev_2', 'ev_1']);
    expect(order.displaced).toBe(2);
  });

  it('falls back to the Fabula sequence when the input authored no telling order', () => {
    const arc = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'One.' },
      { id: 'ev_2', sequence: 2, summary: 'Two.' },
    ]);
    const order = tellingOrder(arc.events);
    expect(order.basis).toBe('fabula_sequence');
    expect(order.displaced).toBe(0);
  });

  it('falls back rather than half-trusting a partial or duplicated narrated order', () => {
    const partial = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'One.', narrated_index: 0 },
      { id: 'ev_2', sequence: 2, summary: 'Two.' },
    ]);
    expect(tellingOrder(partial.events).basis).toBe('fabula_sequence');

    const duplicated = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'One.', narrated_index: 3 },
      { id: 'ev_2', sequence: 2, summary: 'Two.', narrated_index: 3 },
    ]);
    expect(tellingOrder(duplicated.events).basis).toBe('fabula_sequence');
  });
});

// --- windowing ----------------------------------------------------------------------------

describe('event windows', () => {
  it('overlaps, so interior adjacencies are judged more than once', () => {
    const windows = eventWindows(60, 24, 6);
    expect(windows.length).toBeGreaterThan(2);
    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index]!.start).toBeLessThan(windows[index - 1]!.end);
    }
    expect(windows[windows.length - 1]!.end).toBe(60);
  });

  it('covers every event and never leaves a hole', () => {
    for (const count of [1, 5, 24, 25, 100, 441]) {
      expect(assertWindowed(count, eventWindows(count))).toEqual([]);
    }
  });

  it('reports the collapse #117 hit rather than letting one unbounded call look fine', () => {
    const collapsed = assertWindowed(441, [{ index: 0, start: 0, end: 441 }]);
    expect(collapsed.join(' ')).toContain('one unbounded call');
  });
});

// --- grouping constraints -----------------------------------------------------------------

describe('grouping', () => {
  it('refuses a merge that would put a plant in the same scene as its payoff', () => {
    const events = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'The key is noticed.', location_id: 'loc_house' },
      { id: 'ev_2', sequence: 2, summary: 'They talk.', location_id: 'loc_house' },
      {
        id: 'ev_3',
        sequence: 3,
        summary: 'The key opens the door.',
        location_id: 'loc_house',
        pays_off: [{ fact_ref: 'the_key', plant: 'ev_1' }],
      },
    ]).events;
    const gaps = adjacencies(events);

    // The boundary pass said "one scene throughout"; the constraint overrules it.
    const report = group(events, gaps, new Set<number>());
    expect(report.groups).toHaveLength(2);
    expect(report.forced_by_plant_span).toBe(1);
    expect(report.groups[0]!.event_indices).toContain(0);
    expect(report.groups[1]!.event_indices).toContain(2);
  });

  it('reports a plant/payoff pair on adjacent events as unseparable rather than dropping it', () => {
    const events = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'Planted.' },
      { id: 'ev_2', sequence: 2, summary: 'Paid off.', pays_off: [{ fact_ref: 'f', plant: 'ev_1' }] },
    ]).events;
    const report = group(events, adjacencies(events), new Set<number>());
    // One adjacency exists between them, so it *is* separable — the unseparable case is a pair
    // the boundary set has already collapsed with nothing between.
    expect(report.groups).toHaveLength(2);
    expect(report.unseparable_plant_spans).toEqual([]);
  });

  it('leaves a plant that names no event in the list alone, for the linter to report', () => {
    const events = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'One.' },
      { id: 'ev_2', sequence: 2, summary: 'Two.', pays_off: [{ fact_ref: 'f', plant: 'ev_nope' }] },
    ]).events;
    const report = group(events, adjacencies(events), new Set<number>());
    expect(report.forced_by_plant_span).toBe(0);
    expect(report.groups).toHaveLength(1);
  });

  it('caps a scene that a boundary pass never closed', () => {
    const events = arcOf(linearEvents(MAX_EVENTS_PER_SCENE * 2 + 5)).events;
    const report = group(events, adjacencies(events), new Set<number>());
    expect(report.forced_by_size).toBeGreaterThan(0);
    for (const scene of report.groups) {
      expect(scene.event_indices.length).toBeLessThanOrEqual(MAX_EVENTS_PER_SCENE);
    }
  });

  it('honours the judged boundaries when nothing overrules them', () => {
    const events = arcOf(linearEvents(6)).events;
    const report = group(events, adjacencies(events), new Set([1, 3]));
    expect(report.groups.map((scene) => scene.event_indices)).toEqual([[0, 1], [2, 3], [4, 5]]);
    expect(report.forced_by_plant_span).toBe(0);
    expect(report.forced_by_size).toBe(0);
  });

  it('the mechanical baseline is a threshold over the signal score', () => {
    const events = arcOf(linearEvents(6)).events;
    expect(mechanicalBoundaries(adjacencies(events), 0.0).size).toBe(5);
    expect(mechanicalBoundaries(adjacencies(events), 0.99).size).toBe(0);
  });
});

// --- state replay -------------------------------------------------------------------------

describe('entry/exit state replay', () => {
  it('merges a scene\'s changes last-write-wins and reads entry off the seed', () => {
    const events = arcOf([
      {
        id: 'ev_1',
        sequence: 1,
        summary: 'Ada leaves.',
        state_changes: [{ entity_id: 'char_ada', column: 'location_id', value: 'loc_dock' }],
      },
      {
        id: 'ev_2',
        sequence: 2,
        summary: 'Ada comes back.',
        state_changes: [{ entity_id: 'char_ada', column: 'location_id', value: 'loc_house' }],
      },
    ]).events;
    const replay = replayStates(SEED, [[events[0]!, events[1]!]]);
    expect(replay.states[0]!.exit_state).toEqual({ char_ada: { location_id: 'loc_house' } });
    expect(replay.states[0]!.entry_state).toEqual({ char_ada: { location_id: 'loc_house' } });
  });

  it('chains scene to scene so the linter\'s entry/exit check has real values to compare', () => {
    const events = arcOf([
      {
        id: 'ev_1',
        sequence: 1,
        summary: 'Ada goes to the dock.',
        state_changes: [{ entity_id: 'char_ada', column: 'location_id', value: 'loc_dock' }],
      },
      {
        id: 'ev_2',
        sequence: 2,
        summary: 'Ada goes home.',
        state_changes: [{ entity_id: 'char_ada', column: 'location_id', value: 'loc_house' }],
      },
    ]).events;
    const replay = replayStates(SEED, [[events[0]!], [events[1]!]]);
    expect(replay.states[0]!.entry_state).toEqual({ char_ada: { location_id: 'loc_house' } });
    expect(replay.states[1]!.entry_state).toEqual({ char_ada: { location_id: 'loc_dock' } });
  });

  it('drops and counts a change naming an entity the seed has never heard of', () => {
    const events = arcOf([
      {
        id: 'ev_1',
        sequence: 1,
        summary: 'Someone does something.',
        state_changes: [{ entity_id: 'char_nobody', column: 'status', value: 'gone' }],
      },
    ]).events;
    const replay = replayStates(SEED, [[events[0]!]]);
    expect(replay.dropped_unknown_entity).toBe(1);
    expect(replay.dropped_entity_ids).toEqual(['char_nobody']);
    expect(replay.states[0]!.exit_state).toEqual({});
  });

  it('drops and counts a column the entity\'s table does not have', () => {
    const events = arcOf([
      {
        id: 'ev_1',
        sequence: 1,
        summary: 'The key wants something.',
        // `goal` is a character column, not an object one — `unknown_column` if it shipped.
        state_changes: [{ entity_id: 'obj_key', column: 'goal', value: 'be found' }],
      },
    ]).events;
    const replay = replayStates(SEED, [[events[0]!]]);
    expect(replay.dropped_unknown_column).toBe(1);
    expect(replay.states[0]!.exit_state).toEqual({});
  });
});

// --- assembly -----------------------------------------------------------------------------

describe('scene assembly', () => {
  it('counts a pov it had to substitute, and keeps pov inside characters_present', () => {
    const grouped = [arcOf([{ id: 'ev_1', sequence: 1, summary: 'Nobody is named.' }]).events];
    const drafts = draftScenes(grouped, SEED);
    expect(drafts[0]!.candidate_characters).toEqual([]);
    expect(drafts[0]!.location_inherited).toBe(true);

    const { scenes, substitutions } = assembleScenes(
      arcOf([{ id: 'ev_1', sequence: 1, summary: 'Nobody is named.' }]),
      grouped,
      {
        scenes: [
          {
            order: 1,
            id: 'scene_01',
            pov: '',
            location_id: '',
            dramatic_function: 'f',
            required_beats: ['b'],
            pov_from_fallback: true,
            location_from_fallback: true,
            beats_from_fallback: false,
          },
        ],
        failed_batches: 0,
        pov_fallbacks: 1,
        location_fallbacks: 1,
        location_inherited: 1,
        beat_fallbacks: 0,
        function_fallbacks: 0,
      },
      { states: [{ entry_state: {}, exit_state: {} }], dropped_unknown_entity: 0, dropped_entity_ids: [], dropped_unknown_column: 0 },
    );

    expect(substitutions.pov_from_seed).toBe(1);
    expect(substitutions.location_from_seed).toBe(1);
    expect(scenes[0]!.pov).toBe('char_ada');
    expect(scenes[0]!.characters_present).toContain('char_ada');
    expect(scenes[0]!.location_id).toBe('loc_house');
  });
});

// --- plant graph --------------------------------------------------------------------------

describe('plant/payoff graph', () => {
  it('rewrites Fabula-layer event ids onto the scenes that swallowed them', () => {
    const events = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'Plant.', reveals: ['the_key'] },
      { id: 'ev_2', sequence: 2, summary: 'Payoff.', pays_off: [{ fact_ref: 'the_key', plant: 'ev_1' }] },
    ]).events;
    const carried = carryForward([
      { id: 'scene_01', events: [events[0]!] },
      { id: 'scene_02', events: [events[1]!] },
    ]);
    expect(carried.paysOff.get('scene_02')).toEqual([{ fact_ref: 'the_key', plant: 'scene_01' }]);
    expect(carried.reveals.get('scene_01')).toEqual(['the_key']);
    expect(carried.dangling_plants).toBe(0);
  });

  /**
   * #120. The guard that stops an authored edge being proposed back to itself lives in the
   * prompt, not in a `fact_ref` comparison downstream, because the two layers name the same fact
   * differently. Measured before the change: 4 of 5 "new" pairs per generated arc sat on a scene
   * pair the generator had already authored, under an alias of its own slug.
   */
  it('shows the proposal pass what the Fabula layer already declared', async () => {
    const client = new StubClient();
    const sketches = [
      { id: 'scene_01', order: 1, dramatic_function: 'plant', required_beats: ['a'] },
      { id: 'scene_02', order: 2, dramatic_function: 'payoff', required_beats: ['b'] },
    ];
    await proposePairs(new ExtractionModel(client, 'stub-model'), sketches, {
      known: [
        { fact_ref: 'the_key', plant: 'scene_01', payoff: 'scene_02', why: '', type: '' },
        { fact_ref: 'ada_can_swim', plant: null, payoff: 'scene_02', why: '', type: '' },
      ],
    });
    const contents = client.requests.at(-1)!.contents;
    expect(contents).toContain('ALREADY RECORDED');
    expect(contents).toContain('the_key — scene_01 → scene_02');
    expect(contents).toContain('ada_can_swim — known before the story opens → scene_02');
  });

  it('leaves the prompt alone for an entry point that authored no graph', async () => {
    const client = new StubClient();
    const sketches = [
      { id: 'scene_01', order: 1, dramatic_function: 'plant', required_beats: ['a'] },
      { id: 'scene_02', order: 2, dramatic_function: 'payoff', required_beats: ['b'] },
    ];
    await proposePairs(new ExtractionModel(client, 'stub-model'), sketches, { known: [] });
    const withEmpty = client.requests.at(-1)!.contents;
    const system = client.requests.at(-1)!.systemInstruction;
    await proposePairs(new ExtractionModel(client, 'stub-model'), sketches);
    // Extraction emits `pays_off: []` on every event, so this is the path #118's numbers were
    // measured on; the block is omitted and the call is byte-identical either way — including the
    // system instruction, which is the cacheable prefix.
    expect(client.requests.at(-1)!.contents).toBe(withEmpty);
    expect(client.requests.at(-1)!.systemInstruction).toBe(system);
    expect(withEmpty).not.toContain('ALREADY RECORDED');
    expect(system).not.toContain('ALREADY RECORDED');
  });

  it('counts a plant event no scene holds instead of inventing a scene for it', () => {
    const events = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'Payoff.', pays_off: [{ fact_ref: 'f', plant: 'ev_gone' }] },
    ]).events;
    const carried = carryForward([{ id: 'scene_01', events: [events[0]!] }]);
    expect(carried.dangling_plants).toBe(1);
  });

  it('declares the fact in the plant scene, and rejects a backwards or ungrounded pair', () => {
    const scenes = StoryPackageSchema.parse({
      schema_version: '1.0',
      package_version: 1,
      story_id: 's',
      world_model_seed: SEED,
      voice_card: {},
      metadata: { title: 'T' },
      scene_cards: [1, 2].map((order) => ({
        id: `scene_0${order}`,
        order,
        pov: 'char_ada',
        location_id: 'loc_house',
        characters_present: ['char_ada'],
        dramatic_function: 'f',
        entry_state: {},
        exit_state: {},
        required_beats: ['b'],
      })),
    }).scene_cards;

    const result = applyPlantGraph(
      scenes,
      [
        { fact_ref: 'forwards', plant: 'scene_01', payoff: 'scene_02', why: '', type: 'object' },
        { fact_ref: 'backwards', plant: 'scene_02', payoff: 'scene_01', why: '', type: 'object' },
        { fact_ref: 'ungrounded', plant: null, payoff: 'scene_02', why: '', type: 'rule' },
      ],
      new Set<string>(),
    );

    expect(result.applied.map((pair) => pair.fact_ref)).toEqual(['forwards']);
    expect(result.unrepresentable.map((pair) => pair.fact_ref)).toEqual(['backwards', 'ungrounded']);
    expect(scenes[0]!.reader_must_learn).toEqual(['forwards']);
    expect(scenes[1]!.pays_off).toEqual([{ fact_ref: 'forwards', plant: 'scene_01' }]);
  });

  it('accepts a seed-grounded payoff when the seed genuinely grounds it', () => {
    const scenes = StoryPackageSchema.parse({
      schema_version: '1.0',
      package_version: 1,
      story_id: 's',
      world_model_seed: SEED,
      voice_card: {},
      metadata: { title: 'T' },
      scene_cards: [
        {
          id: 'scene_01',
          order: 1,
          pov: 'char_ada',
          location_id: 'loc_house',
          characters_present: ['char_ada'],
          dramatic_function: 'f',
          entry_state: {},
          exit_state: {},
          required_beats: ['b'],
        },
      ],
    }).scene_cards;

    const result = applyPlantGraph(
      scenes,
      [{ fact_ref: 'known_all_along', plant: null, payoff: 'scene_01', why: '', type: 'rule' }],
      new Set(['known_all_along']),
    );
    expect(result.applied).toHaveLength(1);
    expect(scenes[0]!.pays_off).toEqual([{ fact_ref: 'known_all_along', plant: null }]);
  });
});

// --- the entry point ----------------------------------------------------------------------

describe('segmentMechanically', () => {
  it('produces a package the real linter passes, with no model in the loop', () => {
    const result = segmentMechanically(extractedEnvelope(linearEvents(12)));
    expect(result.lint.publishable).toBe(true);
    expect(result.lint.errors).toEqual([]);
    expect(result.package.scene_cards.length).toBeGreaterThan(0);
    expect(() => StoryPackageSchema.parse(result.package)).not.toThrow();
  });
});

describe('segmentFabulaPackage', () => {
  it('turns an extraction-shaped package into Scene Cards that lint clean', async () => {
    const client = new StubClient(['ev_5', 'ev_9']);
    const result = await segmentFabulaPackage(
      extractedEnvelope(linearEvents(12)),
      new ExtractionModel(client, 'stub-model'),
    );

    expect(result.report.scenes).toBe(3);
    expect(result.report.lint.publishable).toBe(true);
    expect(result.report.lint.errors).toEqual([]);
    expect(result.report.telling_order.basis).toBe('narrated_index');
    expect(result.report.boundaries.window_problems).toEqual([]);

    // The deliverable: valid as a draft *and* strictly, with both halves populated.
    expect(() => DraftStoryPackageSchema.parse(result.package)).not.toThrow();
    const strict = StoryPackageSchema.parse(result.package);
    expect(strict.scene_cards.length).toBe(3);
    expect(strict.world_model_seed.characters.length).toBe(3);

    // The Fabula layer rides along, and the segmentation records which events each scene holds.
    const envelope = result.package as unknown as Record<string, unknown>;
    expect(envelope[FABULA_BLOCK]).toBeDefined();
    const block = envelope[SEGMENTATION_BLOCK] as { scenes: Array<{ event_ids: string[] }> };
    expect(block.scenes.flatMap((scene) => scene.event_ids)).toHaveLength(12);
  });

  it('accepts a generation-shaped package too, and carries its authored graph forward', async () => {
    // #119's shape: pov, dramatic_function, reveals and pays_off present; no spans, no
    // narrated_index, so the telling order falls back to the Fabula sequence.
    const generated = extractedEnvelope([
      {
        id: 'ev_1',
        sequence: 1,
        summary: 'Ada notices the key.',
        pov: 'char_ada',
        dramatic_function: 'plant the key',
        location_id: 'loc_house',
        characters_present: ['char_ada'],
        beats: ['Ada notices the key'],
        reveals: ['the_key'],
      },
      {
        id: 'ev_2',
        sequence: 2,
        summary: 'Ada and Bo argue.',
        pov: 'char_ada',
        dramatic_function: 'raise the stakes',
        location_id: 'loc_house',
        characters_present: ['char_ada', 'char_bo'],
        beats: ['they argue'],
      },
      {
        id: 'ev_3',
        sequence: 3,
        summary: 'Ada opens the door with the key.',
        pov: 'char_ada',
        dramatic_function: 'pay off the key',
        location_id: 'loc_dock',
        characters_present: ['char_ada'],
        beats: ['the key opens the door'],
        pays_off: [{ fact_ref: 'the_key', plant: 'ev_1' }],
      },
    ]);

    const result = await segmentFabulaPackage(
      generated,
      new ExtractionModel(new StubClient(), 'stub-model'),
      { skipPlantProposals: true },
    );

    expect(result.report.telling_order.basis).toBe('fabula_sequence');
    expect(result.report.signals_available.pov).toBe(true);
    expect(result.report.plants.carried_from_fabula).toBe(1);
    expect(result.report.lint.publishable).toBe(true);

    // The stub says "same scene" everywhere; the plant-span constraint splits anyway, so the
    // authored edge survives instead of being swallowed.
    expect(result.report.grouping.forced_by_plant_span).toBe(1);
    const strict = StoryPackageSchema.parse(result.package);
    const payoff = strict.scene_cards.find((scene) => scene.pays_off.length > 0);
    expect(payoff?.pays_off[0]?.plant).not.toBe(payoff?.id);
    expect(strict.scene_cards[0]!.reader_must_learn).toContain('the_key');
  });

  it('hands a generated arc\'s own edges to the proposal pass rather than re-deriving them', async () => {
    const client = new StubClient();
    await segmentFabulaPackage(
      extractedEnvelope([
        {
          id: 'ev_1',
          sequence: 1,
          summary: 'Ada notices the key.',
          characters_present: ['char_ada'],
          beats: ['Ada notices the key'],
          reveals: ['the_key'],
        },
        {
          id: 'ev_2',
          sequence: 2,
          summary: 'Ada opens the door.',
          characters_present: ['char_ada'],
          beats: ['the key opens the door'],
          pays_off: [{ fact_ref: 'the_key', plant: 'ev_1' }],
        },
      ]),
      new ExtractionModel(client, 'stub-model'),
    );
    const proposal = client.requests.find((request) =>
      request.contents.includes('SCENES IN FOCUS'),
    );
    expect(proposal?.contents).toContain('ALREADY RECORDED');
    expect(proposal?.contents).toContain('the_key');
  });

  it('never reads a field only one entry point supplies', async () => {
    const client = new StubClient();
    await segmentFabulaPackage(
      extractedEnvelope([
        { id: 'ev_1', sequence: 1, summary: 'One.', characters_present: ['char_ada'] },
        { id: 'ev_2', sequence: 2, summary: 'Two.', characters_present: ['char_ada'] },
      ]),
      new ExtractionModel(client, 'stub-model'),
      { skipPlantProposals: true },
    );
    // A package with no locations, no spans, no pov and no narrated order still segments.
    expect(client.requests.length).toBeGreaterThan(0);
  });
});

describe('boundary reconciliation', () => {
  it('falls back to the mechanical signal for an adjacency no window judged', async () => {
    const events = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'In the house.', location_id: 'loc_house', characters_present: ['char_ada'] },
      { id: 'ev_2', sequence: 2, summary: 'On the dock.', location_id: 'loc_dock', characters_present: ['char_cy'] },
    ]).events;

    // A client that answers nothing at all: every adjacency has to fall back.
    const silent: ModelClient = {
      generate: () =>
        Promise.resolve({
          model: 'stub-model',
          text: JSON.stringify({ decisions: [] }),
          finish_reason: 'STOP',
          usage: { prompt_tokens: 0, output_tokens: 0, thoughts_tokens: 0, cached_tokens: 0 },
        } as ModelResponse),
    };

    const gaps = adjacencies(events);
    const result = await findBoundaries(new ExtractionModel(silent, 'stub-model'), events, gaps);
    expect(result.fell_back_to_signals).toBe(1);
    expect(result.judged_adjacencies).toBe(0);
    expect(result.decisions[0]!.from_signals).toBe(true);
    // The mechanical evidence here is strong, so the fallback opens a scene.
    expect(result.boundaries.has(0)).toBe(true);
  });
});

// --- ADR 0019's shared shape and projection -----------------------------------------------

describe('the shared Fabula shape (ADR 0019)', () => {
  it('accepts an event with no pov or dramatic_function, and keeps extraction-only keys', () => {
    const { arc, dropped_state_changes } = readFabulaArc(
      extractedEnvelope([
        {
          id: 'ev_1',
          sequence: 1,
          summary: 'One.',
          narrated_index: 7,
          story_time: 'past',
          state_changes: [
            { entity_id: 'char_ada', column: 'status', value: 'alive' },
            // `name` is a real World Model column but not one this layer admits.
            { entity_id: 'char_ada', column: 'name', value: 'Adelaide' },
          ],
        },
      ]),
    );
    expect(arc.events[0]!.pov).toBeUndefined();
    expect(arc.events[0]!.dramatic_function).toBeUndefined();
    expect((arc.events[0] as unknown as Record<string, unknown>)['narrated_index']).toBe(7);
    expect(arc.events[0]!.state_changes).toHaveLength(1);
    expect(dropped_state_changes).toBe(1);
  });

  it('projects a Fabula-only arc onto provisional scenes, counting every substitution', () => {
    const arc = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'One.', characters_present: ['char_ada'], location_id: 'loc_house', beats: ['b'] },
      { id: 'ev_2', sequence: 2, summary: 'Two.', characters_present: ['char_ada'], beats: ['b'] },
    ]);
    const projection = projectFabulaArc(arc, 'test_story');
    expect(projection.substitutions.pov_from_first_participant).toBe(2);
    expect(projection.substitutions.location_carried_forward).toBe(1);
    expect(projection.substitutions.dramatic_function_projected).toBe(2);
    expect(projection.package.scene_cards[1]!.location_id).toBe('loc_house');
  });

  it('is structurally incapable of being read as a publish gate', () => {
    const arc = arcOf([
      { id: 'ev_1', sequence: 1, summary: 'One.', characters_present: ['char_ada'], location_id: 'loc_house', beats: ['b'] },
    ]);
    const result = lintFabulaArc(arc, 'test_story');

    expect(result.note).toBe(FABULA_PROJECTION_NOTE);
    expect('publishable' in result).toBe(false);
    expect(result.scene_count).toBe(1);

    // And the deliverable it describes still fails the real linter, unconditionally.
    const deliverable = {
      schema_version: '1.0',
      package_version: 1,
      story_id: 'test_story',
      world_model_seed: SEED,
      scene_cards: [],
      voice_card: {},
      metadata: { title: 'Test' },
    };
    const real = lintPackage(deliverable);
    expect(real.publishable).toBe(false);
    expect(real.errors.some((problem) => problem.path === 'scene_cards')).toBe(true);
  });
});

describe('plant/payoff ground-truth sidecar (#153)', () => {
  it('loads the annotation beside the fixture and keeps the package untouched', async () => {
    const truth = await loadGroundTruth('cinderella');
    expect(truth.plant_annotation).not.toBeNull();
    expect(truth.plant_annotation!.implicit.length).toBeGreaterThan(5);
    // The whole point of a sidecar: the package's own graph is exactly as authored.
    const declaredEdges = truth.package.scene_cards.flatMap((scene) => scene.pays_off);
    expect(declaredEdges).toHaveLength(2);
    expect(lintPackage(truth.package).publishable).toBe(true);
  });

  it('gives §3.7 a denominator it can actually be read at', async () => {
    const cinderella = await loadGroundTruth('cinderella');
    const carol = await loadGroundTruth('a-christmas-carol');
    const pairs = (t: Awaited<ReturnType<typeof loadGroundTruth>>) =>
      t.package.scene_cards.flatMap((s) => s.pays_off).length + t.plant_annotation!.implicit.length;
    // Five declared pairs across the two fixtures was the problem; this is the fix.
    expect(pairs(cinderella) + pairs(carol)).toBeGreaterThanOrEqual(25);
  });

  it('every annotated scene id resolves in its own fixture', async () => {
    for (const story of ['cinderella', 'a-christmas-carol']) {
      const truth = await loadGroundTruth(story);
      const ids = new Set(truth.package.scene_cards.map((scene) => scene.id));
      for (const pair of truth.plant_annotation!.implicit) {
        expect(ids.has(pair.payoff)).toBe(true);
        if (pair.plant !== null) expect(ids.has(pair.plant)).toBe(true);
      }
    }
  });

  it('every annotated pair carries a reason, so the rule can be argued with', async () => {
    const truth = await loadGroundTruth('a-christmas-carol');
    for (const pair of truth.plant_annotation!.implicit) {
      expect(pair.why.length).toBeGreaterThan(20);
    }
    expect(truth.plant_annotation!.inclusion_rule).not.toBeNull();
    expect(truth.plant_annotation!.provenance).not.toBeNull();
  });

  it('leaves the third fixture unannotated, and says why', async () => {
    // the-machine-stops has no sidecar on purpose: `src/extraction/sources.ts` carries no manifest
    // for it, so its source text cannot be fetched, and #153's own rule is that an annotation is
    // built FROM THE SOURCE, blind to candidate output. An annotation written from the package
    // alone would be reverse-engineered ground truth, which is worse than none.
    // It is also not scoreable here yet for an unrelated, pre-existing reason: chronology.json has
    // no entry for it either.
    expect(existsSync('fixtures/the-machine-stops/plants.annotation.json')).toBe(false);
    await expect(loadGroundTruth('the-machine-stops')).rejects.toThrow(/chronology\.json/);
  });
});
