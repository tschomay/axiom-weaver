import { describe, expect, it } from 'vitest';
import { lintPackage, lintStoryPackage } from '@/authoring/lint';
import { FIXTURE_STORY_IDS, readFixturePackage } from '@/fixtures/load';
import { cardFromPreset } from '@/voice/voice-card';
import type { StoryPackage } from '@/schema/story-package';

async function fixture(id: string): Promise<StoryPackage> {
  return readFixturePackage(id);
}

describe('the fixtures', () => {
  it.each(FIXTURE_STORY_IDS)('%s lints clean of errors', async (id) => {
    const result = lintStoryPackage(await fixture(id));
    expect(result.errors).toEqual([]);
    expect(result.publishable).toBe(true);
  });

  // Recorded rather than asserted-empty, so the warning set stays honest: a new check that
  // starts firing across every fixture shows up here as a decision to make, not as silence.
  it('raises only warnings a reader of the fixtures would agree with', async () => {
    const byCode = new Map<string, number>();
    for (const id of FIXTURE_STORY_IDS) {
      for (const warning of lintStoryPackage(await fixture(id)).warnings) {
        byCode.set(warning.code, (byCode.get(warning.code) ?? 0) + 1);
      }
    }
    expect([...byCode.keys()].sort()).toMatchSnapshot();
  });
});

describe('errors block publishing', () => {
  it('names the exact field when an on-page character is missing from characters_present', async () => {
    // The real #16 finding: the godmother is on the page in Cinderella scene 13 and was not
    // listed. This is the class of error a picker cannot produce and a human re-reading their
    // own JSON does not catch.
    const pkg = structuredClone(await fixture('cinderella'));
    const scene = pkg.scene_cards.find((card) => card.order === 13)!;
    scene.characters_present = scene.characters_present.filter((id) => id !== scene.pov);

    const result = lintStoryPackage(pkg);
    expect(result.publishable).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'pov_absent',
        path: `scene_cards.${scene.id}.pov`,
      }),
    );
  });

  it('catches an unknown entity in a state block, at the entity path', async () => {
    const pkg = structuredClone(await fixture('the-amber-cat'));
    pkg.scene_cards[0]!.exit_state = { char_nobody: { status: 'alive' } };

    const result = lintStoryPackage(pkg);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'unknown_entity',
        path: `scene_cards.${pkg.scene_cards[0]!.id}.exit_state`,
      }),
    );
  });

  it('catches a column that is not a column of that table', async () => {
    const pkg = structuredClone(await fixture('the-amber-cat'));
    const character = pkg.world_model_seed.characters[0]!;
    pkg.scene_cards[0]!.exit_state = { [character.id]: { mood: 'wary' } };

    expect(lintStoryPackage(pkg).errors).toContainEqual(
      expect.objectContaining({ code: 'unknown_column' }),
    );
  });

  it('catches a duplicate order', async () => {
    const pkg = structuredClone(await fixture('the-dragon-of-thistlewick'));
    pkg.scene_cards[1]!.order = pkg.scene_cards[0]!.order;

    expect(lintStoryPackage(pkg).errors).toContainEqual(
      expect.objectContaining({ code: 'duplicate_order' }),
    );
  });

  it('catches a plant that does not come before its payoff', async () => {
    const pkg = structuredClone(await fixture('the-lamp-at-cairn-head'));
    const payoff = pkg.scene_cards.find((card) => card.pays_off.some((p) => p.plant !== null))!;
    const entry = payoff.pays_off.find((p) => p.plant !== null)!;
    entry.plant = payoff.id;

    const result = lintStoryPackage(pkg);
    expect(result.publishable).toBe(false);
    expect(result.errors.map((problem) => problem.code)).toContain('plant_after_payoff');
    expect(result.errors.some((problem) => problem.path.includes(entry.fact_ref))).toBe(true);
  });

  it('catches a plant scene that never declares the fact itself', async () => {
    const pkg = structuredClone(await fixture('the-lamp-at-cairn-head'));
    const payoff = pkg.scene_cards.find((card) => card.pays_off.some((p) => p.plant !== null))!;
    const entry = payoff.pays_off.find((p) => p.plant !== null)!;
    const plant = pkg.scene_cards.find((card) => card.id === entry.plant)!;
    plant.reader_must_learn = plant.reader_must_learn.filter((fact) => fact !== entry.fact_ref);

    // ADR 0004 decision 2: the compiler never invents where a plant lands.
    expect(lintStoryPackage(pkg).errors.map((problem) => problem.code)).toContain(
      'plant_not_declared',
    );
  });

  it('catches an unresolved reference in the seed itself, at the envelope path', async () => {
    const pkg = structuredClone(await fixture('the-dragon-of-thistlewick'));
    const character = pkg.world_model_seed.characters[0]!;
    character.location_id = 'loc_nowhere';

    expect(lintStoryPackage(pkg).errors).toContainEqual(
      expect.objectContaining({
        path: `world_model_seed.characters.${character.id}.location_id`,
      }),
    );
  });
});

