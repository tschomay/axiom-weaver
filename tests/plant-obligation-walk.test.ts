import { describe, expect, it } from 'vitest';
import { StoryPackageSchema, type StoryPackage } from '@/schema/story-package';
import {
  deslug,
  missedPayoffs,
  missedPlants,
  obligationsFor,
  payoffInstruction,
  payoffInstructionsFor,
  plantInstruction,
  walkPlantObligations,
} from '@/plants/obligation-walk';
import { FIXTURE_STORY_IDS, readFixturePackage } from '@/fixtures/load';

function pkg(scenes: unknown[], knowledge: unknown[] = []): StoryPackage {
  return StoryPackageSchema.parse({
    schema_version: '1.0',
    package_version: 1,
    story_id: 'test',
    world_model_seed: {
      characters: [{ id: 'char_a', name: 'A' }],
      locations: [{ id: 'loc_a', name: 'somewhere' }],
      character_knowledge: knowledge,
    },
    scene_cards: scenes,
    metadata: { title: 'Test' },
  });
}

function card(id: string, order: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    order,
    pov: 'char_a',
    location_id: 'loc_a',
    characters_present: ['char_a'],
    dramatic_function: 'something happens',
    entry_state: {},
    exit_state: {},
    ...overrides,
  };
}

describe('the plant-obligation walk (ADR 0004)', () => {
  it('turns a payoff into an obligation on the named plant scene', () => {
    const walk = walkPlantObligations(
      pkg([
        card('scene_a', 1, { reader_must_learn: ['loose_stair_rail'] }),
        card('scene_b', 2, { pays_off: [{ fact_ref: 'loose_stair_rail', plant: 'scene_a' }] }),
      ]),
    );

    expect(walk.errors).toEqual([]);
    const owed = walk.obligations.get('scene_a');
    expect(owed).toHaveLength(1);
    expect(owed?.[0]?.fact_ref).toBe('loose_stair_rail');
    // The instruction never names the scene that collects it — that is what keeps it from
    // telegraphing.
    expect(owed?.[0]?.instruction).not.toContain('scene_b');
  });

  it('gives one plant scene an obligation per distinct fact when several scenes pay it off', () => {
    const walk = walkPlantObligations(
      pkg([
        card('scene_a', 1, { reader_must_learn: ['fact_one', 'fact_two'] }),
        card('scene_b', 2, { pays_off: [{ fact_ref: 'fact_one', plant: 'scene_a' }] }),
        card('scene_c', 3, { pays_off: [{ fact_ref: 'fact_two', plant: 'scene_a' }] }),
      ]),
    );
    expect(walk.obligations.get('scene_a')).toHaveLength(2);
  });

  it('gives each plant scene its own obligation under multi-scene reinforcement', () => {
    const walk = walkPlantObligations(
      pkg([
        card('scene_a', 1, { reader_must_learn: ['surplus_population'] }),
        card('scene_b', 2, { reader_must_learn: ['surplus_population'] }),
        card('scene_c', 3, {
          pays_off: [
            { fact_ref: 'surplus_population', plant: 'scene_a' },
            { fact_ref: 'surplus_population', plant: 'scene_b' },
          ],
        }),
      ]),
    );
    expect(walk.obligations.get('scene_a')).toHaveLength(1);
    expect(walk.obligations.get('scene_b')).toHaveLength(1);
  });

  it('rejects a plant that does not precede its payoff', () => {
    const walk = walkPlantObligations(
      pkg([
        card('scene_a', 1, { pays_off: [{ fact_ref: 'f', plant: 'scene_b' }] }),
        card('scene_b', 2, { reader_must_learn: ['f'] }),
      ]),
    );
    expect(walk.errors.map((error) => error.code)).toEqual(['plant_after_payoff']);
    expect(walk.obligations.size).toBe(0);
  });

  it('rejects a plant scene that never declares the fact — the compiler never invents one', () => {
    const walk = walkPlantObligations(
      pkg([
        card('scene_a', 1),
        card('scene_b', 2, { pays_off: [{ fact_ref: 'f', plant: 'scene_a' }] }),
      ]),
    );
    expect(walk.errors.map((error) => error.code)).toEqual(['plant_not_declared']);
  });

  it('rejects a seed-grounded payoff whose fact is not actually seed-known', () => {
    const walk = walkPlantObligations(
      pkg([card('scene_a', 1, { pays_off: [{ fact_ref: 'never_seeded', plant: null }] })]),
    );
    expect(walk.errors.map((error) => error.code)).toEqual(['unfounded_seed_payoff']);
  });

  it('accepts a seed-grounded payoff and creates no obligation for it', () => {
    const walk = walkPlantObligations(
      pkg(
        [card('scene_a', 1, { pays_off: [{ fact_ref: 'corpse_is_scrooge', plant: null }] })],
        [
          {
            id: 'ck_1',
            character_id: 'char_a',
            fact_ref: 'corpse_is_scrooge',
            learned_at_scene: null,
          },
        ],
      ),
    );
    expect(walk.errors).toEqual([]);
    // Nothing to plant, so nothing is owed.
    expect(walk.obligations.size).toBe(0);
  });

  it('rejects a payoff naming a scene no card carries', () => {
    const walk = walkPlantObligations(
      pkg([card('scene_a', 1, { pays_off: [{ fact_ref: 'f', plant: 'scene_ghost' }] })]),
    );
    expect(walk.errors.map((error) => error.code)).toEqual(['plant_scene_unknown']);
  });

  it('reports what an obligated scene failed to plant, and what it failed to close', () => {
    const story = pkg([
      card('scene_a', 1, { reader_must_learn: ['f'] }),
      card('scene_b', 2, { pays_off: [{ fact_ref: 'f', plant: 'scene_a' }] }),
    ]);
    const walk = walkPlantObligations(story);
    const plantScene = story.scene_cards[0]!;
    const payoffScene = story.scene_cards[1]!;

    expect(missedPlants(obligationsFor(walk, plantScene), [])).toEqual(['f']);
    expect(missedPlants(obligationsFor(walk, plantScene), ['f'])).toEqual([]);
    expect(missedPayoffs(payoffScene, [])).toEqual(['f']);
    expect(missedPayoffs(payoffScene, ['f'])).toEqual([]);
  });

  it('renders both sides of the instruction from the slug alone', () => {
    expect(deslug('loose_stair_rail')).toBe('loose stair rail');
    expect(plantInstruction('loose_stair_rail')).toContain('without dwelling on it');
    expect(payoffInstruction('loose_stair_rail')).toContain('payoffs_closed');
  });

  it('derives a payoff-side instruction per declared payoff', () => {
    const story = pkg([
      card('scene_a', 1, { reader_must_learn: ['f'] }),
      card('scene_b', 2, { pays_off: [{ fact_ref: 'f', plant: 'scene_a' }] }),
    ]);
    expect(payoffInstructionsFor(story.scene_cards[1]!)).toHaveLength(1);
    expect(payoffInstructionsFor(story.scene_cards[0]!)).toEqual([]);
  });
});

describe('every fixture package walks clean', () => {
  // ADR 0004 decision 4's errors are hard failures before generation, so a fixture that trips one
  // cannot be compiled at all. Walking all five here means a mistyped plant scene id or a payoff
  // whose plant never declares the fact fails in the suite rather than at the first compile.
  it.each(FIXTURE_STORY_IDS)('%s', async (fixture) => {
    const walk = walkPlantObligations(await readFixturePackage(fixture));
    expect(walk.errors).toEqual([]);
  });
});
