/**
 * The authoring API routes (ADR 0017, issue #87).
 *
 * The handlers are plain functions over a `Request`, so they are exercised directly here rather
 * than through a server. What is checked is what the routes own and the modules beneath them do
 * not: the author gate, the status a failure maps to, and that a refused write really wrote
 * nothing.
 *
 * `BLOB_LOCAL_ROOT` is set before the first import because `storyRepository()` caches the store
 * it builds on first call — every route in the file then shares one temporary filesystem store.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let root: string;
let routes: {
  manuscript: typeof import('../app/api/stories/[storyId]/manuscript/route');
  publish: typeof import('../app/api/stories/[storyId]/manuscript/publish/route');
  manuscripts: typeof import('../app/api/manuscripts/route');
  lint: typeof import('../app/api/authoring/lint/route');
  available: typeof import('../app/api/authoring/story-id-available/route');
};
let repository: import('../src/persistence/story-repository').StoryRepository;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'axiom-routes-'));
  process.env.BLOB_LOCAL_ROOT = root;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  routes = {
    manuscript: await import('../app/api/stories/[storyId]/manuscript/route'),
    publish: await import('../app/api/stories/[storyId]/manuscript/publish/route'),
    manuscripts: await import('../app/api/manuscripts/route'),
    lint: await import('../app/api/authoring/lint/route'),
    available: await import('../app/api/authoring/story-id-available/route'),
  };

  const { storyRepository } = await import('../src/persistence');
  repository = storyRepository();

  const { loadFixtureIntoRepository } = await import('../src/fixtures/load');
  await loadFixtureIntoRepository('the-dragon-of-thistlewick', repository);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const params = (storyId: string) => ({ params: Promise.resolve({ storyId }) });

function post(url: string, body: unknown, token?: string): Request {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

/** Force the deployed posture, where a write needs the token, for one call. */
async function asDeployment<T>(run: () => Promise<T>): Promise<T> {
  process.env.BLOB_READ_WRITE_TOKEN = 'the-real-token';
  try {
    return await run();
  } finally {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  }
}

describe('the author gate (ADR 0015 §5)', () => {
  it('refuses every write without the token where one is wanted', async () => {
    await asDeployment(async () => {
      const calls = [
        routes.manuscript.PUT(
          new Request('http://t/', { method: 'PUT', body: '{}' }),
          params('the-dragon-of-thistlewick'),
        ),
        routes.manuscript.DELETE(
          new Request('http://t/', { method: 'DELETE' }),
          params('the-dragon-of-thistlewick'),
        ),
        routes.publish.POST(post('http://t/', {}), params('the-dragon-of-thistlewick')),
        routes.manuscripts.POST(post('http://t/', { source: 'new', title: 'X' })),
      ];
      for (const response of await Promise.all(calls)) {
        expect(response.status).toBe(401);
      }
    });
  });

  it('accepts the token where one is wanted', async () => {
    const created = await asDeployment(() =>
      routes.manuscripts.POST(
        post('http://t/', { source: 'new', title: 'Gated Story' }, 'the-real-token'),
      ),
    );
    expect(created.status).toBe(201);
    await repository.deleteManuscript('gated-story');
  });

  it('needs no token on a local filesystem instance', async () => {
    const response = await routes.manuscripts.POST(
      post('http://t/', { source: 'edit', story_id: 'the-dragon-of-thistlewick' }),
    );
    expect(response.status).toBe(201);
  });
});

describe('GET /api/stories/{storyId}/manuscript', () => {
  it('carries the lint result and the version a publish would write', async () => {
    const response = await routes.manuscript.GET(
      new Request('http://t/'),
      params('the-dragon-of-thistlewick'),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      updated_at: string;
      next_package_version: number;
      lint: { publishable: boolean; errors: unknown[] };
    };
    expect(body.next_package_version).toBe(2);
    expect(body.lint.publishable).toBe(true);
    expect(body.updated_at).toEqual(expect.any(String));
  });

  it('404s for a story with no Manuscript open', async () => {
    const response = await routes.manuscript.GET(new Request('http://t/'), params('nothing-here'));
    expect(response.status).toBe(404);
  });
});

