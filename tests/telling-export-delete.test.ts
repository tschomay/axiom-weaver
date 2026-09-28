import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import { StoryRepository, TellingDeletionError } from '@/persistence/story-repository';
import { editionPrefix } from '@/persistence/paths';
import { readFixturePackage } from '@/fixtures/load';
import { SyntheticWriterClient } from '@/writer/synthetic-client';
import { runTelling } from '@/edition/run-loop';
import { ABANDONED_AFTER_MS } from '@/edition/edition';
import { exportFileName, renderEditionHtml } from '@/edition/export';
import type { StoryPackage } from '@/schema/story-package';

async function withRepository<T>(
  run: (repository: StoryRepository, pkg: StoryPackage, store: FileSystemBlobStore) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'axiom-delete-'));
  try {
    const store = new FileSystemBlobStore(root);
    const repository = new StoryRepository(store);
    const pkg = await readFixturePackage('the-dragon-of-thistlewick');
    await repository.putPackage(pkg);
    return await run(repository, pkg, store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const telling = (repository: StoryRepository, pkg: StoryPackage) =>
  runTelling({ pkg, client: new SyntheticWriterClient(pkg), repository });

describe('deleting a telling', () => {
  it('removes the edition, its run report and its index entry — and only that run', async () => {
    await withRepository(async (repository, pkg, store) => {
      const doomed = await telling(repository, pkg);
      const kept = await telling(repository, pkg);
      await repository.saveToLibrary(doomed.manifest.run_id, 'Soon gone');

      const index = await repository.deleteTelling(doomed.manifest.run_id);

      expect(index.runs.map((run) => run.run_id)).toEqual([kept.manifest.run_id]);
      expect(await store.list(editionPrefix(doomed.manifest.run_id))).toEqual([]);
      expect(await repository.getEditionManifest(doomed.manifest.run_id)).toBeNull();
      expect(await repository.getRunReport(doomed.manifest.run_id)).toBeNull();
      expect(await repository.getEditionScenes(kept.manifest.run_id)).toHaveLength(3);
    });
  });

  it('deletes a failed run', async () => {
    await withRepository(async (repository, pkg) => {
      const { manifest } = await telling(repository, pkg);
      const failed = { ...manifest, status: 'failed' as const };
      await repository.putEditionManifest(failed);
      await repository.registerRun(failed);

      const index = await repository.deleteTelling(manifest.run_id);
      expect(index.runs).toEqual([]);
    });
  });

  it('refuses the Baked edition', async () => {
    await withRepository(async (repository, pkg) => {
      const { manifest } = await telling(repository, pkg);
      await repository.promoteToBaked(manifest.run_id);

      await expect(repository.deleteTelling(manifest.run_id)).rejects.toThrow(/Baked edition/);
      expect(await repository.getEditionManifest(manifest.run_id)).not.toBeNull();
    });
  });

  it('refuses a run still reporting, but not one that has stopped', async () => {
    await withRepository(async (repository, pkg) => {
      const { manifest } = await telling(repository, pkg);
      const now = new Date();
      await repository.putEditionManifest({
        ...manifest,
        status: 'running',
        updated_at: now.toISOString(),
      });

      await expect(repository.deleteTelling(manifest.run_id, now)).rejects.toBeInstanceOf(
        TellingDeletionError,
      );

      const later = new Date(now.getTime() + ABANDONED_AFTER_MS + 1000);
      const index = await repository.deleteTelling(manifest.run_id, later);
      expect(index.runs).toEqual([]);
    });
  });

  it('refuses a run that does not exist', async () => {
    await withRepository(async (repository) => {
      await expect(repository.deleteTelling('no-such-run')).rejects.toThrow(/no such run/);
    });
  });
});

describe('exporting a telling', () => {
  const edition = {
    title: 'The Dragon of <Thistlewick>',
    run_id: 'dragon-20260928-abc',
    name: null,
    completed_at: '2026-09-28T10:00:00.000Z',
    scenes: [
      { scene_index: 2, prose: 'Second scene.' },
      { scene_index: 1, prose: 'First paragraph.\n\nSecond "paragraph" & more.\nSame paragraph.' },
    ],
  };

  it('renders a standalone document with the prose in scene order, escaped', () => {
    const html = renderEditionHtml(edition);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<h1>The Dragon of &lt;Thistlewick&gt;</h1>');
    expect(html).toContain('<p>First paragraph.</p>');
    expect(html).toContain('<p>Second &quot;paragraph&quot; &amp; more.<br>Same paragraph.</p>');
    expect(html.indexOf('First paragraph')).toBeLessThan(html.indexOf('Second scene'));
    expect(html).toContain('compiled 2026-09-28');
    // Offline-readable: nothing fetched from anywhere.
    expect(html).not.toMatch(/<script|<link|src=/);
  });

  it('carries the library name when the telling has one', () => {
    const html = renderEditionHtml({ ...edition, name: 'The one with the bees' });
    expect(html).toContain('<title>The one with the bees</title>');
    expect(html).toContain('<p class="subtitle">The one with the bees</p>');
  });

  it('names the file after the story and the run', () => {
    expect(exportFileName(edition)).toBe('the-dragon-of-thistlewick-dragon-20260928-abc.html');
    expect(exportFileName({ ...edition, title: '???' })).toBe('telling-dragon-20260928-abc.html');
    expect(
      exportFileName({ ...edition, title: 'The Dragon', run_id: 'the-dragon-20260928-abc' }),
    ).toBe('the-dragon-20260928-abc.html');
  });
});
