/**
 * The four author surfaces (ADR 0016 §1) — the read models behind the screens, and the one
 * write an author makes from them that changes the World Model.
 *
 * The screens themselves are thin: everything with a decision in it lives in these builders, so
 * this is where the surfaces are checked.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import { StoryRepository } from '@/persistence/story-repository';
import { readFixturePackage } from '@/fixtures/load';
import { SyntheticWriterClient } from '@/writer/synthetic-client';
import { compileSceneIntoDraft } from '@/draft/draft-compile';
import { buildDraftView } from '@/draft/draft-view';
import { draftDigestEntries, inspectAsOf, toldLedgerAsOf } from '@/draft/inspector';
import { resolveDraftProposal, NoSuchStoryError } from '@/draft/proposals';
import { buildRunReportView } from '@/edition/report-view';
import { buildTellingsView } from '@/edition/tellings-view';
import { isAuthorizedAuthorRequest, isLocalAuthorInstance } from '@/admin/authorize';
import { StateLog, worldModelAsOf } from '@/world-model/state-log';
import { scenesInOrder, type StoryPackage } from '@/schema/story-package';
import { metFact } from '@/digest/told-ledger';
import { mintRunId } from '@/edition/edition';
import { runTelling } from '@/edition/run-loop';

async function withRepository<T>(run: (repository: StoryRepository) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'axiom-surfaces-'));
  try {
    return await run(new StoryRepository(new FileSystemBlobStore(root)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Compile the first `count` scenes of a story into its Working Draft, offline. */
async function compileDraft(
  repository: StoryRepository,
  pkg: StoryPackage,
  count: number,
): Promise<void> {
  await repository.putPackage(pkg);
  for (const scene of scenesInOrder(pkg).slice(0, count)) {
    await compileSceneIntoDraft({
      pkg,
      sceneId: scene.id,
      client: new SyntheticWriterClient(pkg),
      repository,
    });
  }
}

describe('recognizing the author (ADR 0015 §5)', () => {
  it('opens the write surfaces on a local filesystem instance, which has no shared store', () => {
    const env = { NODE_ENV: 'development', BLOB_READ_WRITE_TOKEN: undefined };
    expect(isLocalAuthorInstance(env)).toBe(true);
    expect(isAuthorizedAuthorRequest(null, env)).toBe(true);
  });

  it('requires the token in production, whether or not one is configured', () => {
    expect(isLocalAuthorInstance({ NODE_ENV: 'production' })).toBe(false);
    // Nothing configured means nothing matches: an unset variable fails closed, it does not
    // make every submitted value authorized.
    expect(isAuthorizedAuthorRequest('anything', { NODE_ENV: 'production' })).toBe(false);
    expect(
      isAuthorizedAuthorRequest('sekrit', {
        NODE_ENV: 'production',
        BLOB_READ_WRITE_TOKEN: 'sekrit',
      }),
    ).toBe(true);
    expect(
      isAuthorizedAuthorRequest('wrong', {
        NODE_ENV: 'production',
        BLOB_READ_WRITE_TOKEN: 'sekrit',
      }),
    ).toBe(false);
  });

  it('still requires the token locally once a Blob token is configured', () => {
    // The token selects the shared store as well as guarding it, so a local run pointed at Vercel
    // Blob is not a private working copy any more.
    const env = { NODE_ENV: 'development', BLOB_READ_WRITE_TOKEN: 'sekrit' };
    expect(isLocalAuthorInstance(env)).toBe(false);
    expect(isAuthorizedAuthorRequest(null, env)).toBe(false);
  });
});

