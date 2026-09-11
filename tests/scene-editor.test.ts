/**
 * The Scene Card editor's decisions (issue #89, ADR 0017 §6/§10).
 *
 * The hardest claim this module makes is that editing a state block as rows is **lossless**: the
 * editor turns `entry_state`/`exit_state` into entity → column → value and back, and a package
 * that goes through it has to come out byte-identical. That is checked against every scene of all
 * five fixtures rather than against an example written here, because the fixtures are the only
 * state blocks in the project that nobody wrote to make this test pass.
 */

import { describe, expect, it } from 'vitest';
import { readFixturePackage, FIXTURE_STORY_IDS } from '@/fixtures/load';
import { lintStoryPackage } from '@/authoring/lint';
import { walkPlantObligations } from '@/plants/obligation-walk';
import {
  CARD_SOURCES,
  addSceneCard,
  blankSceneCard,
  columnChoices,
  deleteSceneCard,
  draftSeedFacts,
  factRefsInUse,
  inOrder,
  mintSceneId,
  moveScene,
  payoffStatus,
  plantChoices,
  plantDependents,
  reconcileStateRows,
  renumber,
  resequence,
  sceneName,
  scenePath,
  stateFromRows,
  stateRows,
  stateSignature,
  tableForEntity,
  type StateRow,
} from '@/authoring/scene-editor';
import type { DraftSceneCard, DraftStoryPackage } from '@/schema/manuscript';
import { DraftStoryPackageSchema } from '@/schema/manuscript';
import type { StoryPackage } from '@/schema/story-package';

async function draft(fixture: string): Promise<DraftStoryPackage> {
  return DraftStoryPackageSchema.parse(await readFixturePackage(fixture));
}

describe('a state block survives the row editor unchanged', () => {
  it.each(FIXTURE_STORY_IDS)('round-trips every scene of %s', async (fixture) => {
    const pkg = await readFixturePackage(fixture);
    for (const scene of pkg.scene_cards) {
      expect(stateFromRows(stateRows(scene.entry_state))).toEqual(scene.entry_state);
      expect(stateFromRows(stateRows(scene.exit_state))).toEqual(scene.exit_state);
    }
  });

  it('turns the reserved keys into rows of their own, not keys to type', () => {
    const block = {
      char_a: { location_id: 'loc_b', status: 'shaken' },
      _new_relationships: [
        { id: 'rel_1', from_id: 'char_a', to_id: 'char_b', kind: 'owes', sentiment: null, bag: {} },
      ],
      _new_character_knowledge: [
        { id: 'know_1', character_id: 'char_a', fact_ref: 'the_debt', learned_at_scene: 's1', bag: {} },
      ],
    };
    const rows = stateRows(block);
    expect(rows.map((row) => row.kind)).toEqual([
      'column',
      'column',
      'relationship',
      'knowledge',
    ]);
    expect(stateFromRows(rows)).toEqual(block);
  });

  it('drops a row the author has added but not filled in', () => {
    // Same rule as a bag's blank key: an empty assertion persisted on the next autosave is an
    // empty column in the package a second later.
    const rows: StateRow[] = [
      { kind: 'column', entity_id: 'char_a', column: 'status', value: 'awake' },
      { kind: 'column', entity_id: '', column: '', value: '' },
    ];
    expect(stateFromRows(rows)).toEqual({ char_a: { status: 'awake' } });
  });

  it('keeps a half-made assertion on screen while the package holds what the rows produce', () => {
    // The complement of the rule above: dropping an empty row on the way into the package is
    // what keeps autosave from writing an empty column, and the editor's own rows are what keep
    // "Assert a column" from producing a row that vanishes on the same render.
    const rows: StateRow[] = [
      { kind: 'column', entity_id: 'char_a', column: 'status', value: 'awake' },
      { kind: 'column', entity_id: '', column: '', value: '' },
    ];
    const produced = stateFromRows(rows);
    expect(reconcileStateRows(produced, { produced: stateSignature(produced), rows })).toHaveLength(
      2,
    );
  });

  it('rebuilds its rows when the block changes from anywhere else', () => {
    const rows: StateRow[] = [{ kind: 'column', entity_id: '', column: '', value: '' }];
    const stale = { produced: stateSignature(stateFromRows(rows)), rows };
    expect(reconcileStateRows({ char_b: { status: 'gone' } }, stale)).toEqual([
      { kind: 'column', entity_id: 'char_b', column: 'status', value: 'gone' },
    ]);
    expect(reconcileStateRows({ char_b: { status: 'gone' } }, null)).toHaveLength(1);
  });

  it('groups several assertions on one entity into one block', () => {
    const rows: StateRow[] = [
      { kind: 'column', entity_id: 'char_a', column: 'status', value: 'awake' },
      { kind: 'column', entity_id: 'char_b', column: 'status', value: 'asleep' },
      { kind: 'column', entity_id: 'char_a', column: 'location_id', value: 'loc_c' },
    ];
    expect(stateFromRows(rows)).toEqual({
      char_a: { status: 'awake', location_id: 'loc_c' },
      char_b: { status: 'asleep' },
    });
  });
});

