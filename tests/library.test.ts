import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import { LibraryError, StoryRepository } from '@/persistence/story-repository';
import { readFixturePackage } from '@/fixtures/load';
import { SyntheticWriterClient } from '@/writer/synthetic-client';
import { runTelling } from '@/edition/run-loop';
import type { StoryPackage } from '@/schema/story-package';

async function withRepository<T>(
  run: (repository: StoryRepository, pkg: StoryPackage) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'axiom-library-'));
  try {
    const repository = new StoryRepository(new FileSystemBlobStore(root));
    const pkg = await readFixturePackage('the-dragon-of-thistlewick');
    await repository.putPackage(pkg);
    return await run(repository, pkg);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const telling = (repository: StoryRepository, pkg: StoryPackage) =>
  runTelling({ pkg, client: new SyntheticWriterClient(pkg), repository });

describe('the library (ADR 0015 §5)', () => {
  it('saves a finished telling under a name', async () => {
    await withRepository(async (repository, pkg) => {
      const { manifest } = await telling(repository, pkg);

      const index = await repository.saveToLibrary(manifest.run_id, '  The one with the bees  ');
      const entry = index.runs.find((run) => run.run_id === manifest.run_id);

      expect(entry?.saved).toBe(true);
      expect(entry?.name).toBe('The one with the bees');
      expect(entry?.saved_at).not.toBeNull();
    });
  });

  it('renames an entry already there', async () => {
    await withRepository(async (repository, pkg) => {
      const { manifest } = await telling(repository, pkg);
      await repository.saveToLibrary(manifest.run_id, 'First name');
      const index = await repository.saveToLibrary(manifest.run_id, 'Second name');

      expect(index.runs.filter((run) => run.saved)).toHaveLength(1);
      expect(index.runs.find((run) => run.saved)?.name).toBe('Second name');
    });
  });

  it('takes a telling off the list and never off the shelf', async () => {
    await withRepository(async (repository, pkg) => {
      const { manifest } = await telling(repository, pkg);
      await repository.saveToLibrary(manifest.run_id, 'Keep this one');

      const index = await repository.removeFromLibrary(pkg.story_id, manifest.run_id);

      expect(index.runs.filter((run) => run.saved)).toEqual([]);
      // ADR 0014 §3 / ADR 0015 §5: a completed run is never auto-deleted and stays addressable by
      // its own run id, so a reader who has the URL keeps it.
      expect(index.runs.map((run) => run.run_id)).toContain(manifest.run_id);
      expect(await repository.getEditionManifest(manifest.run_id)).not.toBeNull();
      expect(await repository.getEditionScenes(manifest.run_id)).toHaveLength(3);
    });
  });

  it('refuses a run that never finished — the library is what a reader returns to', async () => {
    await withRepository(async (repository, pkg) => {
      const { manifest } = await telling(repository, pkg);
      await repository.putEditionManifest({ ...manifest, status: 'running' });

      await expect(repository.saveToLibrary(manifest.run_id, 'Half a telling')).rejects.toThrow(
        LibraryError,
      );
    });
  });

  it('refuses an entry with no name', async () => {
    await withRepository(async (repository, pkg) => {
      const { manifest } = await telling(repository, pkg);
      await expect(repository.saveToLibrary(manifest.run_id, '   ')).rejects.toThrow(/needs a name/);
    });
  });

  it('refuses a run that does not exist', async () => {
    await withRepository(async (repository) => {
      await expect(repository.saveToLibrary('no-such-run', 'x')).rejects.toThrow(/no such run/);
    });
  });

  it('keeps the entry when the loop rewrites the run index', async () => {
    await withRepository(async (repository, pkg) => {
      const { manifest } = await telling(repository, pkg);
      await repository.saveToLibrary(manifest.run_id, 'Named before a re-register');

      // The loop calls `registerRun` at the start and close of every run; the library belongs to
      // the author, not the loop, so a run advancing must not clear it.
      await repository.registerRun(manifest);

      const index = await repository.getRunIndex(pkg.story_id);
      expect(index.runs.find((run) => run.run_id === manifest.run_id)?.name).toBe(
        'Named before a re-register',
      );
    });
  });

  it('is a shortlist, not the whole index', async () => {
    await withRepository(async (repository, pkg) => {
      const first = await telling(repository, pkg);
      await telling(repository, pkg);
      await repository.saveToLibrary(first.manifest.run_id, 'The keeper');

      const index = await repository.getRunIndex(pkg.story_id);
      expect(index.runs).toHaveLength(2);
      expect(index.runs.filter((run) => run.saved)).toHaveLength(1);
    });
  });
});
