/**
 * The Generate entry point's HTTP layer (ADR 0021, #172): the author gate and request validation
 * on `POST /api/authoring/generate`, and the poll shape of `GET /api/authoring/generate/[runId]`.
 *
 * Nothing here calls the model. The 400/401 branches this file exercises all return before the
 * route ever reaches `liveClient()`, and the GET route is exercised against a manifest/package
 * this file seeds directly through the repository — the same way `tests/authoring-generate-run.test.ts`
 * covers the pipeline itself, offline, through a stub `ModelClient`.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let root: string;
let routes: {
  generate: typeof import('../app/api/authoring/generate/route');
  status: typeof import('../app/api/authoring/generate/[runId]/route');
};
let repository: import('../src/persistence/story-repository').StoryRepository;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'axiom-generate-route-'));
  process.env.BLOB_LOCAL_ROOT = root;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  routes = {
    generate: await import('../app/api/authoring/generate/route'),
    status: await import('../app/api/authoring/generate/[runId]/route'),
  };

  const { storyRepository } = await import('../src/persistence');
  repository = storyRepository();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function post(body: unknown, token?: string): Request {
  return new Request('http://t/api/authoring/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

async function asDeployment<T>(run: () => Promise<T>): Promise<T> {
  process.env.BLOB_READ_WRITE_TOKEN = 'the-real-token';
  try {
    return await run();
  } finally {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  }
}

const validBody = {
  title: 'The Low Water',
  premise: { logline: 'A ferry sinks in calm water.', modules: null },
  plot_shape_preset: 'mystery',
};

describe('POST /api/authoring/generate — the author gate', () => {
  it('refuses to start a run without the token where one is wanted', async () => {
    const response = await asDeployment(() => routes.generate.POST(post(validBody)));
    expect(response.status).toBe(401);
  });
});

describe('POST /api/authoring/generate — request validation', () => {
  it('rejects a missing title', async () => {
    const response = await routes.generate.POST(post({ ...validBody, title: '' }));
    expect(response.status).toBe(400);
  });

  it('rejects a premise with no logline', async () => {
    const response = await routes.generate.POST(
      post({ ...validBody, premise: { logline: '', modules: null } }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects an incomplete structured premise', async () => {
    const response = await routes.generate.POST(
      post({
        ...validBody,
        premise: { logline: 'A ferry sinks.', modules: { theme: 'only one field' } },
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('premise.modules');
  });

  it('rejects an unknown plot_shape_preset', async () => {
    const response = await routes.generate.POST(
      post({ ...validBody, plot_shape_preset: 'not-a-real-shape' }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a non-integer event_count', async () => {
    const response = await routes.generate.POST(post({ ...validBody, event_count: 12.5 }));
    expect(response.status).toBe(400);
  });

  it('rejects an event_count outside the band rather than quietly clamping it', async () => {
    for (const event_count of [3, 29]) {
      const response = await routes.generate.POST(post({ ...validBody, event_count }));
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('between 4 and 28');
    }
  });

  it('rejects an unknown plant_density', async () => {
    const response = await routes.generate.POST(post({ ...validBody, plant_density: 'extreme' }));
    expect(response.status).toBe(400);
  });

  it('rejects a non-boolean span_guidance', async () => {
    const response = await routes.generate.POST(post({ ...validBody, span_guidance: 'yes' }));
    expect(response.status).toBe(400);
  });

  it('rejects a model this deployment does not select', async () => {
    const response = await routes.generate.POST(post({ ...validBody, model: 'gpt-4' }));
    expect(response.status).toBe(400);
  });

  it('fails clearly rather than silently when no key is configured', async () => {
    // A local dev instance is already the author (no token needed), so this reaches liveClient().
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const response = await routes.generate.POST(post(validBody));
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('GEMINI_API_KEY');
    } finally {
      if (original !== undefined) process.env.GEMINI_API_KEY = original;
    }
  });
});

describe('GET /api/authoring/generate/[runId] — polling an Authoring run', () => {
  const params = (runId: string) => ({ params: Promise.resolve({ runId }) });

  it('404s a run id nothing was ever minted for', async () => {
    const response = await routes.status.GET(new Request('http://t/'), params('no-such-run'));
    expect(response.status).toBe(404);
  });

  it('reports stage-based progress while a run is going, and the produced package once complete', async () => {
    const now = new Date().toISOString();
    await repository.putAuthoringRunManifest({
      schema_version: '1.0',
      run_id: 'gen-route-test-running',
      kind: 'generate',
      status: 'running',
      stage: 'segment',
      stage_text: 'pass 2/4 — scene properties',
      requested_model: 'gemini-3.8-flash',
      models_used: ['gemini-3.8-flash'],
      cost_usd: 0.01,
      started_at: now,
      completed_at: null,
      updated_at: now,
      failure: null,
      result: null,
    });

    const running = await routes.status.GET(new Request('http://t/'), params('gen-route-test-running'));
    expect(running.status).toBe(200);
    const runningBody = (await running.json()) as { status: string; progress: { text: string } };
    expect(runningBody.status).toBe('running');
    expect(runningBody.progress.text).toBe('pass 2/4 — scene properties');

    const { loadFixtureIntoRepository } = await import('../src/fixtures/load');
    // Reuse a real fixture package as the "produced" package — what matters here is the HTTP
    // shape, not segmentation's own output, which `authoring-generate-run.test.ts` covers.
    await loadFixtureIntoRepository('cinderella', repository);
    const pkg = await repository.getCurrentPackage('cinderella');
    if (pkg === null) throw new Error('fixture did not load');

    await repository.putAuthoringRunResult('gen-route-test-complete', pkg);
    await repository.putAuthoringRunManifest({
      schema_version: '1.0',
      run_id: 'gen-route-test-complete',
      kind: 'generate',
      status: 'complete',
      stage: 'segment',
      stage_text: 'ready to review',
      requested_model: 'gemini-3.8-flash',
      models_used: ['gemini-3.8-flash'],
      cost_usd: 0.05,
      started_at: now,
      completed_at: now,
      updated_at: now,
      failure: null,
      result: {
        title: pkg.metadata.title,
        scenes: pkg.scene_cards.length,
        events: pkg.scene_cards.length,
        events_per_scene: 1,
        entities: 1,
        lint_errors: 0,
        lint_warnings: 0,
        source_words: null,
        grounded_rate: null,
      },
    });

    const complete = await routes.status.GET(
      new Request('http://t/'),
      params('gen-route-test-complete'),
    );
    expect(complete.status).toBe(200);
    const completeBody = (await complete.json()) as {
      status: string;
      package: { scene_cards: unknown[] };
      lint: { publishable: boolean };
      summary: { scenes: number };
    };
    expect(completeBody.status).toBe('complete');
    expect(completeBody.package.scene_cards.length).toBe(pkg.scene_cards.length);
    expect(completeBody.summary.scenes).toBe(pkg.scene_cards.length);
    expect(completeBody.lint.publishable).toBe(true);
  });
});