describe('the column list is the schema’s, not the UI’s (ADR 0001 Principle 2)', () => {
  it('offers exactly the columns the engine may write, minus the row itself', () => {
    expect(columnChoices('character', '').map((choice) => choice.column)).toEqual([
      'name',
      'location_id',
      'status',
      'goal',
    ]);
    expect(columnChoices('location', '').map((choice) => choice.column)).toEqual(['name']);
    // `character_knowledge` carries no tiered column: the row's existence *is* the fact, and
    // creating one is its own affordance.
    expect(columnChoices('character_knowledge', '')).toEqual([]);
  });

  it('carries each column’s declared tier', () => {
    const columns = columnChoices('character', '');
    expect(columns.find((choice) => choice.column === 'goal')?.tier).toBe('V');
    expect(columns.find((choice) => choice.column === 'location_id')?.tier).toBe('P');
    expect(columnChoices('relationship', '').find((c) => c.column === 'sentiment')?.tier).toBe('V');
  });

  it('keeps a column the table does not declare visible and selected', () => {
    const columns = columnChoices('location', 'weather');
    expect(columns[0]).toEqual({ column: 'weather', tier: null });
    expect(columns).toHaveLength(2);
  });

  it('has nothing to offer for an entity that is not in the seed', () => {
    expect(columnChoices(null, '')).toEqual([]);
    expect(columnChoices(null, 'status')).toEqual([{ column: 'status', tier: null }]);
  });

  it('finds which table an entity lives in', async () => {
    const pkg = await draft('cinderella');
    expect(tableForEntity(pkg.world_model_seed, 'char_cinderella')).toBe('character');
    expect(tableForEntity(pkg.world_model_seed, 'loc_house')).toBe('location');
    expect(tableForEntity(pkg.world_model_seed, 'nothing_at_all')).toBeNull();
  });
});

