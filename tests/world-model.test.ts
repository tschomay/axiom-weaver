import { describe, expect, it } from 'vitest';
import { WorldModel } from '@/world-model/world-model';
import { WorldModelSeedSchema } from '@/schema/story-package';
import { FIXTURE_STORY_IDS, loadFixtureStory } from '@/fixtures/load';
import { jimsWorld } from './helpers';

describe('WorldModel', () => {
  it('stamps story_id onto every seeded row', () => {
    const model = jimsWorld();
    expect(model.row('char_jim')).toMatchObject({ story_id: 'jim' });
    expect(model.row('rel_001')).toMatchObject({ story_id: 'jim' });
  });

  it('indexes row ids to their table so an update never guesses from a slug prefix', () => {
    const model = jimsWorld();
    expect(model.tableOf('char_jim')).toBe('character');
    expect(model.tableOf('loc_park')).toBe('location');
    expect(model.tableOf('obj_umbrella')).toBe('object');
    expect(model.tableOf('rel_001')).toBe('relationship');
    expect(model.tableOf('nope')).toBeNull();
  });

  it('copies deeply — a copy never shares state with its original', () => {
    const model = jimsWorld();
    const copy = model.copy();
    copy.setColumn('char_jim', 'location_id', 'loc_park');

    expect(model.value('char_jim', 'location_id')).toBe('loc_home');
    expect(copy.value('char_jim', 'location_id')).toBe('loc_park');
  });

  it('round-trips through a JSON snapshot', () => {
    const model = jimsWorld();
    const restored = WorldModel.fromJSON('jim', JSON.parse(JSON.stringify(model.toJSON())));
    expect(restored.toJSON()).toEqual(model.toJSON());
  });

  it('rejects a seed with an unresolved foreign key', () => {
    expect(() =>
      WorldModel.fromSeed(
        'broken',
        WorldModelSeedSchema.parse({
          characters: [{ id: 'char_a', name: 'A', location_id: 'loc_missing' }],
        }),
      ),
    ).toThrow(/unresolved references/);
  });

  it('reads relationship edges in both directions and knowledge per character', () => {
    const model = jimsWorld();
    expect(model.relationshipsFrom('char_ada').map((e) => e.id)).toEqual(['rel_001']);
    expect(model.relationshipsTo('char_jim').map((e) => e.id)).toEqual(['rel_001']);

    model.insertRow('character_knowledge', {
      id: 'ck_001',
      character_id: 'char_jim',
      fact_ref: 'ada_is_leaving',
      learned_at_scene: 'scene_01_the_walk',
      bag: {},
    });
    expect(model.knowledgeOf('char_jim').map((k) => k.fact_ref)).toEqual(['ada_is_leaving']);
  });
});

describe('fixtures load into the World Model end to end', () => {
  it.each(FIXTURE_STORY_IDS)('%s loads with no schema or reference mismatch', async (fixture) => {
    const loaded = await loadFixtureStory(fixture);
    expect(loaded.problems).toEqual([]);
    expect(loaded.worldModel.rows('character').length).toBeGreaterThan(0);
    expect(loaded.scenes.map((s) => s.order)).toEqual(
      loaded.scenes.map((_, index) => index + 1),
    );
  });

  it('carries A Christmas Carol’s seeded character_knowledge row', async () => {
    const loaded = await loadFixtureStory('a-christmas-carol');
    const seeded = loaded.worldModel.rows('character_knowledge');
    expect(seeded).toHaveLength(1);
    // learned_at_scene null = known from the seed, true from the story's start.
    expect(seeded[0]?.learned_at_scene).toBeNull();
  });

  it('carries the corpse-identity relationship the Stave IV reveal is built on', async () => {
    const loaded = await loadFixtureStory('a-christmas-carol');
    const edge = loaded.worldModel
      .rows('relationship')
      .find((e) => e.kind === 'foretells_the_fate_of');

    expect(edge).toBeDefined();
    expect(edge?.from_id).toBe('char_dead_man');
    expect(edge?.to_id).toBe('char_scrooge');
  });
});