describe('PUT /api/stories/{storyId}/manuscript', () => {
  it('409s on a stale updated_at and leaves the stored copy untouched', async () => {
    const storyId = 'the-dragon-of-thistlewick';
    const opened = (await (
      await routes.manuscript.GET(new Request('http://t/'), params(storyId))
    ).json()) as { updated_at: string; package: Record<string, unknown> };

    const save = (title: string, updatedAt: string) =>
      routes.manuscript.PUT(
        new Request('http://t/', {
          method: 'PUT',
          body: JSON.stringify({
            package: { ...opened.package, metadata: { title } },
            updated_at: updatedAt,
          }),
        }),
        params(storyId),
      );

    const first = await save('Tab A', opened.updated_at);
    expect(first.status).toBe(200);

    // Tab B still holds the timestamp it read before tab A saved.
    const second = await save('Tab B', opened.updated_at);
    expect(second.status).toBe(409);
    expect((await second.json()) as { reason: string }).toMatchObject({
      reason: 'manuscript_conflict',
      stored_updated_at: expect.any(String),
    });

    const stored = await repository.getManuscript(storyId);
    expect(stored?.package.metadata.title).toBe('Tab A');
  });

  it('400s on a body with no updated_at', async () => {
    const response = await routes.manuscript.PUT(
      new Request('http://t/', { method: 'PUT', body: JSON.stringify({ package: {} }) }),
      params('the-dragon-of-thistlewick'),
    );
    expect(response.status).toBe(400);
  });
});

describe('POST /api/manuscripts', () => {
  it('409s when the story id is already taken', async () => {
    const response = await routes.manuscripts.POST(
      post('http://t/', { source: 'new', title: 'The Dragon of Thistlewick' }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()) as { reason: string }).toMatchObject({
      reason: 'story_id_taken',
    });
  });

  it('slugs the story id from the title when none is named', async () => {
    const response = await routes.manuscripts.POST(
      post('http://t/', { source: 'new', title: 'A Wholly New Story' }),
    );
    expect(response.status).toBe(201);
    expect((await response.json()) as { story_id: string }).toMatchObject({
      story_id: 'a-wholly-new-story',
    });
  });

  it('duplicates a retained version under a new story id', async () => {
    const response = await routes.manuscripts.POST(
      post('http://t/', {
        source: 'duplicate',
        from_story_id: 'the-dragon-of-thistlewick',
        story_id: 'the-dragon-copy',
        title: 'The Dragon, Copied',
      }),
    );
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      based_on_version: number | null;
      package: { package_version: number; scene_cards: unknown[] };
    };
    expect(body.based_on_version).toBeNull();
    expect(body.package.package_version).toBe(1);
    expect(body.package.scene_cards).toHaveLength(3);
    // Nothing but the package travels (ADR 0017 §5).
    expect(await repository.getPointer('the-dragon-copy')).toBeNull();
  });

  it('404s duplicating a version that was never retained', async () => {
    const response = await routes.manuscripts.POST(
      post('http://t/', {
        source: 'duplicate',
        from_story_id: 'the-dragon-of-thistlewick',
        from_version: 99,
        story_id: 'never-retained',
      }),
    );
    expect(response.status).toBe(404);
  });

  it('400s on an unknown source', async () => {
    const response = await routes.manuscripts.POST(post('http://t/', { source: 'import' }));
    expect(response.status).toBe(400);
  });
});

describe('POST /api/stories/{storyId}/manuscript/publish', () => {
  it('rejects with the lint result and writes nothing', async () => {
    const storyId = 'the-dragon-copy';
    const opened = (await (
      await routes.manuscript.GET(new Request('http://t/'), params(storyId))
    ).json()) as { updated_at: string; package: Record<string, unknown> };

    const broken = structuredClone(opened.package);
    (broken.scene_cards as Array<Record<string, unknown>>)[0]!.pov = 'char_nobody';
    await routes.manuscript.PUT(
      new Request('http://t/', {
        method: 'PUT',
        body: JSON.stringify({ package: broken, updated_at: opened.updated_at }),
      }),
      params(storyId),
    );

    const response = await routes.publish.POST(post('http://t/', {}), params(storyId));
    expect(response.status).toBe(422);

    const body = (await response.json()) as {
      reason: string;
      lint: { publishable: boolean; errors: Array<{ path: string }> };
    };
    expect(body.reason).toBe('lint_rejected');
    expect(body.lint.publishable).toBe(false);
    expect(body.lint.errors.some((problem) => problem.path.includes('pov'))).toBe(true);

    // A rejected publish writes nothing at all.
    expect(await repository.getPointer(storyId)).toBeNull();
    expect(await repository.listPackageVersions(storyId)).toEqual([]);
  });

  it('publishes as max(retained) + 1 and leaves the Manuscript in place', async () => {
    const storyId = 'the-dragon-of-thistlewick';
    const response = await routes.publish.POST(post('http://t/', {}), params(storyId));
    expect(response.status).toBe(200);

    const body = (await response.json()) as { package_version: number };
    expect(body.package_version).toBe(2);
    expect(await repository.listPackageVersions(storyId)).toEqual([1, 2]);
    // Version 1 is untouched: an edition pinning it still dereferences to what it compiled.
    expect(await repository.getManuscript(storyId)).not.toBeNull();

    const again = await routes.manuscript.GET(new Request('http://t/'), params(storyId));
    expect((await again.json()) as { next_package_version: number }).toMatchObject({
      next_package_version: 3,
    });
  });
});