describe('ordering the Syuzhet', () => {
  const cards = (...ids: string[]): DraftSceneCard[] =>
    ids.map((id, index) => blankSceneCard(id, index + 1));

  it('renumbers 1..n so “comes before” stays answerable', () => {
    const gappy = [blankSceneCard('a', 5), blankSceneCard('b', 2), blankSceneCard('c', 9)];
    expect(renumber(gappy).map((scene) => [scene.id, scene.order])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 3],
    ]);
  });

  it('takes the array as the sequence when a reorder has already made it one', () => {
    // `renumber` consults `order`, which after a move still says where the card *was* — so a
    // reorder needs the position-based one or it puts the card straight back.
    const afterSplice = [blankSceneCard('a', 1), blankSceneCard('c', 3), blankSceneCard('b', 2)];
    expect(resequence(afterSplice).map((scene) => [scene.id, scene.order])).toEqual([
      ['a', 1],
      ['c', 2],
      ['b', 3],
    ]);
    expect(renumber(afterSplice).map((scene) => scene.id)).toEqual(['a', 'b', 'c']);
  });

  it('moves a card one step and renumbers', () => {
    const moved = moveScene(cards('a', 'b', 'c'), 'c', -1);
    expect(inOrder(moved).map((scene) => scene.id)).toEqual(['a', 'c', 'b']);
    expect(inOrder(moved).map((scene) => scene.order)).toEqual([1, 2, 3]);
  });

  it('refuses to move past either end, and leaves the list alone', () => {
    expect(inOrder(moveScene(cards('a', 'b'), 'a', -1)).map((s) => s.id)).toEqual(['a', 'b']);
    expect(inOrder(moveScene(cards('a', 'b'), 'b', 1)).map((s) => s.id)).toEqual(['a', 'b']);
    expect(inOrder(moveScene(cards('a', 'b'), 'nope', 1)).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('never rewrites an id on a reorder', () => {
    // Ids encode their creation position, and a `pays_off` names one. Renaming on a reorder
    // would break every reference silently.
    const moved = moveScene(cards('scene_01_a', 'scene_02_b'), 'scene_02_b', -1);
    expect(moved.map((scene) => scene.id).sort()).toEqual(['scene_01_a', 'scene_02_b']);
  });
});

describe('adding a card, from one of exactly two sources (ADR 0017 §10)', () => {
  it('ships blank and duplicated-from, and no third', () => {
    expect(CARD_SOURCES).toEqual(['blank', 'duplicated-from']);
  });

  it('mints an id in the shape both fixtures use', () => {
    expect(mintSceneId([], 'The Lamp')).toBe('scene_01_the_lamp');
    expect(mintSceneId(
      [blankSceneCard('scene_01_a', 1), blankSceneCard('scene_02_b', 2)],
      '',
    )).toBe('scene_03');
  });

  it('steps past an id already taken', () => {
    const taken = [blankSceneCard('scene_01_the_lamp', 1)];
    // A one-card story minting "The Lamp" again wants position 02, so there is no collision to
    // step past; force one by taking the name it would produce.
    expect(mintSceneId([blankSceneCard('scene_01_x', 1)], 'x')).toBe('scene_02_x');
    expect(mintSceneId(taken, 'the lamp')).toBe('scene_02_the_lamp');
  });

  it('appends a blank card and renumbers', () => {
    const added = addSceneCard([blankSceneCard('a', 1)], { kind: 'blank', name: 'Two' });
    expect(added.id).toBe('scene_02_two');
    expect(inOrder(added.scenes).map((scene) => scene.order)).toEqual([1, 2]);
  });

  it('does not stutter a duplicate’s id', async () => {
    // `scene_04_the_lamp` duplicated must not become `scene_05_scene_04_the_lamp_copy`: the id
    // already carries its position, so only the name half travels.
    expect(sceneName('scene_04_the_lamp')).toBe('the_lamp');
    expect(sceneName('scene_04')).toBe('');
    const source = blankSceneCard('scene_04_the_lamp', 4);
    const added = addSceneCard([source], { kind: 'duplicated-from', scene: source });
    expect(added.id).toBe('scene_02_the_lamp_copy');
  });

  it('duplicates everything except the id and the payoffs', async () => {
    const pkg = await draft('the-dragon-of-thistlewick');
    const source = inOrder(pkg.scene_cards)[2] as DraftSceneCard;
    expect(source.pays_off.length).toBeGreaterThan(0);

    const added = addSceneCard(pkg.scene_cards, { kind: 'duplicated-from', scene: source });
    const copy = added.scenes.find((scene) => scene.id === added.id) as DraftSceneCard;
    expect(copy.id).not.toBe(source.id);
    expect(copy.required_beats).toEqual(source.required_beats);
    expect(copy.exit_state).toEqual(source.exit_state);
    // A copied payoff would name the original's plant and be either wrong or a silent duplicate
    // obligation. Neither is something "duplicate" asked for.
    expect(copy.pays_off).toEqual([]);
  });
});

describe('deleting a card says what it would orphan', () => {
  it('names every payoff that plants at the card', async () => {
    const pkg = await draft('the-dragon-of-thistlewick');
    const planted = inOrder(pkg.scene_cards).find(
      (scene) => plantDependents(pkg.scene_cards, scene.id).length > 0,
    ) as DraftSceneCard;

    const dependents = plantDependents(pkg.scene_cards, planted.id);
    expect(dependents.length).toBeGreaterThan(0);

    // And the linter agrees about what deleting it costs — the warning the screen gives before
    // the delete is the error the walk would give after.
    const after = deleteSceneCard(pkg.scene_cards, planted.id);
    const walk = walkPlantObligations({ ...pkg, scene_cards: after } as unknown as StoryPackage);
    expect(walk.errors.some((error) => error.code === 'plant_scene_unknown')).toBe(true);
  });

  it('says nothing where nothing plants there', () => {
    expect(plantDependents([blankSceneCard('a', 1)], 'a')).toEqual([]);
  });
});

describe('the plant picker cannot produce ADR 0004’s errors', () => {
  it('offers earlier scenes only', async () => {
    const pkg = await draft('cinderella');
    const scenes = inOrder(pkg.scene_cards);
    const third = scenes[2] as DraftSceneCard;
    const choices = plantChoices(pkg.scene_cards, third.id, 'anything');
    expect(choices.map((choice) => choice.id)).toEqual([scenes[0]?.id, scenes[1]?.id]);
  });

  it('says beside each whether that scene declares the fact', async () => {
    const pkg = await draft('the-dragon-of-thistlewick');
    const scenes = inOrder(pkg.scene_cards);
    const payoff = scenes.find((scene) => (scene.pays_off ?? []).some((p) => p.plant !== null));
    const entry = payoff?.pays_off.find((p) => p.plant !== null);
    const choices = plantChoices(pkg.scene_cards, payoff?.id ?? '', entry?.fact_ref ?? '');
    expect(choices.find((choice) => choice.id === entry?.plant)?.declares).toBe(true);
  });

  it('offers nothing to the first scene, which has nothing before it', async () => {
    const pkg = await draft('cinderella');
    expect(plantChoices(pkg.scene_cards, inOrder(pkg.scene_cards)[0]?.id ?? '', 'x')).toEqual([]);
  });
});

describe('what the editor says about a payoff is what the walk would say', () => {
  it('calls every fixture payoff sound, because the walk does', async () => {
    for (const fixture of FIXTURE_STORY_IDS) {
      const pkg = await draft(fixture);
      for (const scene of pkg.scene_cards) {
        for (const entry of scene.pays_off) {
          expect(payoffStatus(pkg, scene.id, entry)).toBe('ok');
        }
      }
      expect(lintStoryPackage(await readFixturePackage(fixture)).errors).toEqual([]);
    }
  });

  it('names each way a pair goes wrong', async () => {
    const pkg = await draft('the-dragon-of-thistlewick');
    const scenes = inOrder(pkg.scene_cards);
    const first = scenes[0] as DraftSceneCard;
    const last = scenes[scenes.length - 1] as DraftSceneCard;

    expect(payoffStatus(pkg, last.id, { fact_ref: '', plant: null })).toBe('no_fact');
    expect(payoffStatus(pkg, last.id, { fact_ref: 'x', plant: 'scene_nowhere' })).toBe(
      'plant_scene_unknown',
    );
    expect(payoffStatus(pkg, first.id, { fact_ref: 'x', plant: last.id })).toBe(
      'plant_after_payoff',
    );
    expect(payoffStatus(pkg, last.id, { fact_ref: 'not_declared_anywhere', plant: first.id })).toBe(
      'plant_not_declared',
    );
    expect(payoffStatus(pkg, last.id, { fact_ref: 'nothing_seeds_this', plant: null })).toBe(
      'unfounded_seed_payoff',
    );
  });

  it('accepts a seed-grounded payoff where the seed grounds it', async () => {
    const pkg = await draft('a-christmas-carol');
    const seeded = [...draftSeedFacts(pkg)];
    expect(seeded.length).toBeGreaterThan(0);
    const last = inOrder(pkg.scene_cards).at(-1) as DraftSceneCard;
    expect(payoffStatus(pkg, last.id, { fact_ref: seeded[0] as string, plant: null })).toBe('ok');
  });
});

describe('fact refs, which nothing but discipline keeps consistent', () => {
  it('gathers every ref the package already uses, sorted and deduplicated', async () => {
    const pkg = await draft('the-dragon-of-thistlewick');
    const refs = factRefsInUse(pkg);
    expect(refs).toEqual([...new Set(refs)].sort());
    for (const scene of pkg.scene_cards) {
      for (const ref of scene.reader_must_learn) expect(refs).toContain(ref);
      for (const payoff of scene.pays_off) expect(refs).toContain(payoff.fact_ref);
    }
  });

  it('includes what the seed establishes, which a payoff may ground itself in', async () => {
    const pkg = await draft('a-christmas-carol');
    for (const fact of draftSeedFacts(pkg)) expect(factRefsInUse(pkg)).toContain(fact);
  });
});

describe('one defect, one report', () => {
  it('does not report a plant-after-payoff twice because two passes catch it', async () => {
    // The cross-reference pass and ADR 0004's plant walk both catch this, and both are right.
    // Two phrasings of one defect reads as two defects.
    const pkg = await readFixturePackage('the-dragon-of-thistlewick');
    const scenes = [...pkg.scene_cards].sort((a, b) => a.order - b.order);
    const first = scenes[0] as (typeof scenes)[number];
    const last = scenes[scenes.length - 1] as (typeof scenes)[number];

    // Move the plant scene to the end, which is what a reorder in the editor does — and so it
    // is `resequence`, which takes the array as the sequence, not `renumber`, which would sort
    // it straight back by the `order` the move has not rewritten yet.
    const reordered = resequence([
      ...scenes.filter((scene) => scene.id !== first.id),
      first,
    ] as DraftSceneCard[]);
    const lint = lintStoryPackage({ ...pkg, scene_cards: reordered } as unknown as StoryPackage);

    const offending = lint.errors.filter(
      (problem) => problem.code === 'plant_after_payoff' && problem.path.includes(last.id),
    );
    expect(offending).toHaveLength(1);
    expect(new Set(lint.problems.map((p) => `${p.severity}|${p.code}|${p.path}`)).size).toBe(
      lint.problems.length,
    );
  });
});

describe('a scene’s lint path', () => {
  it('matches what the linter reports, so a row can count its own problems', async () => {
    const pkg = await readFixturePackage('the-dragon-of-thistlewick');
    const broken = {
      ...pkg,
      scene_cards: pkg.scene_cards.map((scene, index) =>
        index === 0 ? { ...scene, pov: 'char_nobody' } : scene,
      ),
    };
    const lint = lintStoryPackage(broken);
    const first = pkg.scene_cards[0]?.id ?? '';
    expect(lint.errors.some((problem) => problem.path === scenePath(first, 'pov'))).toBe(true);
    expect(lint.errors.every((problem) => problem.path.startsWith(scenePath(first)))).toBe(true);
  });
});
