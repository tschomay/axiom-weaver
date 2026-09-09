import { describe, expect, it } from 'vitest';
import { StoryPackageSchema, type SceneCard, type StoryPackage } from '@/schema/story-package';
import { WorldModel } from '@/world-model/world-model';
import { DigestHierarchy } from '@/digest/hierarchy';
import { ToldLedger } from '@/digest/told-ledger';
import { buildImageryLedger } from '@/voice/imagery-ledger';
import { cardFromPreset } from '@/voice/voice-card';
import { assemblePrompt, estimateTokens, promptText } from '@/assembler/context-assembler';
import { joinSceneRows, presentEntityIds, beatOnlyCharacters } from '@/assembler/join';
import { writerContract } from '@/writer/contract';

const PACKAGE: StoryPackage = StoryPackageSchema.parse({
  schema_version: '1.0',
  package_version: 1,
  story_id: 'test',
  world_model_seed: {
    characters: [
      { id: 'char_a', name: 'Ada', location_id: 'loc_room', status: 'alive' },
      { id: 'char_b', name: 'Bo', location_id: 'loc_room', status: 'alive' },
      { id: 'char_absent', name: 'Zed', location_id: 'loc_hall', status: 'alive' },
    ],
    locations: [
      { id: 'loc_room', name: 'the back room' },
      { id: 'loc_hall', name: 'the hall' },
    ],
    objects: [
      { id: 'obj_here', name: 'a lamp', location_id: 'loc_room', status: 'lit' },
      { id: 'obj_held', name: 'a ring', location_id: null, status: 'intact' },
      { id: 'obj_elsewhere', name: 'a coat', location_id: 'loc_hall', status: 'intact' },
    ],
    relationships: [
      { id: 'rel_hold', from_id: 'char_a', to_id: 'obj_held', kind: 'possesses' },
      { id: 'rel_both', from_id: 'char_a', to_id: 'char_b', kind: 'sibling_of' },
      { id: 'rel_one', from_id: 'char_a', to_id: 'char_absent', kind: 'employer_of' },
    ],
    character_knowledge: [
      { id: 'ck_scene', character_id: 'char_a', fact_ref: 'the_secret', learned_at_scene: null },
      { id: 'ck_other', character_id: 'char_a', fact_ref: 'something_else', learned_at_scene: null },
      { id: 'ck_absent', character_id: 'char_absent', fact_ref: 'the_secret', learned_at_scene: null },
    ],
  },
  scene_cards: [
    {
      id: 'scene_01',
      order: 1,
      pov: 'char_a',
      location_id: 'loc_room',
      characters_present: ['char_a', 'char_b'],
      dramatic_function: 'Ada tells Bo about Zed.',
      entry_state: {},
      exit_state: {},
      required_beats: ['Ada mentions Zed by name'],
      reader_must_learn: ['the_secret'],
      tone: 'hushed',
      length_budget: 300,
    },
  ],
  metadata: { title: 'Test Story' },
});

const SCENE: SceneCard = PACKAGE.scene_cards[0]!;

function model(): WorldModel {
  return WorldModel.fromSeed('test', PACKAGE.world_model_seed);
}

describe('the deterministic join (ADR 0008 decision 4)', () => {
  it('scopes rows to characters_present, the location, and objects there or held', () => {
    const rows = joinSceneRows(SCENE, model());

    expect(rows.characters.map((row) => row.id)).toEqual(['char_a', 'char_b']);
    expect(rows.location?.id).toBe('loc_room');
    // A lamp in the room and a ring in Ada's pocket are both in scope; a coat in the hall is not.
    expect(rows.objects.map((row) => row.id).sort()).toEqual(['obj_held', 'obj_here']);
  });

  it('splits relationships by how many endpoints are on stage', () => {
    const rows = joinSceneRows(SCENE, model());
    expect(rows.relationships_both_present.map((edge) => edge.id).sort()).toEqual([
      'rel_both',
      'rel_hold',
    ]);
    expect(rows.relationships_one_present.map((edge) => edge.id)).toEqual(['rel_one']);
  });

  it("splits character_knowledge by whether it touches the scene's own facts", () => {
    const rows = joinSceneRows(SCENE, model());
    expect(rows.knowledge_scene_facts.map((row) => row.id)).toEqual(['ck_scene']);
    expect(rows.knowledge_other.map((row) => row.id)).toEqual(['ck_other']);
    // An absent character's knowledge is out of scope entirely, however relevant the fact.
    expect([...rows.knowledge_scene_facts, ...rows.knowledge_other]).not.toContainEqual(
      expect.objectContaining({ id: 'ck_absent' }),
    );
  });

  it('surfaces a character with an on-page beat who is missing from characters_present', () => {
    // The Cinderella godmother case: the join is deterministic off declared fields, so it cannot
    // pull her row — but the compiler can at least notice and log it.
    const found = beatOnlyCharacters(SCENE, model());
    expect(found.map((row) => row.id)).toEqual(['char_absent']);
  });

  it('lists every on-stage entity id, characters and location and objects alike', () => {
    const ids = presentEntityIds(joinSceneRows(SCENE, model()));
    expect(ids).toContain('char_a');
    expect(ids).toContain('loc_room');
    expect(ids).toContain('obj_held');
  });
});