describe("the Working Draft's scene list (ADR 0016 §1, surface 3)", () => {
  it('lists every Scene Card, compiled or not, and says which can be compiled next', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('cinderella');
      await compileDraft(repository, pkg, 3);

      const view = await buildDraftView(repository, pkg);
      expect(view.scenes).toHaveLength(pkg.scene_cards.length);

      const compiled = view.scenes.filter((scene) => scene.compiled);
      expect(compiled.map((scene) => scene.scene_index)).toEqual([1, 2, 3]);

      // A scene is compiled against the digests of the scenes before it, so the next one is
      // reachable and everything past it is not.
      expect(view.scenes[3]?.compilable).toBe(true);
      expect(view.scenes[4]?.compilable).toBe(false);
      expect(view.scenes.every((scene) => !scene.stale)).toBe(true);
    });
  });

  it('carries the source scene’s diff on every scene a recompile flagged', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('cinderella');
      await compileDraft(repository, pkg, 4);

      // The author edits scene 2 and bumps the version — the only way a recompile produces a
      // different digest, and so the only way staleness arises (ADR 0015 §3).
      const edited: StoryPackage = {
        ...pkg,
        package_version: pkg.package_version + 1,
        scene_cards: pkg.scene_cards.map((card) =>
          card.order === 2
            ? { ...card, reader_must_learn: [...card.reader_must_learn, 'the_ball_is_open_to_all'] }
            : card,
        ),
      };
      await repository.putPackage(edited);
      const target = scenesInOrder(edited)[1]!;
      await compileSceneIntoDraft({
        pkg: edited,
        sceneId: target.id,
        client: new SyntheticWriterClient(edited),
        repository,
      });

      const view = await buildDraftView(repository, edited);
      const stale = view.scenes.filter((scene) => scene.stale);
      expect(stale.map((scene) => scene.scene_index)).toEqual([3, 4]);
      for (const scene of stale) {
        expect(scene.stale_reason?.source_scene_index).toBe(2);
        expect(scene.stale_reason?.summary).toContain('facts_revealed added the_ball_is_open_to_all');
      }
      // The recompiled scene answers its own flag and is pinned to the new version.
      expect(view.scenes[1]?.stale).toBe(false);
      expect(view.scenes[1]?.compiled_against_package_version).toBe(edited.package_version);
    });
  });
});

describe('the World & Discourse inspector (ADR 0016 §1, surface 2)', () => {
  it('replays the told-ledger forward to a scene, and no further', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('cinderella');
      await compileDraft(repository, pkg, 3);
      const digests = await draftDigestEntries(repository, pkg);

      // Scene 0 is the seed: nothing has been told, because nothing has been read.
      expect(toldLedgerAsOf(pkg, digests, 0).all()).toEqual([]);

      const atOne = toldLedgerAsOf(pkg, digests, 1).all();
      const atThree = toldLedgerAsOf(pkg, digests, 3).all();
      expect(atOne.length).toBeGreaterThan(0);
      expect(atThree.length).toBeGreaterThanOrEqual(atOne.length);
      expect(atOne.every((row) => row.first_learned_scene <= 1)).toBe(true);

      const cinderella = atThree.find((row) => row.fact_ref === metFact('char_cinderella'));
      expect(cinderella?.first_learned_scene).toBe(1);
      expect(cinderella?.centrality).toBe('high');
    });
  });

  /**
   * The two states issue #93 reported as "the tab does not change when I move the slider".
   *
   * Both are correct behaviour rather than a stalled read — but they are only defensible if the
   * screen says so, which is why the inspector now renders a panel in each. These tests pin the
   * invariant those panels assert to the author: past the draft's frontier, the answer really is
   * the frontier's answer, and with nothing compiled it really is the seed everywhere.
   */
  it('answers identically at every position when the draft has compiled nothing', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('the-amber-cat');
      const log = await repository.getDraftStateLog(pkg.story_id);
      const digests = await draftDigestEntries(repository, pkg);

      expect(digests).toEqual([]);

      const seed = inspectAsOf({ pkg, log, digests, sceneIndex: 0 });
      for (const sceneIndex of [1, 2, 3, 4]) {
        const at = inspectAsOf({ pkg, log, digests, sceneIndex });
        expect(at.world_model.toJSON()).toEqual(seed.world_model.toJSON());
        expect(at.told_ledger).toEqual([]);
        expect(at.changes_at_scene).toEqual([]);
      }
      // The signal the screen reads to know it should say so.
      expect(seed.compiled_scenes).toEqual([]);
    });
  });

  it('answers for the frontier at every position past it', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('the-lamp-at-cairn-head');
      await compileDraft(repository, pkg, 2);

      const log = await repository.getDraftStateLog(pkg.story_id);
      const digests = await draftDigestEntries(repository, pkg);
      const frontier = inspectAsOf({ pkg, log, digests, sceneIndex: 2 });

      expect(frontier.compiled_scenes).toEqual([1, 2]);
      // A partially built draft is the ordinary author-time state, not an edge case.
      expect(scenesInOrder(pkg).length).toBeGreaterThan(2);

      for (const sceneIndex of [3, 4, 5]) {
        const beyond = inspectAsOf({ pkg, log, digests, sceneIndex });
        expect(beyond.world_model.toJSON()).toEqual(frontier.world_model.toJSON());
        expect(beyond.told_ledger).toEqual(frontier.told_ledger);
        expect(beyond.changes_at_scene).toEqual([]);
      }
    });
  });

  it('does move both memories across the frontier it has compiled', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('the-dragon-of-thistlewick');
      await compileDraft(repository, pkg, 3);

      const log = await repository.getDraftStateLog(pkg.story_id);
      const digests = await draftDigestEntries(repository, pkg);
      const at = (sceneIndex: number) => inspectAsOf({ pkg, log, digests, sceneIndex });

      // The positive half of #93: within the draft, moving the scrubber really does change both
      // tabs. char_pellow walks the story's length, which is what makes him the honest probe —
      // char_maudlin never leaves the hive yard and would pass a broken replay.
      expect(at(0).world_model.value('char_pellow', 'location_id')).toBe('loc_village_green');
      expect(at(1).world_model.value('char_pellow', 'location_id')).toBe('loc_hill_path');
      expect(at(2).world_model.value('char_pellow', 'location_id')).toBe('loc_hive_yard');

      expect(at(0).told_ledger).toEqual([]);
      expect(at(1).told_ledger.length).toBeGreaterThan(0);
      expect(at(3).told_ledger.length).toBeGreaterThanOrEqual(at(1).told_ledger.length);
    });
  });

  it('answers both tabs at one scrubber position', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('cinderella');
      await compileDraft(repository, pkg, 3);

      const log = await repository.getDraftStateLog(pkg.story_id);
      const digests = await draftDigestEntries(repository, pkg);
      const atOne = inspectAsOf({ pkg, log, digests, sceneIndex: 1 });
      const whole = inspectAsOf({ pkg, log, digests, sceneIndex: Number.POSITIVE_INFINITY });

      expect(atOne.as_of_scene).toBe(1);
      expect(atOne.compiled_scenes).toEqual([1, 2, 3]);
      expect(atOne.changes_at_scene.every((entry) => entry.scene_index === 1)).toBe(true);

      // The scrubber's far end is the last scene the draft has, not the last the package has.
      expect(whole.as_of_scene).toBe(3);
      // Recency, not just first-learned, is what ADR 0009's decay reads — so a fact the reader
      // has been shown again since scene 1 has moved, whether or not any new fact was added.
      expect(atOne.told_ledger.every((row) => row.last_touched_scene === 1)).toBe(true);
      expect(whole.told_ledger.some((row) => row.last_touched_scene === 3)).toBe(true);
      expect(whole.told_ledger.length).toBeGreaterThanOrEqual(atOne.told_ledger.length);
    });
  });
});

