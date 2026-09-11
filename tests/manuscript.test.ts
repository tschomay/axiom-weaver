import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import {
  ManuscriptConflictError,
  StoryRepository,
} from '@/persistence/story-repository';
import { manuscriptPath, packageVersionPath } from '@/persistence/paths';
import {
  DraftStoryPackageSchema,
  ManuscriptSchema,
  parseManuscript,
} from '@/schema/manuscript';
import { StoryPackageSchema } from '@/schema/story-package';
import {
  ManuscriptSeedError,
  PublishRejectedError,
  publishManuscript,
  seedManuscript,
  slugifyStoryId,
  storyIdAvailable,
} from '@/authoring/manuscript';
import { loadFixtureIntoRepository, readFixturePackage } from '@/fixtures/load';

let root: string;
let repository: StoryRepository;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'axiom-weaver-manuscript-'));
  repository = new StoryRepository(new FileSystemBlobStore(root));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the relaxed schema', () => {
  it('round-trips a story that has no scenes yet', () => {
    const manuscript = parseManuscript({
      schema_version: '1.0',
      story_id: 'a-new-story',
      based_on_version: null,
      source: 'new',
      created_at: '2026-09-11T00:00:00Z',
      updated_at: '2026-09-11T00:00:00Z',
      package: { story_id: 'a-new-story', metadata: { title: 'A New Story' } },
    });

    expect(manuscript.package.scene_cards).toEqual([]);
    expect(manuscript.package.package_version).toBe(1);
    // A Story Package cannot be empty; a Manuscript being written toward one has to be.
    expect(StoryPackageSchema.safeParse(manuscript.package).success).toBe(false);
  });

  it('accepts a half-typed Scene Card that the strict schema rejects', () => {
    const draft = DraftStoryPackageSchema.parse({
      story_id: 'a-new-story',
      metadata: { title: 'A New Story' },
      scene_cards: [{ id: '', order: 1 }],
    });

    expect(draft.scene_cards[0]).toMatchObject({ id: '', pov: '', characters_present: [] });
  });

  it('parses a complete Manuscript package as a Story Package unchanged', async () => {
    const pkg = await readFixturePackage('the-dragon-of-thistlewick');
    const draft = DraftStoryPackageSchema.parse(pkg);

    expect(StoryPackageSchema.parse(draft)).toEqual(pkg);
  });

  it('carries a package non-schema blocks through the relaxed parse', async () => {
    const pkg = (await readFixturePackage('cinderella')) as Record<string, unknown>;
    const draft = DraftStoryPackageSchema.parse(pkg) as Record<string, unknown>;

    // Both long fixtures attach `_authoring_conventions`; an editor that drops it silently
    // rewrites the author's own notes out of their package.
    expect(Object.keys(draft).sort()).toEqual(Object.keys(pkg).sort());
  });
});

describe('seeding', () => {
  it('slugs a story id the way the fixtures are named', () => {
    expect(slugifyStoryId('The Lamp at Cairn Head')).toBe('the-lamp-at-cairn-head');
    expect(slugifyStoryId('  A Christmas Carol!  ')).toBe('a-christmas-carol');
  });

  it('refuses a story id that is already taken, by package or by Manuscript', async () => {
    await loadFixtureIntoRepository('the-dragon-of-thistlewick', repository);
    expect(await storyIdAvailable(repository, 'the-dragon-of-thistlewick')).toBe(false);

    await seedManuscript(repository, {
      source: 'new',
      story_id: 'unpublished',
      title: 'Unpublished',
    });
    expect(await storyIdAvailable(repository, 'unpublished')).toBe(false);

    await expect(
      seedManuscript(repository, { source: 'new', story_id: 'unpublished', title: 'Again' }),
    ).rejects.toThrow(ManuscriptSeedError);
  });

  it('refuses a story id that is not a usable slug', async () => {
    expect(await storyIdAvailable(repository, 'Not A Slug')).toBe(false);
    await expect(
      seedManuscript(repository, { source: 'new', story_id: 'Not A Slug', title: 'x' }),
    ).rejects.toMatchObject({ reason: 'invalid_story_id' });
  });

  it('seeds an edit from the story current package, and reopens the same Manuscript', async () => {
    await loadFixtureIntoRepository('the-amber-cat', repository);

    const first = await seedManuscript(repository, { source: 'edit', story_id: 'the-amber-cat' });
    expect(first.based_on_version).toBe(1);
    expect(first.package.scene_cards).toHaveLength(4);

    const again = await seedManuscript(repository, { source: 'edit', story_id: 'the-amber-cat' });
    expect(again.created_at).toBe(first.created_at);
  });

  it('duplicates the package and nothing else', async () => {
    await loadFixtureIntoRepository('the-dragon-of-thistlewick', repository);

    const copy = await seedManuscript(repository, {
      source: 'duplicate',
      story_id: 'the-dragon-again',
      from_story_id: 'the-dragon-of-thistlewick',
      title: 'The Dragon Again',
    });

    expect(copy.package.story_id).toBe('the-dragon-again');
    expect(copy.package.package_version).toBe(1);
    expect(copy.based_on_version).toBeNull();
    expect(copy.duplicated_from).toEqual({
      story_id: 'the-dragon-of-thistlewick',
      package_version: 1,
    });
    expect(copy.package.scene_cards).toHaveLength(3);
    // Entity ids are story-scoped, so they travel as they are.
    expect(copy.package.world_model_seed.characters?.length).toBeGreaterThan(0);

    // Nothing else came with it: no published package, no runs, no Working Draft.
    expect(await repository.getPointer('the-dragon-again')).toBeNull();
    expect((await repository.getRunIndex('the-dragon-again')).runs).toEqual([]);
    expect(await repository.listPackageVersions('the-dragon-again')).toEqual([]);
  });

  it('refuses to duplicate a version that was never retained', async () => {
    await loadFixtureIntoRepository('the-dragon-of-thistlewick', repository);
    await expect(
      seedManuscript(repository, {
        source: 'duplicate',
        story_id: 'the-dragon-again',
        from_story_id: 'the-dragon-of-thistlewick',
        from_version: 7,
      }),
    ).rejects.toMatchObject({ reason: 'version_not_found' });
  });
});

