/**
 * A telling's Discourse Record, exposed to the author (#183).
 *
 * `BLOB_LOCAL_ROOT` is set before the first import because `storyRepository()` caches the store it
 * builds on first call — the route and the telling below share one temporary filesystem store.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EditionDiscourseView } from '../src/edition/discourse-view';

let root: string;
let route: typeof import('../app/api/tellings/[runId]/discourse/route');
let repository: import('../src/persistence/story-repository').StoryRepository;
let runId: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'axiom-discourse-'));
  process.env.BLOB_LOCAL_ROOT = root;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  route = await import('../app/api/tellings/[runId]/discourse/route');
  const { storyRepository } = await import('../src/persistence');
  repository = storyRepository();

  const { readFixturePackage } = await import('../src/fixtures/load');
  const { SyntheticWriterClient } = await import('../src/writer/synthetic-client');
  const { runTelling } = await import('../src/edition/run-loop');
  const pkg = await readFixturePackage('the-dragon-of-thistlewick');
  await repository.putPackage(pkg);
  const { manifest } = await runTelling({ pkg, client: new SyntheticWriterClient(pkg), repository });
  runId = manifest.run_id;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const params = (id: string) => ({ params: Promise.resolve({ runId: id }) });

describe('GET /api/tellings/{runId}/discourse', () => {
  it('is author-gated where a token is wanted', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'the-real-token';
    try {
      const refused = await route.GET(new Request('http://t/'), params(runId));
      expect(refused.status).toBe(401);
    } finally {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    }
  });

  it('404s an unknown run', async () => {
    const response = await route.GET(new Request('http://t/'), params('no-such-run'));
    expect(response.status).toBe(404);
  });

  it('returns the told-ledger and each scene digest beside its card', async () => {
    const response = await route.GET(new Request('http://t/'), params(runId));
    expect(response.status).toBe(200);
    const view = (await response.json()) as EditionDiscourseView;

    const scenes = await repository.getEditionScenes(runId);
    const pkg = await repository.getCurrentPackage(view.story_id);
    expect(view.run_id).toBe(runId);
    expect(view.scenes.map((scene) => scene.scene_id)).toEqual(scenes.map((s) => s.scene_id));
    expect(view.told_ledger.length).toBeGreaterThan(0);

    const first = view.scenes[0]!;
    const card = pkg!.scene_cards.find((c) => c.id === first.scene_id)!;
    expect(first.digest).toEqual(scenes[0]!.digest);
    expect(first.card?.reader_must_learn).toEqual(card.reader_must_learn);
    expect(first.unreported).toEqual(
      card.reader_must_learn.filter((fact) => !first.digest.facts_revealed.includes(fact)),
    );
  });
});

describe('buildEditionDiscourseView', () => {
  it('flags a required fact the digest omits and a hidden fact it reports', async () => {
    const { buildEditionDiscourseView } = await import('../src/edition/discourse-view');
    const manifest = (await repository.getEditionManifest(runId))!;
    const [scene] = await repository.getEditionScenes(runId);
    const pkg = (await repository.getCurrentPackage(manifest.story_id))!;
    const card = pkg.scene_cards.find((c) => c.id === scene!.scene_id)!;

    const doctored = {
      ...pkg,
      scene_cards: pkg.scene_cards.map((c) =>
        c.id === card.id
          ? { ...c, reader_must_learn: ['never_reported'], must_stay_hidden: ['leaked_fact'] }
          : c,
      ),
    };
    const digest = { ...scene!.digest, facts_revealed: ['leaked_fact'] };

    const view = buildEditionDiscourseView(manifest, null, [{ ...scene!, digest }], doctored);
    expect(view.scenes[0]!.unreported).toEqual(['never_reported']);
    expect(view.scenes[0]!.leaked).toEqual(['leaked_fact']);
    expect(view.told_ledger).toEqual([]);

    const withoutPackage = buildEditionDiscourseView(manifest, null, [scene!], null);
    expect(withoutPackage.scenes[0]!.card).toBeNull();
    expect(withoutPackage.scenes[0]!.unreported).toEqual([]);
  });
});
