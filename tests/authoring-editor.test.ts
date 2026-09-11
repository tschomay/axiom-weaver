/**
 * What the authoring screen decides (issue #88, ADR 0017 §6/§7).
 *
 * The components are thin by design — the rules they enforce live in `src/authoring/editor-model`,
 * which is where they can be checked. Three of those rules are load-bearing enough to be worth
 * pinning: a bag can never hold a nested value, a Voice Card is always written out whole, and
 * every lint problem's path names a section the screen can actually open.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import { StoryRepository } from '@/persistence/story-repository';
import { readFixturePackage } from '@/fixtures/load';
import { lintPackage, lintStoryPackage } from '@/authoring/lint';
import {
  RESERVED_STORY_IDS,
  seedManuscript,
  storyIdAvailable,
} from '@/authoring/manuscript';
import {
  BAG_ROW_TYPES,
  EDITOR_SECTIONS,
  bagFromRows,
  bagRowType,
  bagRows,
  bagSignature,
  choicesIncluding,
  coerceBagValue,
  columnTier,
  draftVoiceCard,
  entityChoices,
  mintEntityId,
  publishReadiness,
  reconcileBagRows,
  sceneChoices,
  sectionCounts,
  sectionForPath,
  seedIds,
  seedRowPath,
  voiceCardBlock,
  type BagRow,
} from '@/authoring/editor-model';
import { BagSchema } from '@/schema/story-package';
import { STYLE_PRESETS, cardFromPreset, parseVoiceCard } from '@/voice/voice-card';

const SEED = {
  characters: [
    { id: 'char_ella', name: 'Ella', location_id: 'loc_hearth' },
    { id: 'char_stepmother', name: 'The Stepmother' },
  ],
  locations: [{ id: 'loc_hearth', name: 'The Hearth' }],
  objects: [{ id: 'obj_slipper', name: 'A Glass Slipper' }],
  relationships: [],
  character_knowledge: [],
};

describe('bags: Principle 4 enforced by the control (ADR 0017 §6)', () => {
  it('offers no type that could produce a nested value', () => {
    // The absence *is* the enforcement: an author cannot be warned out of a control they were
    // never given.
    expect(BAG_ROW_TYPES).not.toContain('object');
    for (const type of BAG_ROW_TYPES) {
      const value = coerceBagValue('anything', type);
      expect(BagSchema.parse({ k: value })).toEqual({ k: value });
    }
  });

  it('round-trips every shape a bag value may take', () => {
    const bag = { note: 'ash', count: 3, cursed: true, nothing: null, tags: ['a', 'b'] };
    expect(bagFromRows(bagRows(bag))).toEqual(bag);
    expect(bagRows(bag).map((row) => row.type)).toEqual([
      'text',
      'number',
      'boolean',
      'empty',
      'list',
    ]);
  });

  it('drops a row the author has added but not named yet', () => {
    // Otherwise the autosave a second later writes an empty column into the package.
    const rows: BagRow[] = [
      { key: 'kept', type: 'text', value: 'yes' },
      { key: '  ', type: 'text', value: 'in progress' },
    ];
    expect(bagFromRows(rows)).toEqual({ kept: 'yes' });
  });

  it('keeps an unnamed row on screen while the package still holds what the rows produce', () => {
    // Dropping a blank key on the way into the package is what keeps autosave from writing an
    // empty column; the editor's own rows are what keep the author's half-typed row from
    // vanishing under them a keystroke later.
    const rows: BagRow[] = [
      { key: 'mood', type: 'text', value: 'grim' },
      { key: '', type: 'text', value: '' },
    ];
    const produced = bagFromRows(rows);
    expect(produced).toEqual({ mood: 'grim' });
    expect(reconcileBagRows(produced, { produced: bagSignature(produced), rows })).toHaveLength(2);
  });

  it('rebuilds its rows when the bag changes from anywhere else', () => {
    // A discard, a reloaded draft, a different entity: the in-progress blank belonged to the
    // edit that was replaced, and goes with it.
    const rows: BagRow[] = [{ key: '', type: 'text', value: '' }];
    const stale = { produced: bagSignature(bagFromRows(rows)), rows };
    expect(reconcileBagRows({ mood: 'grim' }, stale)).toEqual([
      { key: 'mood', type: 'text', value: 'grim' },
    ]);
    expect(reconcileBagRows({ mood: 'grim' }, null)).toHaveLength(1);
  });

  it('signs a bag by content, not by key order', () => {
    expect(bagSignature({ a: 1, b: 2 })).toBe(bagSignature({ b: 2, a: 1 }));
    expect(bagSignature({ a: 1 })).not.toBe(bagSignature({ a: 2 }));
    expect(bagSignature(undefined)).toBe(bagSignature({}));
  });

  it('keeps what it can when a row changes type', () => {
    expect(coerceBagValue(['ash', 'soot'], 'text')).toBe('ash, soot');
    expect(coerceBagValue('ash, soot', 'list')).toEqual(['ash', 'soot']);
    expect(coerceBagValue('3', 'number')).toBe(3);
    expect(coerceBagValue('not a number', 'number')).toBe(0);
    expect(coerceBagValue('false', 'boolean')).toBe(false);
    expect(coerceBagValue('', 'boolean')).toBe(false);
    expect(coerceBagValue('yes', 'boolean')).toBe(true);
    expect(coerceBagValue(['a'], 'empty')).toBeNull();
  });

  it('names the type of every value the schema allows', () => {
    expect(bagRowType(null)).toBe('empty');
    expect(bagRowType([])).toBe('list');
    expect(bagRowType(0)).toBe('number');
    expect(bagRowType(false)).toBe('boolean');
    expect(bagRowType('')).toBe('text');
  });
});

describe('the Voice Card is written out whole (ADR 0007 decision 4)', () => {
  it('materializes all nine fields when a preset is chosen', () => {
    const block = voiceCardBlock(cardFromPreset('fairy_tale_fable'));
    expect(Object.keys(block).sort()).toEqual([
      'based_on',
      'dialogue_density',
      'imagery_palette',
      'narrative_distance',
      'person',
      'register',
      'sentence_rhythm',
      'style_exemplar',
      'tense',
    ]);
  });

  it('leaves the other seven materialized when one field is overridden', () => {
    const preset = cardFromPreset('gothic_brooding');
    const edited = voiceCardBlock({ ...preset, register: 'flat and unbothered' });
    // Never a diff: every field the preset set is still spelled out, so a later edit to the
    // preset cannot reach back into a story already using it.
    expect(edited['register']).toBe('flat and unbothered');
    expect(edited['sentence_rhythm']).toBe(preset.sentence_rhythm);
    expect(edited['imagery_palette']).toEqual(preset.imagery_palette);
    expect(edited['based_on']).toBe('gothic_brooding');
    expect(() => parseVoiceCard(edited)).not.toThrow();
  });

  it('reads a brand-new story’s empty block without throwing', () => {
    // `parseVoiceCard` refuses this — correctly, it is not a publishable card — so the editor
    // needs its own forgiving read. The strict parse still happens, at publish.
    expect(() => parseVoiceCard({})).toThrow();
    const card = draftVoiceCard({});
    expect(card.person).toBe('');
    expect(card.imagery_palette).toEqual([]);
    expect(card.based_on).toBeNull();
  });

  it('accepts the `style_preset` spelling both fixtures use', () => {
    expect(draftVoiceCard({ style_preset: 'lyrical_literary' }).based_on).toBe('lyrical_literary');
  });

  it('round-trips every preset through the editor unchanged', () => {
    for (const preset of STYLE_PRESETS) {
      const through = voiceCardBlock(draftVoiceCard(voiceCardBlock(cardFromPreset(preset.id))));
      expect(through).toEqual(voiceCardBlock(cardFromPreset(preset.id)));
    }
  });
});

describe('pickers, so an id is never typed (ADR 0017 §6)', () => {
  it('lists only the tables a field may point at', () => {
    expect(entityChoices(SEED, ['location']).map((choice) => choice.id)).toEqual(['loc_hearth']);
    expect(entityChoices(SEED, ['character', 'object']).map((choice) => choice.id)).toEqual([
      'char_ella',
      'char_stepmother',
      'obj_slipper',
    ]);
  });

  it('labels a choice by name, falling back to the id', () => {
    const [first] = entityChoices({ characters: [{ id: 'char_x' }] }, ['character']);
    expect(first?.label).toBe('char_x');
    expect(entityChoices(SEED, ['character'])[0]?.label).toBe('Ella — char_ella');
  });

  it('keeps a dangling reference visible and selected', () => {
    // Snapping it to the first valid option would edit the story to make a lint error vanish.
    const choices = entityChoices(SEED, ['location']);
    const shown = choicesIncluding(choices, 'loc_deleted');
    expect(shown[0]?.id).toBe('loc_deleted');
    expect(shown[0]?.label).toContain('not in the seed');
    expect(shown).toHaveLength(choices.length + 1);
  });

  it('leaves the list alone when the current value is in it, or empty', () => {
    const choices = entityChoices(SEED, ['location']);
    expect(choicesIncluding(choices, 'loc_hearth')).toHaveLength(1);
    expect(choicesIncluding(choices, null)).toHaveLength(1);
    expect(choicesIncluding(choices, '')).toHaveLength(1);
  });

  it('offers scenes in Syuzhet order, not array order', () => {
    const scenes = [
      { id: 'scene_03', order: 3 },
      { id: 'scene_01', order: 1 },
      { id: 'scene_02', order: 2 },
    ];
    expect(sceneChoices(scenes).map((choice) => choice.id)).toEqual([
      'scene_01',
      'scene_02',
      'scene_03',
    ]);
  });
});

describe('minting ids the author never types', () => {
  it('derives an id from the name, the way both fixtures spell theirs', () => {
    expect(mintEntityId('char', 'Fairy Godmother', [])).toBe('char_fairy_godmother');
    expect(mintEntityId('loc', 'The Hive Yard', [])).toBe('loc_the_hive_yard');
  });

  it('steps past an id already in use, across every table', () => {
    expect(mintEntityId('char', 'Ella', seedIds(SEED))).toBe('char_ella_2');
    expect(mintEntityId('char', 'Ella', [...seedIds(SEED), 'char_ella_2'])).toBe('char_ella_3');
  });

  it('falls back to the bare prefix when there is no name to work from', () => {
    expect(mintEntityId('rel', '', [])).toBe('rel');
    expect(mintEntityId('rel', '1', [])).toBe('rel_1');
  });

  it('gathers ids from all five tables, ignoring rows with none yet', () => {
    expect(seedIds({ ...SEED, locations: [{ id: '' }, { id: 'loc_hearth' }] })).toEqual([
      'char_ella',
      'char_stepmother',
      'loc_hearth',
      'obj_slipper',
    ]);
  });
});

describe('a lint problem names a section the screen can open', () => {
  it('routes every path the linter produces to one of the five sections', () => {
    expect(sectionForPath('world_model_seed.characters.char_ella.location_id')).toBe('world');
    expect(sectionForPath('scene_cards.scene_04.pov')).toBe('scenes');
    expect(sectionForPath('voice_card')).toBe('voice');
    expect(sectionForPath('metadata.title')).toBe('story');
    expect(sectionForPath('story_id')).toBe('story');
    expect(sectionForPath('package_version')).toBe('publish');
  });

  it('lands every problem the fixtures actually produce on a real section', async () => {
    // The claim is about the linter's output, not about a list of paths written here by hand:
    // if a check starts reporting a new shape of path, this fails.
    for (const name of ['cinderella', 'a-christmas-carol', 'the-dragon-of-thistlewick']) {
      const lint = lintStoryPackage(await readFixturePackage(name));
      expect(lint.problems.length).toBeGreaterThan(0);
      for (const problem of lint.problems) {
        expect(EDITOR_SECTIONS).toContain(sectionForPath(problem.path));
      }
    }
  });

  it('builds the same path shape the linter reports for a seed row', async () => {
    const pkg = await readFixturePackage('the-dragon-of-thistlewick');
    const lint = lintPackage({
      ...pkg,
      world_model_seed: {
        ...pkg.world_model_seed,
        characters: [
          ...pkg.world_model_seed.characters,
          {
            id: 'char_nowhere',
            name: 'Nowhere',
            location_id: 'loc_missing',
            status: null,
            goal: null,
            bag: {},
          },
        ],
      },
    });
    const dangling = lint.errors.find((problem) => problem.message.includes('loc_missing'));
    expect(dangling?.path).toBe(seedRowPath('characters', 'char_nowhere', 'location_id'));
  });
});

describe('the first thing a new story is told', () => {
  it('says what a brand-new package is missing, in an author’s words', async () => {
    const root = await mkdtemp(join(tmpdir(), 'axiom-editor-'));
    try {
      const repository = new StoryRepository(new FileSystemBlobStore(root));
      const manuscript = await seedManuscript(repository, {
        source: 'new',
        story_id: 'nothing-yet',
        title: 'Nothing Yet',
      });
      const lint = lintPackage(manuscript.package);
      expect(lint.errors).toHaveLength(1);
      expect(lint.errors[0]?.path).toBe('scene_cards');
      // Zod would say "Too small: expected array to have >=1 items", which is a sentence about
      // the schema rather than about the story.
      expect(lint.errors[0]?.message).toBe(
        'a package needs at least one Scene Card before it can publish',
      );
      expect(sectionForPath(lint.errors[0]?.path ?? '')).toBe('scenes');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('tiers are shown where the assertion is made (ADR 0001 Principle 2)', () => {
  it('reports the declared tier per column, not per row', () => {
    expect(columnTier('character', 'goal')).toBe('V');
    expect(columnTier('character', 'location_id')).toBe('P');
    expect(columnTier('relationship', 'sentiment')).toBe('V');
    expect(columnTier('relationship', 'kind')).toBe('P');
    expect(columnTier('character', 'bag')).toBeNull();
    expect(columnTier('character', 'id')).toBeNull();
  });
});

describe('what publish says before the author commits (ADR 0017 §3)', () => {
  it('blocks on errors and never on warnings', () => {
    expect(publishReadiness({ nextVersion: 2, errors: 0, warnings: 9, basedOnVersion: 1 }).ready).toBe(
      true,
    );
    expect(publishReadiness({ nextVersion: 2, errors: 1, warnings: 0, basedOnVersion: 1 }).ready).toBe(
      false,
    );
  });

  it('warns about staleness only where there is a Working Draft to flag', () => {
    // A first publish has nothing compiled against it, so promising a stale draft would be a
    // warning about something that cannot happen.
    expect(
      publishReadiness({ nextVersion: 1, errors: 0, warnings: 0, basedOnVersion: null })
        .willFlagStale,
    ).toBe(false);
    expect(
      publishReadiness({ nextVersion: 4, errors: 0, warnings: 0, basedOnVersion: 3 }).willFlagStale,
    ).toBe(true);
  });
});

describe('a new story is an empty one, not a broken one', () => {
  it('counts nothing without throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'axiom-editor-'));
    try {
      const repository = new StoryRepository(new FileSystemBlobStore(root));
      const manuscript = await seedManuscript(repository, {
        source: 'new',
        story_id: 'a-blank-one',
        title: 'A Blank One',
      });
      expect(sectionCounts(manuscript.package)).toEqual({
        entities: 0,
        relationships: 0,
        scenes: 0,
      });
      expect(draftVoiceCard(manuscript.package.voice_card).based_on).toBeNull();
      expect(entityChoices(manuscript.package.world_model_seed, ['character'])).toEqual([]);
      expect(sceneChoices(manuscript.package.scene_cards)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('ids the router owns', () => {
  it('refuses a story id that would shadow a screen', async () => {
    // `/stories/new` is a static segment and wins over `[storyId]`, so a story that claimed `new`
    // would be one no URL could reach.
    const root = await mkdtemp(join(tmpdir(), 'axiom-editor-'));
    try {
      const repository = new StoryRepository(new FileSystemBlobStore(root));
      for (const reserved of RESERVED_STORY_IDS) {
        expect(await storyIdAvailable(repository, reserved)).toBe(false);
      }
      expect(await storyIdAvailable(repository, 'newish')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
