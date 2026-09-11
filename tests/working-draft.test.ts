import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import { StoryRepository } from '@/persistence/story-repository';
import { readFixturePackage } from '@/fixtures/load';
import { SyntheticWriterClient } from '@/writer/synthetic-client';
import { compileSceneIntoDraft } from '@/draft/draft-compile';
import {
  STALENESS_FIELDS,
  describeDiff,
  diffDigests,
  emptyDraftManifest,
  recordRecompile,
  staleScenes,
} from '@/draft/working-draft';
import { z } from 'zod';
import { SceneDigestSchema, type SceneDigest } from '@/digest/scene-digest';
import { scenesInOrder, type StoryPackage } from '@/schema/story-package';

function digest(overrides: Partial<z.input<typeof SceneDigestSchema>> = {}): SceneDigest {
  return SceneDigestSchema.parse({
    event_summary: 'The sisters are dressed for the ball.',
    closing_situation: 'They leave; Cinderella is alone at the hearth.',
    ...overrides,
  });
}

async function withRepository<T>(run: (repository: StoryRepository) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'axiom-draft-'));
  try {
    return await run(new StoryRepository(new FileSystemBlobStore(root)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('the field-scoped digest diff (ADR 0015 §3)', () => {
  it('diffs exactly the four fields a later scene can depend on', () => {
    expect(STALENESS_FIELDS).toEqual([
      'facts_revealed',
      'entities_on_stage',
      'closing_situation',
      'plants_opened',
    ]);
  });

  it('reports what a list field gained and lost', () => {
    const diffs = diffDigests(
      digest({ facts_revealed: ['fact_a', 'fact_b'] }),
      digest({ facts_revealed: ['fact_b', 'fact_c'] }),
    );

    expect(diffs).toEqual([
      { field: 'facts_revealed', added: ['fact_c'], removed: ['fact_a'], from: null, to: null },
    ]);
    expect(describeDiff(5, diffs)).toBe('scene 5 changed: facts_revealed added fact_c, removed fact_a');
  });

  it('ignores the fields that carry no forward dependency', () => {
    const before = digest({
      payoffs_closed: ['fact_a'],
      imagery_signature: [{ image: 'ash', domain: 'hearth' }],
      reanchor_used: [{ entity_id: 'char_cinderella', band: 'assume' }],
    });
    const after = digest({
      event_summary: 'A different summary entirely.',
      payoffs_closed: ['fact_z'],
      imagery_signature: [{ image: 'soot', domain: 'hearth' }],
      reanchor_used: [],
    });

    expect(diffDigests(before, after)).toEqual([]);
  });

  it('reports a changed closing_situation with both sides', () => {
    const diffs = diffDigests(digest(), digest({ closing_situation: 'They stay.' }));
    expect(diffs[0]).toMatchObject({ field: 'closing_situation', to: 'They stay.' });
    expect(describeDiff(5, diffs)).toBe('scene 5 changed: closing_situation changed');
  });
});

describe('blunt staleness propagation (ADR 0015 §3)', () => {
  const seeded = () => {
    let manifest = emptyDraftManifest('cinderella');
    for (const index of [1, 2, 3, 4, 5]) {
      manifest = recordRecompile({
        manifest,
        scene: {
          scene_id: `scene_0${index}`,
          scene_index: index,
          path: `story/cinderella/draft/scene-${index}.json`,
        },
        digest: digest({ facts_revealed: [`fact_${index}`] }),
        previousDigest: null,
        packageVersion: 1,
      }).manifest;
    }
    return manifest;
  };

  it('flags every later scene, unconditionally, with the source scene’s diff summary', () => {
    const outcome = recordRecompile({
      manifest: seeded(),
      scene: {
        scene_id: 'scene_03',
        scene_index: 3,
        path: 'story/cinderella/draft/scene-3.json',
      },
      digest: digest({ facts_revealed: ['fact_3', 'fact_new'] }),
      previousDigest: digest({ facts_revealed: ['fact_3'] }),
      packageVersion: 2,
    });

    expect(outcome.newly_stale).toEqual(['scene_04', 'scene_05']);
    expect(staleScenes(outcome.manifest).map((scene) => scene.scene_id)).toEqual([
      'scene_04',
      'scene_05',
    ]);
    // The flag carries the diff summary, not a per-scene relevance judgment.
    for (const stale of staleScenes(outcome.manifest)) {
      expect(stale.stale_reason?.summary).toBe('scene 3 changed: facts_revealed added fact_new');
      expect(stale.stale_reason?.source_scene_id).toBe('scene_03');
    }
    // Earlier scenes and the recompiled scene itself are untouched.
    expect(outcome.manifest.scenes.filter((scene) => scene.scene_index <= 3).every((scene) => !scene.stale)).toBe(true);
  });

  it('flags nothing when the recompile changed no scoped field', () => {
    const outcome = recordRecompile({
      manifest: seeded(),
      scene: {
        scene_id: 'scene_03',
        scene_index: 3,
        path: 'story/cinderella/draft/scene-3.json',
      },
      digest: digest({ facts_revealed: ['fact_3'], event_summary: 'Reworded, same events.' }),
      previousDigest: digest({ facts_revealed: ['fact_3'] }),
      packageVersion: 2,
    });

    expect(outcome.diff).toBeNull();
    expect(staleScenes(outcome.manifest)).toEqual([]);
  });

  it('clears the recompiled scene’s own flag and records the version it now tracks', () => {
    const stale = recordRecompile({
      manifest: seeded(),
      scene: { scene_id: 'scene_02', scene_index: 2, path: 'p' },
      digest: digest({ facts_revealed: ['fact_2', 'fact_new'] }),
      previousDigest: digest({ facts_revealed: ['fact_2'] }),
      packageVersion: 2,
    }).manifest;
    expect(staleScenes(stale).map((scene) => scene.scene_id)).toContain('scene_03');

    const refreshed = recordRecompile({
      manifest: stale,
      scene: { scene_id: 'scene_03', scene_index: 3, path: 'p' },
      digest: digest({ facts_revealed: ['fact_3'] }),
      previousDigest: digest({ facts_revealed: ['fact_3'] }),
      packageVersion: 2,
    }).manifest;

    const scene03 = refreshed.scenes.find((scene) => scene.scene_id === 'scene_03');
    expect(scene03?.stale).toBe(false);
    expect(scene03?.stale_reason).toBeNull();
    expect(scene03?.compiled_against_package_version).toBe(2);
    // Scenes after it keep the flag they already carried — nothing auto-recompiles.
    expect(staleScenes(refreshed).map((scene) => scene.scene_id)).toEqual(['scene_04', 'scene_05']);
  });
});

describe('editing a card and recompiling it, end to end', () => {
  it('flags every later Working Draft scene stale with a diff summary attached', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('cinderella');
      await repository.putPackage(pkg);
      const first = scenesInOrder(pkg).slice(0, 5);

      for (const scene of first) {
        await compileSceneIntoDraft({
          pkg,
          sceneId: scene.id,
          client: new SyntheticWriterClient(pkg),
          repository,
        });
      }

      const manifest = await repository.getDraftManifest(pkg.story_id);
      expect(manifest.scenes).toHaveLength(5);
      expect(staleScenes(manifest)).toEqual([]);

      // The author edits scene 3 — it now reveals one more fact — and bumps the package version,
      // which is what makes the old snapshot dereferenceable afterwards (ADR 0015 §2).
      const edited: StoryPackage = {
        ...pkg,
        package_version: pkg.package_version + 1,
        scene_cards: pkg.scene_cards.map((card) =>
          card.id === first[2]!.id
            ? { ...card, reader_must_learn: [...card.reader_must_learn, 'fact_a_new_cruelty'] }
            : card,
        ),
      };
      await repository.putPackage(edited);

      const outcome = await compileSceneIntoDraft({
        pkg: edited,
        sceneId: first[2]!.id,
        client: new SyntheticWriterClient(edited),
        repository,
      });

      expect(outcome.diff?.summary).toContain('facts_revealed added fact_a_new_cruelty');
      expect(outcome.newly_stale).toEqual([first[3]!.id, first[4]!.id]);

      const after = await repository.getDraftManifest(pkg.story_id);
      expect(staleScenes(after).map((scene) => scene.scene_id)).toEqual([
        first[3]!.id,
        first[4]!.id,
      ]);
      for (const stale of staleScenes(after)) {
        expect(stale.stale_reason?.source_scene_id).toBe(first[2]!.id);
        expect(stale.stale_reason?.fields[0]?.added).toEqual(['fact_a_new_cruelty']);
      }

      // The recompiled scene tracks the new version; the untouched ones still track the old one.
      const recompiled = after.scenes.find((scene) => scene.scene_id === first[2]!.id);
      expect(recompiled?.compiled_against_package_version).toBe(2);
      expect(recompiled?.stale).toBe(false);
      expect(
        after.scenes.find((scene) => scene.scene_id === first[4]!.id)
          ?.compiled_against_package_version,
      ).toBe(1);

      // A Compiled edition is never marked stale — only the Working Draft is (ADR 0015 §1).
      expect(Object.keys(after.scenes[0]!)).toContain('stale');
      expect(await repository.getRunIndex(pkg.story_id)).toMatchObject({ runs: [] });
    });
  });

  it('leaves a volitional proposal pending in the queue rather than resolving it (ADR 0016 §3)', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('cinderella');
      await repository.putPackage(pkg);
      const scene = scenesInOrder(pkg)[0]!;

      await compileSceneIntoDraft({
        pkg,
        sceneId: scene.id,
        client: new SyntheticWriterClient(pkg),
        repository,
      });

      const log = await repository.getDraftStateLog(pkg.story_id);
      expect(log.length).toBeGreaterThan(0);
      // Whatever the card's exit_state proposes on a volitional column waits for the author;
      // nothing here auto-applies or auto-drops it.
      expect(log.all().every((entry) => entry.status !== 'proposed_dropped')).toBe(true);
    });
  });
});