describe('resolving a volitional proposal (ADR 0016 §3)', () => {
  /** A story whose draft log carries one pending proposal, as an author-time compile leaves it. */
  async function storyWithProposal(repository: StoryRepository): Promise<StoryPackage> {
    const pkg = await readFixturePackage('cinderella');
    await compileDraft(repository, pkg, 2);

    const log = await repository.getDraftStateLog(pkg.story_id);
    log.append({
      scene_index: 1,
      scene_id: scenesInOrder(pkg)[0]!.id,
      entity_id: 'rel_001',
      table: 'relationship',
      column: 'sentiment',
      tier: 'V',
      previous_value: 'resents',
      new_value: 'contemptuous',
      status: 'proposed',
    });
    await repository.putDraftStateLog(log);
    return pkg;
  }

  function pendingSequence(log: StateLog): number {
    const pending = log.pendingProposals()[0];
    expect(pending).toBeDefined();
    return pending!.sequence;
  }

  it('accepting commits the entry and changes the World Model from that scene on', async () => {
    await withRepository(async (repository) => {
      const pkg = await storyWithProposal(repository);
      const sequence = pendingSequence(await repository.getDraftStateLog(pkg.story_id));

      const resolution = await resolveDraftProposal({
        repository,
        storyId: pkg.story_id,
        sequence,
        decision: 'accept',
      });

      expect(resolution.applied).toBe(true);
      expect(resolution.entry.status).toBe('proposed_applied');
      expect(resolution.at_scene).toEqual({
        scene_index: 1,
        previous_value: 'resents',
        new_value: 'contemptuous',
      });
      expect(resolution.superseded).toBe(false);

      // Nothing else stores this: the World Model an author reads is the replay, so flipping the
      // status is the state change.
      const seed = (await repository.getSeedWorldModel(pkg.story_id))!;
      const log = await repository.getDraftStateLog(pkg.story_id);
      expect(worldModelAsOf(seed, log, 0).value('rel_001', 'sentiment')).toBe('resents');
      expect(worldModelAsOf(seed, log, 1).value('rel_001', 'sentiment')).toBe('contemptuous');
      expect(log.pendingProposals()).toEqual([]);
    });
  });

  it('rejecting keeps the entry on the record and changes nothing', async () => {
    await withRepository(async (repository) => {
      const pkg = await storyWithProposal(repository);
      const sequence = pendingSequence(await repository.getDraftStateLog(pkg.story_id));

      const resolution = await resolveDraftProposal({
        repository,
        storyId: pkg.story_id,
        sequence,
        decision: 'reject',
      });

      expect(resolution.applied).toBe(false);
      expect(resolution.entry.status).toBe('proposed_dropped');
      expect(resolution.at_scene.previous_value).toBe('resents');
      expect(resolution.at_scene.new_value).toBe('resents');

      const log = await repository.getDraftStateLog(pkg.story_id);
      expect(log.all().some((entry) => entry.sequence === sequence)).toBe(true);
      expect(log.pendingProposals()).toEqual([]);
    });
  });

  it('says so when a later scene has already written the field the accept lands on', async () => {
    await withRepository(async (repository) => {
      const pkg = await storyWithProposal(repository);
      const log = await repository.getDraftStateLog(pkg.story_id);
      const sequence = pendingSequence(log);
      log.append({
        scene_index: 2,
        scene_id: scenesInOrder(pkg)[1]!.id,
        entity_id: 'rel_001',
        table: 'relationship',
        column: 'sentiment',
        tier: 'E',
        previous_value: 'resents',
        new_value: 'openly_cruel',
        status: 'committed',
      });
      await repository.putDraftStateLog(log);

      const resolution = await resolveDraftProposal({
        repository,
        storyId: pkg.story_id,
        sequence,
        decision: 'accept',
      });

      expect(resolution.at_scene.new_value).toBe('contemptuous');
      expect(resolution.current.new_value).toBe('openly_cruel');
      expect(resolution.superseded).toBe(true);
    });
  });

  it('refuses to resolve the same proposal twice, or a story it has never heard of', async () => {
    await withRepository(async (repository) => {
      const pkg = await storyWithProposal(repository);
      const sequence = pendingSequence(await repository.getDraftStateLog(pkg.story_id));
      const decide = (decision: 'accept' | 'reject') =>
        resolveDraftProposal({ repository, storyId: pkg.story_id, sequence, decision });

      await decide('accept');
      await expect(decide('reject')).rejects.toThrow(/not a pending proposal/);
      await expect(
        resolveDraftProposal({
          repository,
          storyId: 'no-such-story',
          sequence: 0,
          decision: 'accept',
        }),
      ).rejects.toBeInstanceOf(NoSuchStoryError);
    });
  });
});