function assemble(budget?: number) {
  const voiceCard = cardFromPreset('fairy_tale_fable');
  return assemblePrompt({
    pkg: PACKAGE,
    scene: SCENE,
    model: model(),
    voiceCard,
    hierarchy: new DigestHierarchy(4),
    ledger: ToldLedger.forPackage(PACKAGE),
    imageryLedger: buildImageryLedger(voiceCard, []),
    reanchoring: [],
    plantObligations: [],
    payoffInstructions: [],
    previousParagraph: 'The door had been open the whole time.',
    writerContract: writerContract(),
    ...(budget === undefined ? {} : { volatileTailBudget: budget }),
  });
}

describe('payload order and cache boundaries (ADR 0008 decision 3)', () => {
  it('orders segments coarsest to most volatile, with only the header explicitly cached', () => {
    const assembled = assemble();
    expect(assembled.segments.map((part) => part.cache)).toEqual([
      'explicit',
      'implicit',
      'none',
      'none',
    ]);
  });

  it('keeps the stable header ahead of everything that mutates', () => {
    const text = promptText(assemble());
    const headerAt = text.indexOf('You are the performance engine');
    const voiceAt = text.indexOf('VOICE (story-level');
    const tailAt = text.indexOf('SCENE CARD — scene_01');
    const verbatimAt = text.indexOf('The door had been open');

    expect(headerAt).toBeGreaterThanOrEqual(0);
    expect(headerAt).toBeLessThan(voiceAt);
    expect(voiceAt).toBeLessThan(verbatimAt);
    // The mistake ADR 0008 measured: the volatile tail must come last, never after the header.
    expect(verbatimAt).toBeLessThan(tailAt);
  });

  it('carries the World Model column/tier legend but never row data in the header', () => {
    const { header } = assemble();
    expect(header.text).toContain('WORLD MODEL SCHEMA');
    expect(header.text).toContain('goal (V)');
    expect(header.text).not.toContain('char_a');
  });

  it("renders the scene's tone after the imagery ledger, inside the volatile tail", () => {
    const { volatile_tail: tail } = assemble();
    expect(tail.text).toContain('SCENE TONE');
    expect(tail.text.indexOf('IMAGERY LEDGER')).toBeLessThan(tail.text.indexOf('SCENE TONE'));
  });
});

describe('volatile-tail budget and eviction (ADR 0008 decision 6)', () => {
  it('includes every group when the budget is ample', () => {
    const assembled = assemble(10_000);
    expect(assembled.tail_groups.every((group) => group.included)).toBe(true);
    expect(assembled.diagnostics).toEqual([]);
  });

  it('drops the lowest-priority groups first, and never the mandatory core', () => {
    const assembled = assemble(estimateTokens(assemble(10_000).volatile_tail.text) - 30);
    const dropped = assembled.tail_groups.filter((group) => !group.included);

    expect(dropped.length).toBeGreaterThan(0);
    // Whatever was dropped, nothing higher-priority than the first drop survived it.
    const firstDropped = Math.min(...dropped.map((group) => group.priority));
    for (const group of assembled.tail_groups) {
      if (group.priority > firstDropped && group.text !== '') expect(group.included).toBe(false);
    }
    // The core is still there.
    expect(assembled.volatile_tail.text).toContain('SCENE CARD — scene_01');
    expect(assembled.volatile_tail.text).toContain('WORLD MODEL ROWS');
  });

  it('logs that a scene needs a larger allowance rather than trimming its core', () => {
    const assembled = assemble(10);
    expect(assembled.diagnostics.map((entry) => entry.type)).toContain('core_over_budget');
    expect(assembled.volatile_tail.text).toContain('SCENE CARD — scene_01');
  });
});
