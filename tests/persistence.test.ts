import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import { BlobConflictError } from '@/persistence/blob-store';
import {
  PackageVersionConflictError,
  StoryRepository,
} from '@/persistence/story-repository';
import {
  draftStateLogPath,
  editionStateLogPath,
  packagePointerPath,
  packageVersionPath,
  versionFromPackagePath,
} from '@/persistence/paths';
import { StateLog } from '@/world-model/state-log';
import { readFixturePackage } from '@/fixtures/load';
import type { StoryPackage } from '@/schema/story-package';

let root: string;
let store: FileSystemBlobStore;
let repository: StoryRepository;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'axiom-weaver-'));
  store = new FileSystemBlobStore(root);
  repository = new StoryRepository(store);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('blob paths', () => {
  it('follows the layout ADR 0015 §2/§4 and ADR 0016 §2 fix', () => {
    expect(packagePointerPath('cinderella')).toBe('story/cinderella/package.json');
    expect(packageVersionPath('cinderella', 3)).toBe('story/cinderella/package/3.json');
    expect(draftStateLogPath('cinderella')).toBe('story/cinderella/draft/state-log.json');
    expect(editionStateLogPath('run_42')).toBe('edition/run_42/state-log.json');
    expect(versionFromPackagePath('story/cinderella/package/3.json')).toBe(3);
    expect(versionFromPackagePath('story/cinderella/package.json')).toBeNull();
  });
});

describe('FileSystemBlobStore', () => {
  it('refuses to overwrite by default, as Vercel Blob does', async () => {
    await store.put('story/x/package/1.json', '{}');
    await expect(store.put('story/x/package/1.json', '{}')).rejects.toBeInstanceOf(
      BlobConflictError,
    );
    await store.put('story/x/package/1.json', '{"v":2}', { allowOverwrite: true });
    expect(await store.get('story/x/package/1.json')).toBe('{"v":2}');
  });

  it('lists by prefix and reports a missing pathname as null', async () => {
    await store.put('story/x/package/1.json', '{}');
    await store.put('story/x/package/2.json', '{}');
    await store.put('edition/run_1/manifest.json', '{}');

    expect(await store.list('story/x/package/')).toEqual([
      'story/x/package/1.json',
      'story/x/package/2.json',
    ]);
    expect(await store.get('story/x/package/9.json')).toBeNull();
  });

  it('refuses a pathname that escapes the store root', async () => {
    await expect(store.put('../escape.json', '{}')).rejects.toThrow(/escapes the store root/);
  });
});

describe('StoryRepository — retained package_version snapshots (ADR 0015 §2)', () => {
  let cinderella: StoryPackage;

  beforeEach(async () => {
    cinderella = await readFixturePackage('cinderella');
  });

  it('writes a snapshot per version and a pointer to the current one', async () => {
    const pointer = await repository.putPackage(cinderella);

    expect(pointer).toMatchObject({
      story_id: 'cinderella',
      current_package_version: 1,
      package_path: 'story/cinderella/package/1.json',
    });
    expect(await store.head('story/cinderella/package/1.json')).toBe(true);
    expect(await store.head('story/cinderella/package.json')).toBe(true);
    expect(await repository.listStoryIds()).toEqual(['cinderella']);
  });

  it('keeps an old version dereferenceable after the author advances the package', async () => {
    await repository.putPackage(cinderella);
    const edited: StoryPackage = {
      ...cinderella,
      package_version: 2,
      metadata: { ...cinderella.metadata, title: 'Cinderella (revised)' },
    };
    await repository.putPackage(edited);

    expect(await repository.listPackageVersions('cinderella')).toEqual([1, 2]);
    // This is what an edition pinned to package_version 1 resolves to.
    expect((await repository.getPackageVersion('cinderella', 1))?.metadata.title).toBe(
      cinderella.metadata.title,
    );
    expect((await repository.getCurrentPackage('cinderella'))?.package_version).toBe(2);
  });

  it('is idempotent for an unchanged re-load', async () => {
    await repository.putPackage(cinderella);
    await expect(repository.putPackage(cinderella)).resolves.toMatchObject({
      current_package_version: 1,
    });
    expect(await repository.listPackageVersions('cinderella')).toEqual([1]);
  });

  it('refuses to rewrite a retained snapshot with different content', async () => {
    await repository.putPackage(cinderella);
    const edited: StoryPackage = {
      ...cinderella,
      metadata: { ...cinderella.metadata, title: 'Cinderella (edited without a version bump)' },
    };

    await expect(repository.putPackage(edited)).rejects.toBeInstanceOf(
      PackageVersionConflictError,
    );
  });

  it('round-trips a package through a snapshot with its non-schema keys intact', async () => {
    await repository.putPackage(cinderella);
    const restored = await repository.getPackageVersion('cinderella', 1);

    expect(restored).toEqual(cinderella);
    expect(restored).toHaveProperty('_authoring_conventions');
  });
});

describe('StoryRepository — state logs', () => {
  it('starts a Working Draft log empty and persists appends over it', async () => {
    const empty = await repository.getDraftStateLog('cinderella');
    expect(empty.length).toBe(0);

    empty.append({
      scene_index: 1,
      entity_id: 'char_cinderella',
      table: 'character',
      column: 'location_id',
      tier: 'P',
      previous_value: 'loc_house',
      new_value: 'loc_chimney_corner',
      status: 'committed',
    });
    await repository.putDraftStateLog(empty);

    const reread = await repository.getDraftStateLog('cinderella');
    expect(reread.all()).toEqual(empty.all());
    expect(reread.lastSceneIndex()).toBe(1);
  });

  it('writes an edition log once — it is immutable after the run completes', async () => {
    const log = new StateLog('cinderella', 'run_1');
    await repository.putEditionStateLog('run_1', log);

    expect((await repository.getEditionStateLog('run_1'))?.runId).toBe('run_1');
    await expect(repository.putEditionStateLog('run_1', log)).rejects.toBeInstanceOf(
      BlobConflictError,
    );
  });

  it('round-trips an edition World Model snapshot', async () => {
    const seed = await (async () => {
      await repository.putPackage(await readFixturePackage('cinderella'));
      return repository.getSeedWorldModel('cinderella');
    })();

    expect(seed).not.toBeNull();
    await repository.putEditionWorldModel('run_1', seed!);
    const restored = await repository.getEditionWorldModel('run_1', 'cinderella');

    expect(restored?.toJSON()).toEqual(seed!.toJSON());
  });
});