describe('a shape violation stops the pass', () => {
  it('reports schema issues against scene ids, not array indices', async () => {
    const pkg = structuredClone(await fixture('the-dragon-of-thistlewick')) as Record<
      string,
      unknown
    >;
    const scenes = pkg.scene_cards as Array<Record<string, unknown>>;
    delete scenes[1]!.dramatic_function;

    const result = lintPackage(pkg);
    expect(result.publishable).toBe(false);
    expect(result.errors[0]!.path).toBe(`scene_cards.${scenes[1]!.id as string}.dramatic_function`);
    expect(result.errors[0]!.code).toMatch(/^schema\./);
  });

  it('rejects a package with no scenes at all', () => {
    const result = lintPackage({
      schema_version: '1.0',
      package_version: 1,
      story_id: 'empty',
      world_model_seed: {},
      scene_cards: [],
      voice_card: {},
      metadata: { title: 'Empty' },
    });

    expect(result.publishable).toBe(false);
    expect(result.errors[0]!.path).toBe('scene_cards');
  });
});

describe('warnings never block', () => {
  it('flags a seed entity no Scene Card ever names, and still publishes', async () => {
    const pkg = structuredClone(await fixture('the-dragon-of-thistlewick'));
    pkg.world_model_seed.objects.push({
      id: 'obj_forgotten_lantern',
      name: 'a forgotten lantern',
      location_id: null,
      status: 'intact',
      bag: {},
    });

    const result = lintStoryPackage(pkg);
    expect(result.publishable).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'unused_seed_entity',
        path: 'world_model_seed.objects.obj_forgotten_lantern',
      }),
    );
  });

  it('flags a scene that declares no required beats', async () => {
    const pkg = structuredClone(await fixture('the-dragon-of-thistlewick'));
    pkg.scene_cards[0]!.required_beats = [];

    const result = lintStoryPackage(pkg);
    expect(result.publishable).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'no_required_beats',
        path: `scene_cards.${pkg.scene_cards[0]!.id}.required_beats`,
      }),
    );
  });

  it('flags a Voice Card left exactly at a preset', async () => {
    const pkg = structuredClone(await fixture('the-dragon-of-thistlewick'));
    pkg.voice_card = { ...cardFromPreset('fairy_tale_fable') } as Record<string, unknown>;

    const result = lintStoryPackage(pkg);
    expect(result.publishable).toBe(true);
    expect(result.warnings.map((problem) => problem.code)).toContain('voice_card_untouched');
  });

  it('says nothing about length budgets when no scene has one', async () => {
    const pkg = structuredClone(await fixture('the-dragon-of-thistlewick'));
    for (const card of pkg.scene_cards) delete card.length_budget;

    expect(lintStoryPackage(pkg).warnings.map((problem) => problem.code)).not.toContain(
      'no_length_budget',
    );
  });

  it('flags the odd scene out once its neighbours are budgeted', async () => {
    const pkg = structuredClone(await fixture('the-dragon-of-thistlewick'));
    for (const card of pkg.scene_cards) card.length_budget = 900;
    delete pkg.scene_cards[1]!.length_budget;

    expect(lintStoryPackage(pkg).warnings).toContainEqual(
      expect.objectContaining({
        code: 'no_length_budget',
        path: `scene_cards.${pkg.scene_cards[1]!.id}.length_budget`,
      }),
    );
  });
});

describe('every problem is navigable', () => {
  it('carries a non-empty path and message on every problem it can raise', async () => {
    const pkg = structuredClone(await fixture('cinderella'));
    pkg.scene_cards[0]!.pov = 'char_nobody';
    pkg.scene_cards[1]!.required_beats = [];

    for (const problem of lintStoryPackage(pkg).problems) {
      expect(problem.path).not.toBe('');
      expect(problem.message).not.toBe('');
      expect(problem.code).not.toBe('');
    }
  });
});