describe('the run report (ADR 0016 §1, surface 4)', () => {
  it('aggregates by Scene Card and says which runs may be promoted', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('cinderella');
      await repository.putPackage(pkg);
      const runId = mintRunId(pkg.story_id);
      await runTelling({
        pkg,
        client: new SyntheticWriterClient(pkg),
        repository,
        runId,
      });

      const before = await buildRunReportView(repository, pkg);
      expect(before.baked).toBeNull();
      expect(before.runs).toHaveLength(1);
      expect(before.runs[0]?.promotable).toBe(true);
      expect(before.runs[0]?.is_baked).toBe(false);
      expect(before.by_card).toHaveLength(pkg.scene_cards.length);
      expect(before.by_card[0]?.runs).toBe(1);

      await repository.promoteToBaked(runId);
      const after = await buildRunReportView(repository, pkg);
      expect(after.baked?.run_id).toBe(runId);
      expect(after.runs[0]?.is_baked).toBe(true);
    });
  });
});

describe("the reader's choice (ADR 0014 §3)", () => {
  it('offers the Baked edition, the runs so far, and a wall-clock estimate', async () => {
    await withRepository(async (repository) => {
      const pkg = await readFixturePackage('the-dragon-of-thistlewick');
      await repository.putPackage(pkg);

      const empty = await buildTellingsView(repository, pkg);
      expect(empty.runs).toEqual([]);
      expect(empty.baked).toBeNull();
      expect(empty.scene_count).toBe(pkg.scene_cards.length);
      // With no run of this story's own to measure, the estimate rests on the project default and
      // says so rather than implying it measured something.
      expect(empty.estimate.from_default).toBe(true);
      // ADR 0014 §5: wall-clock only. A money figure here would be a promise nothing can keep.
      expect(empty.estimate.text).toMatch(/^about /);

      const first = mintRunId(pkg.story_id);
      await runTelling({ pkg, client: new SyntheticWriterClient(pkg), repository, runId: first });
      const second = mintRunId(pkg.story_id);
      await runTelling({ pkg, client: new SyntheticWriterClient(pkg), repository, runId: second });
      await repository.promoteToBaked(first);

      const view = await buildTellingsView(repository, pkg);
      // Newest first: the telling a reader wants is almost always the one that just finished.
      expect(view.runs.map((run) => run.run_id)).toEqual([second, first]);
      expect(view.baked?.run_id).toBe(first);
    });
  });
});
