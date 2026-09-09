import { describe, expect, it } from 'vitest';
import {
  NEW_RELATIONSHIPS_KEY,
  SceneCardSchema,
  StoryPackageSchema,
  newRelationships,
  scenesInOrder,
} from '@/schema/story-package';
import { columnAuthority, tieredColumns } from '@/schema/tiers';
import { FIXTURE_STORY_IDS, readFixturePackage } from '@/fixtures/load';

describe('Story Package schema', () => {
  it.each(FIXTURE_STORY_IDS)('parses the %s fixture without a schema mismatch', async (fixture) => {
    const pkg = await readFixturePackage(fixture);
    expect(pkg.story_id).toBe(fixture);
    expect(pkg.schema_version).toBe('1.0');
    expect(pkg.package_version).toBe(1);
    expect(pkg.scene_cards.length).toBeGreaterThan(0);
  });

  it('keeps non-schema envelope keys through a round trip', async () => {
    // Both fixtures carry an `_authoring_conventions` block that must survive into a retained
    // package_version snapshot.
    const pkg = await readFixturePackage('cinderella');
    expect(pkg).toHaveProperty('_authoring_conventions');

    const reparsed = StoryPackageSchema.parse(JSON.parse(JSON.stringify(pkg)));
    expect(reparsed).toHaveProperty('_authoring_conventions');
  });

  it('defaults every optional Scene Card field so a thin card is legal', () => {
    const thin = SceneCardSchema.parse({
      id: 'scene_01',
      order: 1,
      pov: 'char_a',
      location_id: 'loc_a',
      characters_present: ['char_a'],
      dramatic_function: 'transition',
      entry_state: {},
      exit_state: {},
    });

    expect(thin.required_beats).toEqual([]);
    expect(thin.reader_must_learn).toEqual([]);
    expect(thin.must_stay_hidden).toEqual([]);
    expect(thin.force_reintroduce).toEqual([]);
    expect(thin.invariants).toEqual([]);
    expect(thin.pays_off).toEqual([]);
    expect(thin.tone).toBeUndefined();
  });

  it('parses the reserved _new_relationships key as rows, not column assertions', async () => {
    const pkg = await readFixturePackage('cinderella');
    const scene = scenesInOrder(pkg).find((card) => NEW_RELATIONSHIPS_KEY in card.exit_state);

    expect(scene).toBeDefined();
    const rows = newRelationships(scene!.exit_state);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('from_id');
    expect(rows[0]).toHaveProperty('kind');
  });

  it('rejects a nested object in a bag (Principle 4: flat scalars only)', () => {
    const result = StoryPackageSchema.safeParse({
      schema_version: '1.0',
      package_version: 1,
      story_id: 'x',
      world_model_seed: {
        characters: [{ id: 'char_a', name: 'A', bag: { nested: { too: 'deep' } } }],
      },
      scene_cards: [
        {
          id: 's1',
          order: 1,
          pov: 'char_a',
          location_id: 'loc_a',
          characters_present: ['char_a'],
          dramatic_function: 'x',
          entry_state: {},
          exit_state: {},
        },
      ],
      metadata: { title: 'x' },
    });

    expect(result.success).toBe(false);
  });
});

describe('tiers', () => {
  it('declares tier per column, per ADR 0001 decision 2', () => {
    expect(columnAuthority('character', 'location_id').tier).toBe('P');
    expect(columnAuthority('character', 'status').tier).toBe('P');
    expect(columnAuthority('character', 'goal').tier).toBe('V');
    expect(columnAuthority('relationship', 'kind').tier).toBe('P');
    expect(columnAuthority('relationship', 'sentiment').tier).toBe('V');
    expect(columnAuthority('character_knowledge', '_row').tier).toBe('E');
  });

  it('leaves identity and bag columns untiered — never engine-writable', () => {
    expect(columnAuthority('character', 'id').tier).toBeNull();
    expect(columnAuthority('character', 'bag').tier).toBeNull();
    expect(columnAuthority('relationship', 'from_id').tier).toBeNull();
    expect(tieredColumns('character')).not.toContain('bag');
  });

  it('reports an unknown column rather than guessing at it', () => {
    expect(columnAuthority('character', 'mood')).toEqual({ known: false, tier: null });
  });
});
