import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import { StoryRepository } from '@/persistence/story-repository';
import { readFixturePackage } from '@/fixtures/load';
import { SyntheticWriterClient } from '@/writer/synthetic-client';
import { runTelling } from '@/edition/run-loop';
import {
  EditionDiffError,
  compareDigests,
  compareProposals,
  compareScenes,
  diffEditions,
} from '@/edition/edition-diff';
import { SceneDigestSchema, type SceneDigest } from '@/digest/scene-digest';
import type { EditionScene } from '@/edition/edition';
import type { StateLogEntry } from '@/world-model/state-log';

async function withRepository<T>(run: (repository: StoryRepository) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'axiom-edition-diff-'));
  try {
    return await run(new StoryRepository(new FileSystemBlobStore(root)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function digest(overrides: Partial<SceneDigest> = {}): SceneDigest {
  return SceneDigestSchema.parse({
    event_summary: 'She swept the ash.',
    entities_on_stage: ['char_cinderella'],
    facts_revealed: ['the_slipper_fits'],
    plants_opened: [],
    payoffs_closed: [],
    imagery_signature: [{ image: 'grey hearth ash', domain: 'hearth' }],
    closing_situation: 'She is at the grate.',
    reanchor_used: [],
    ...overrides,
  });
}

function scene(index: number, prose: string, overrides: Partial<SceneDigest> = {}): EditionScene {
  return {
    schema_version: '1.0',
    run_id: 'run',
    scene_id: `scene_0${index}`,
    scene_index: index,
    prose,
    digest: digest(overrides),
    compiled_at: new Date().toISOString(),
    degraded: false,
  };
}

function logEntry(overrides: Partial<StateLogEntry> = {}): StateLogEntry {
  return {
    scene_index: 3,
    scene_id: 'scene_03',
    entity_id: 'char_prince',
    table: 'character',
    column: 'goal',
    tier: 'V',
    previous_value: null,
    new_value: 'court the mysterious beauty',
    status: 'proposed_applied',
    sequence: 1,
    recorded_at: new Date().toISOString(),
    ...overrides,
  } as StateLogEntry;
}

describe('what the diff compares (ADR 0015 §6)', () => {
  it('reports a field that differs and stays quiet about one that matches', () => {
    const fields = compareDigests(
      digest({ imagery_signature: [{ image: 'grey hearth ash', domain: 'hearth' }] }),
      digest({ imagery_signature: [{ image: 'cold cinders', domain: 'hearth' }] }),
    );

    const imagery = fields.find((field) => field.field === 'imagery_signature');
    expect(imagery?.removed).toEqual(['hearth: grey hearth ash']);
    expect(imagery?.added).toEqual(['hearth: cold cinders']);

    // Same events, told differently: the fact set is untouched.
    const facts = fields.find((field) => field.field === 'facts_revealed');
    expect(facts?.added).toEqual([]);
    expect(facts?.removed).toEqual([]);
  });

  it('renders imagery with its domain, so a licensed motif reads differently from a new one', () => {
    const fields = compareDigests(
      digest({ imagery_signature: [{ image: 'grey hearth ash', domain: 'hearth' }] }),
      digest({ imagery_signature: [{ image: 'rain on glass', domain: 'weather' }] }),
    );
    const imagery = fields.find((field) => field.field === 'imagery_signature');
    // Same domain with new wording is the design working (ADR 0010 §4); a new domain is not, and
    // the diff has to let a reader tell them apart at a glance.
    expect(imagery?.added).toEqual(['weather: rain on glass']);
  });

  it('lines scenes up by scene_index, not by position in the list', () => {
    // A run that stopped early has fewer scene documents. Comparing its scene 3 against the
    // other's scene 4 would invent variance that is really a missing scene.
    const comparisons = compareScenes(
      [scene(1, 'A one'), scene(3, 'A three')],
      [scene(1, 'B one'), scene(2, 'B two'), scene(3, 'B three')],
    );

    expect(comparisons.map((item) => item.scene_index)).toEqual([1, 2, 3]);
    const only = comparisons.find((item) => item.scene_index === 2);
    expect(only?.prose).toEqual({ a: null, b: 'B two' });
    expect(only?.identical).toBe(false);
  });

  it('offers both performances to read and never diffs them line by line', () => {
    const [comparison] = compareScenes([scene(1, 'A one')], [scene(1, 'B one')]);
    expect(comparison?.prose).toEqual({ a: 'A one', b: 'B one' });
    expect(comparison?.identical).toBe(true);
  });
});

describe('volitional divergence (ADR 0005 §4/§5)', () => {
  it('reports a column two runs resolved differently', () => {
    const divergences = compareProposals(
      [logEntry({ status: 'proposed_applied' })],
      [logEntry({ status: 'proposed_dropped' })],
    );
    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.a?.status).toBe('proposed_applied');
    expect(divergences[0]?.b?.status).toBe('proposed_dropped');
  });

  it('says nothing when both runs landed the same way', () => {
    expect(compareProposals([logEntry()], [logEntry()])).toEqual([]);
  });

  it('ignores physical and epistemic columns, which are deterministic by construction', () => {
    // ADR 0005 §2 makes every accepted P/E update either required by exit_state or a
    // non-narrative extension. A difference there is a bug to fix, not variance to display.
    const divergences = compareProposals(
      [logEntry({ tier: 'P', column: 'location_id', new_value: 'loc_ball_hall' })],
      [logEntry({ tier: 'P', column: 'location_id', new_value: 'loc_chimney_corner' })],
    );
    expect(divergences).toEqual([]);
  });
});

describe('which pairs may be compared at all', () => {
  it('refuses a cross-version pair — that is what an author s edit did, not what varied', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('the-dragon-of-thistlewick');
      await repository.putPackage(pkg);
      const first = await runTelling({
        pkg,
        client: new SyntheticWriterClient(pkg),
        repository,
      });

      const advanced = { ...pkg, package_version: pkg.package_version + 1 };
      await repository.putPackage(advanced);
      const second = await runTelling({
        pkg: advanced,
        client: new SyntheticWriterClient(advanced),
        repository,
      });

      await expect(
        diffEditions(repository, first.manifest.run_id, second.manifest.run_id),
      ).rejects.toThrow(EditionDiffError);
    });
  });

  it('refuses a telling set beside itself', async () => {
    await withRepository(async (repository) => {
      await expect(diffEditions(repository, 'same-run', 'same-run')).rejects.toThrow(
        /beside itself/,
      );
    });
  });

  it('compares two runs of one package version end to end', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('the-dragon-of-thistlewick');
      await repository.putPackage(pkg);

      const first = await runTelling({ pkg, client: new SyntheticWriterClient(pkg), repository });
      const second = await runTelling({ pkg, client: new SyntheticWriterClient(pkg), repository });

      const diff = await diffEditions(repository, first.manifest.run_id, second.manifest.run_id);

      expect(diff.story_id).toBe('the-dragon-of-thistlewick');
      expect(diff.package_version).toBe(pkg.package_version);
      expect(diff.scenes).toHaveLength(3);
      // The stand-in writer composes each scene from its own Scene Card, so two of its runs are
      // identical by construction — which is the right assertion here: the diff reports what
      // varied, and nothing did.
      expect(diff.scenes_varied).toBe(0);
      expect(diff.scenes.every((scene) => scene.prose.a !== null && scene.prose.b !== null)).toBe(
        true,
      );
    });
  });
});