describe('renaming before the first publish (ADR 0017 §5)', () => {
  it('moves an unpublished Manuscript to a new story id', async () => {
    const from = 'a-wholly-new-story';
    const opened = (await (
      await routes.manuscript.GET(new Request('http://t/'), params(from))
    ).json()) as { updated_at: string; package: Record<string, unknown> };

    const response = await routes.manuscript.PUT(
      new Request('http://t/', {
        method: 'PUT',
        body: JSON.stringify({
          package: { ...opened.package, story_id: 'renamed-story' },
          updated_at: opened.updated_at,
        }),
      }),
      params(from),
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as { story_id: string }).toMatchObject({
      story_id: 'renamed-story',
    });

    expect(await repository.getManuscript(from)).toBeNull();
    expect(await repository.getManuscript('renamed-story')).not.toBeNull();
  });

  it('refuses to rename a story that has published', async () => {
    const storyId = 'the-dragon-of-thistlewick';
    const opened = (await (
      await routes.manuscript.GET(new Request('http://t/'), params(storyId))
    ).json()) as { updated_at: string; package: Record<string, unknown> };

    const response = await routes.manuscript.PUT(
      new Request('http://t/', {
        method: 'PUT',
        body: JSON.stringify({
          package: { ...opened.package, story_id: 'too-late' },
          updated_at: opened.updated_at,
        }),
      }),
      params(storyId),
    );
    expect(response.status).toBe(409);
    expect(await repository.getManuscript(storyId)).not.toBeNull();
  });
});

describe('DELETE /api/stories/{storyId}/manuscript', () => {
  it('discards and says whether the story survives it', async () => {
    const published = await routes.manuscript.DELETE(
      new Request('http://t/', { method: 'DELETE' }),
      params('the-dragon-of-thistlewick'),
    );
    expect((await published.json()) as { story_remains: boolean }).toMatchObject({
      story_remains: true,
    });

    // A Manuscript that never published has nothing behind it (ADR 0017 §9).
    const unpublished = await routes.manuscript.DELETE(
      new Request('http://t/', { method: 'DELETE' }),
      params('renamed-story'),
    );
    expect((await unpublished.json()) as { story_remains: boolean }).toMatchObject({
      story_remains: false,
    });
    expect(await repository.getManuscript('renamed-story')).toBeNull();
  });

  it('is idempotent', async () => {
    const response = await routes.manuscript.DELETE(
      new Request('http://t/', { method: 'DELETE' }),
      params('renamed-story'),
    );
    expect(response.status).toBe(200);
  });
});

describe('the stateless helpers', () => {
  it('lints a package body without saving it', async () => {
    const response = await routes.lint.POST(
      post('http://t/', { package: { story_id: 'x', scene_cards: [] } }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { publishable: boolean; errors: unknown[] };
    expect(body.publishable).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(await repository.getManuscript('x')).toBeNull();
  });

  it('400s a lint with no package', async () => {
    expect((await routes.lint.POST(post('http://t/', {}))).status).toBe(400);
  });

  it('answers whether a story id is free', async () => {
    const taken = await routes.available.GET(
      new Request('http://t/?id=the-dragon-of-thistlewick'),
    );
    expect((await taken.json()) as { available: boolean }).toMatchObject({ available: false });

    const free = await routes.available.GET(new Request('http://t/?id=nobody-has-this'));
    expect((await free.json()) as { available: boolean }).toMatchObject({ available: true });

    const invalid = await routes.available.GET(new Request('http://t/?id=Not%20A%20Slug'));
    expect((await invalid.json()) as { available: boolean }).toMatchObject({ available: false });
  });
});