describe('the updated_at precondition', () => {
  it('rejects a save whose stored copy has moved on', async () => {
    const seeded = await seedManuscript(repository, {
      source: 'new',
      story_id: 'two-tabs',
      title: 'Two Tabs',
    });

    const fromTabA = await repository.putManuscript(
      { ...seeded, package: { ...seeded.package, metadata: { title: 'Tab A' } } },
      seeded.updated_at,
    );
    expect(fromTabA.package.metadata.title).toBe('Tab A');

    // Tab B still holds the value it read before tab A saved.
    await expect(
      repository.putManuscript(
        { ...seeded, package: { ...seeded.package, metadata: { title: 'Tab B' } } },
        seeded.updated_at,
      ),
    ).rejects.toThrow(ManuscriptConflictError);

    const stored = await repository.getManuscript('two-tabs');
    expect(stored?.package.metadata.title).toBe('Tab A');
  });
});

  /**
   * `updated_at` is the precondition token, not decoration.
   *
   * Two saves inside one millisecond used to mint the same string, which made a *stale* save
   * match it and be accepted — one tab silently clobbering the other. Measured at 5 of 40
   * back-to-back saves before the fix, so the loop below is not paranoia: it is the rate at
   * which the guard used to fail open.
   */
  it('never mints the same token twice, however fast the saves land', async () => {
    const seeded = await seedManuscript(repository, {
      source: 'new',
      story_id: 'fast-saves',
      title: 'Fast Saves',
    });

    const seen = new Set<string>([seeded.updated_at]);
    let current = seeded;
    for (let save = 0; save < 40; save += 1) {
      current = await repository.putManuscript(
        { ...current, package: { ...current.package, metadata: { title: `save ${save}` } } },
        current.updated_at,
      );
      expect(seen.has(current.updated_at)).toBe(false);
      expect(current.updated_at > [...seen].at(-1)!).toBe(true);
      seen.add(current.updated_at);
    }
  });

  it('refuses a stale save even when it lands in the same millisecond', async () => {
    // Forty independent races, because before the fix only about one in eight lost.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const storyId = `race-${attempt}`;
      const seeded = await seedManuscript(repository, {
        source: 'new',
        story_id: storyId,
        title: 'Race',
      });

      const tabA = await repository.putManuscript(
        { ...seeded, package: { ...seeded.package, metadata: { title: 'Tab A' } } },
        seeded.updated_at,
      );
      expect(tabA.updated_at).not.toBe(seeded.updated_at);

      // Tab B holds what it read before tab A saved, and must be refused every single time.
      await expect(
        repository.putManuscript(
          { ...seeded, package: { ...seeded.package, metadata: { title: 'Tab B' } } },
          seeded.updated_at,
        ),
      ).rejects.toThrow(ManuscriptConflictError);

      expect((await repository.getManuscript(storyId))?.package.metadata.title).toBe('Tab A');
    }
  });

describe('discard', () => {
  it('returns the story to its published package, and is idempotent', async () => {
    await loadFixtureIntoRepository('the-dragon-of-thistlewick', repository);
    await seedManuscript(repository, {
      source: 'edit',
      story_id: 'the-dragon-of-thistlewick',
    });

    await repository.deleteManuscript('the-dragon-of-thistlewick');
    await repository.deleteManuscript('the-dragon-of-thistlewick');

    expect(await repository.getManuscript('the-dragon-of-thistlewick')).toBeNull();
    expect(await repository.getCurrentPackage('the-dragon-of-thistlewick')).not.toBeNull();
  });
});

