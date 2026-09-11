import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkEntryState,
  commitValidated,
  validateStateUpdates,
} from '@/validator/state-update-authority';
import { stateToUpdates } from '@/schema/state-update';
import { StateLog, worldModelAsOf } from '@/world-model/state-log';
import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import { StoryRepository } from '@/persistence/story-repository';
import {
  FIXTURE_STORY_IDS,
  loadFixtureIntoRepository,
  loadFixtureStory,
} from '@/fixtures/load';
import type { Diagnostic } from '@/validator/diagnostics';
import type { LoadedStory } from '@/fixtures/load';

/**
 * Drive a whole Story Package through both checkpoints with a perfect writer: one that emits
 * exactly the `state_updates` the card's `exit_state` demands and nothing else.
 *
 * This is not the run loop (ticket 3) — there is no writer call and no prose. It is the
 * persistence half exercised end to end: entry check, state-update validation, commit log.
 */
function dryCompile(loaded: LoadedStory) {
  const seed = loaded.worldModel;
  const model = seed.copy();
  const log = new StateLog(loaded.pkg.story_id);
  const diagnostics: Diagnostic[] = [];

  for (const scene of loaded.scenes) {
    diagnostics.push(...checkEntryState(scene, model).diagnostics);

    const updates = stateToUpdates(scene.exit_state, (id) => model.tableOf(id));
    const result = validateStateUpdates({ scene, model, updates, occasion: 'read_time' });
    diagnostics.push(...result.diagnostics);
    commitValidated(model, log, result);
  }

  return { seed, model, log, diagnostics };
}

/**
 * The cross-scene continuity gaps a strict dry compile finds in the fixtures.
 *
 * These are `entry_state_mismatch` errors ADR 0005 §1 is designed to catch, and they are
 * findings about the fixture packages, not validator faults — see
 * `docs/schema/fixture-conformance-findings.md`. Pinned here so a change in either direction
 * (a fixture fix, or the validator losing the check) shows up as a test failure.
 */
const KNOWN_ENTRY_STATE_GAPS: Record<string, string[]> = {
  cinderella: ['scene_10_second_ball_the_flight char_cinderella.location_id'],
  'a-christmas-carol': [
    'scene_18_the_waking char_scrooge.location_id',
    'scene_20_the_office_next_morning char_bob_cratchit.location_id',
  ],
  // The three short packages were authored after this check existed, against it — every scene's
  // entry_state is what the scene before it leaves behind. An empty list is the assertion, not an
  // omission: a future edit that breaks the chain fails here.
  'the-amber-cat': [],
  'the-dragon-of-thistlewick': [],
  'the-lamp-at-cairn-head': [],
};

describe.each(FIXTURE_STORY_IDS)('%s, end to end', (fixture) => {
  it('compiles every Scene Card with no error beyond the known entry-state gaps', async () => {
    const { diagnostics } = dryCompile(await loadFixtureStory(fixture));
    const errors = diagnostics.filter((d) => d.severity === 'error');

    expect(errors.map((d) => `${d.scene_id} ${d.entity_id}.${d.column}`)).toEqual(
      KNOWN_ENTRY_STATE_GAPS[fixture],
    );
    expect(errors.every((d) => d.code === 'entry_state_mismatch')).toBe(true);
  });

  it('commits every state update the cards ask for', async () => {
    // No unauthorized_entity_update, no exit_state_contradiction, no unentailed_reversion:
    // every update a card's own exit_state declares is one the validator accepts.
    const { diagnostics } = dryCompile(await loadFixtureStory(fixture));

    expect(
      diagnostics
        .filter((d) => d.code !== 'entry_state_mismatch')
        .map((d) => `${d.code} ${d.scene_id} ${d.entity_id}.${d.column}`),
    ).toEqual([]);
  });

  it('reaches every card’s exit_state in the World Model', async () => {
    const loaded = await loadFixtureStory(fixture);
    const { model } = dryCompile(loaded);
    const last = loaded.scenes.at(-1);

    for (const [entityId, columns] of Object.entries(last?.exit_state ?? {})) {
      if (entityId.startsWith('_') || Array.isArray(columns)) continue;
      for (const [column, value] of Object.entries(columns)) {
        expect(model.value(entityId, column) ?? null).toEqual(value);
      }
    }
  });

  it('records a commit log the World Model replays back out of', async () => {
    const loaded = await loadFixtureStory(fixture);
    const { seed, model, log } = dryCompile(loaded);

    expect(log.length).toBeGreaterThan(0);
    expect(worldModelAsOf(seed, log, Number.POSITIVE_INFINITY).toJSON()).toEqual(model.toJSON());
  });

  it('reconstructs the World Model as of an arbitrary scene N', async () => {
    const loaded = await loadFixtureStory(fixture);
    const { seed, log } = dryCompile(loaded);

    // At every N, the world holds exactly what scene N's exit_state required of it — which is
    // what ADR 0016's inspector scrubber reads.
    for (const scene of loaded.scenes) {
      const asOf = worldModelAsOf(seed, log, scene.order);
      for (const [entityId, columns] of Object.entries(scene.exit_state)) {
        if (entityId.startsWith('_') || Array.isArray(columns)) continue;
        for (const [column, value] of Object.entries(columns)) {
          expect(
            asOf.value(entityId, column) ?? null,
            `${fixture} scene ${scene.order}: ${entityId}.${column}`,
          ).toEqual(value);
        }
      }
    }
  });

  it('replays a mid-story N to a state that is neither the seed nor the end', async () => {
    const loaded = await loadFixtureStory(fixture);
    const { seed, log } = dryCompile(loaded);
    const midpoint = Math.ceil(loaded.scenes.length / 2);

    const middle = worldModelAsOf(seed, log, midpoint).toJSON();
    expect(middle).not.toEqual(seed.toJSON());
    expect(middle).not.toEqual(worldModelAsOf(seed, log, Number.POSITIVE_INFINITY).toJSON());
  });

  it('persists and rereads its package snapshot and commit log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'axiom-weaver-e2e-'));
    try {
      const repository = new StoryRepository(new FileSystemBlobStore(root));
      const loaded = await loadFixtureIntoRepository(fixture, repository);
      const { log } = dryCompile(loaded);
      await repository.putDraftStateLog(log);

      const rereadPackage = await repository.getCurrentPackage(fixture);
      const rereadLog = await repository.getDraftStateLog(fixture);

      expect(rereadPackage).toEqual(loaded.pkg);
      expect(rereadLog.all()).toEqual(log.all());

      const seed = await repository.getSeedWorldModel(fixture);
      expect(worldModelAsOf(seed!, rereadLog, 1).toJSON()).toEqual(
        worldModelAsOf(loaded.worldModel, log, 1).toJSON(),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