describe('publishing', () => {
  it('writes consecutive versions and never rewrites a retained snapshot', async () => {
    await loadFixtureIntoRepository('the-dragon-of-thistlewick', repository);
    const storyId = 'the-dragon-of-thistlewick';

    const opened = await seedManuscript(repository, { source: 'edit', story_id: storyId });
    const edited = await repository.putManuscript(
      {
        ...opened,
        package: {
          ...opened.package,
          metadata: { ...opened.package.metadata, title: 'The Dragon, Revised' },
        },
      },
      opened.updated_at,
    );
    expect(edited.package.metadata.title).toBe('The Dragon, Revised');

    const first = await publishManuscript(repository, storyId);
    expect(first.published.package_version).toBe(2);
    expect(first.manuscript.based_on_version).toBe(2);
    expect(first.published.metadata.title).toBe('The Dragon, Revised');

    // The Manuscript survives, so a second publish is a real second version rather than a throw.
    const second = await publishManuscript(repository, storyId);
    expect(second.published.package_version).toBe(3);
    expect(await repository.listPackageVersions(storyId)).toEqual([1, 2, 3]);

    // Version 1 is untouched: the edition that pins it still dereferences to what it compiled.
    const original = await readFixturePackage('the-dragon-of-thistlewick');
    expect(await repository.getPackageVersion(storyId, 1)).toEqual(original);
  });

  it('lands on max(retained) + 1 even when based_on_version is behind', async () => {
    await loadFixtureIntoRepository('the-dragon-of-thistlewick', repository);
    const storyId = 'the-dragon-of-thistlewick';
    const opened = await seedManuscript(repository, { source: 'edit', story_id: storyId });
    expect(opened.based_on_version).toBe(1);

    // Something else advanced the story while this Manuscript sat open — exactly the case that
    // would collide with a version an edition already pins if publish did based_on_version + 1.
    const pkg = await readFixturePackage('the-dragon-of-thistlewick');
    await repository.putPackage({ ...pkg, package_version: 2 });

    const published = await publishManuscript(repository, storyId);
    expect(published.published.package_version).toBe(3);
  });

  it('publishes a duplicate as version 1 of its own story', async () => {
    await loadFixtureIntoRepository('the-dragon-of-thistlewick', repository);
    await seedManuscript(repository, {
      source: 'duplicate',
      story_id: 'the-dragon-again',
      from_story_id: 'the-dragon-of-thistlewick',
      title: 'The Dragon Again',
    });

    const published = await publishManuscript(repository, 'the-dragon-again');
    expect(published.published.package_version).toBe(1);
    expect(published.published.story_id).toBe('the-dragon-again');
    expect(await repository.getCurrentPackage('the-dragon-again')).not.toBeNull();
  });

  it('refuses to publish a package the linter rejects, and writes nothing', async () => {
    await loadFixtureIntoRepository('the-amber-cat', repository);
    const opened = await seedManuscript(repository, { source: 'edit', story_id: 'the-amber-cat' });

    const broken = structuredClone(opened.package);
    broken.scene_cards[0]!.pov = 'char_nobody';
    await repository.putManuscript({ ...opened, package: broken }, opened.updated_at);

    await expect(publishManuscript(repository, 'the-amber-cat')).rejects.toThrow(
      PublishRejectedError,
    );
    expect(await repository.listPackageVersions('the-amber-cat')).toEqual([1]);
  });

  it('refuses to publish an empty Manuscript', async () => {
    await seedManuscript(repository, { source: 'new', story_id: 'empty', title: 'Empty' });

    await expect(publishManuscript(repository, 'empty')).rejects.toThrow(PublishRejectedError);
    expect(await repository.getPointer('empty')).toBeNull();
  });
});

describe('the Manuscript stays invisible', () => {
  it('lives beside the pointer and leaves the published package alone', async () => {
    await loadFixtureIntoRepository('the-dragon-of-thistlewick', repository);
    const storyId = 'the-dragon-of-thistlewick';
    const opened = await seedManuscript(repository, { source: 'edit', story_id: storyId });

    await repository.putManuscript(
      {
        ...opened,
        package: {
          ...opened.package,
          metadata: { ...opened.package.metadata, title: 'Not published yet' },
        },
      },
      opened.updated_at,
    );

    const current = await repository.getCurrentPackage(storyId);
    expect(current?.metadata.title).not.toBe('Not published yet');
    expect(current?.package_version).toBe(1);
    expect(manuscriptPath(storyId)).toBe(`story/${storyId}/manuscript.json`);
    expect(packageVersionPath(storyId, 1)).toBe(`story/${storyId}/package/1.json`);
  });

  it('is not counted as a story until it publishes', async () => {
    await seedManuscript(repository, { source: 'new', story_id: 'unborn', title: 'Unborn' });
    expect(await repository.listStoryIds()).toEqual([]);
  });
});

describe('ManuscriptSchema', () => {
  it('requires a source and rejects an unknown one', () => {
    expect(
      ManuscriptSchema.safeParse({
        schema_version: '1.0',
        story_id: 'x',
        based_on_version: null,
        source: 'imported',
        created_at: 'now',
        updated_at: 'now',
        package: { story_id: 'x', metadata: { title: 'X' } },
      }).success,
    ).toBe(false);
  });
});
