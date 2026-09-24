/**
 * Offline tests for the Extract entry point (ADR 0021, #173): `pastedSource`, the `runExtract`
 * loop, and the HTTP layer's validation and poll shape.
 *
 * Every model call runs through a stub `ModelClient` that answers the extraction pipeline's
 * passes and segmentation's with fixed, schema-shaped replies — the same dispatch-on-schema idea
 * `tests/extraction-pipeline.test.ts` uses — so the whole loop (extract, then segment, persisting
 * both stages) runs without a network call. What these hold is the machinery around the calls,
 * not a judgment about extraction quality; that comes from a live round-trip of a fixture.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import { StoryRepository } from '@/persistence/story-repository';
import { runExtract } from '@/authoring/extract-run';
import type { AuthoringProgressEvent } from '@/authoring/generate-run';
import { PASTED_SOURCE_MAX_WORDS, pastedSource } from '@/extraction/sources';
import { FABULA_BLOCK } from '@/schema/fabula';
import type { ModelClient, ModelRequest, ModelResponse } from '@/writer/model-client';

const PROSE = [
  'Once there was a gentleman who married a proud and haughty woman.',
  '',
  'The stepmother sent Cinderella to sleep in the chimney-corner among the cinders.',
  '',
  "Long afterwards, the King's son gave a ball, and all persons of fashion were invited.",
].join('\r\n');

async function withRepository<T>(run: (repository: StoryRepository) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'axiom-extract-run-'));
  try {
    return await run(new StoryRepository(new FileSystemBlobStore(root)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Answers every extraction pass and the two segmentation passes that shape Scene Cards. */
class ExtractStubClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  private readonly failEvents: boolean;

  constructor(options: { failEvents?: boolean } = {}) {
    this.failEvents = options.failEvents ?? false;
  }

  generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const properties = Object.keys(
      (request.responseJsonSchema as { properties?: Record<string, unknown> }).properties ?? {},
    );
    const contents = request.contents;

    // --- segmentation -----------------------------------------------------------------------
    if (properties.includes('decisions')) {
      const ids = [...contents.matchAll(/^\d+\. \[([a-z0-9_]+)\]/gm)].map((match) => match[1]!);
      return respond({
        decisions: ids.slice(1).map((id) => ({ after_event_id: id, decision: 'same_scene', why: 'stub' })),
      });
    }
    if (properties.includes('scenes')) {
      const numbers = [...contents.matchAll(/^SCENE (\d+)$/gm)].map((match) => Number(match[1]));
      return respond({
        scenes: numbers.map((scene_number) => ({
          scene_number,
          label: `stub ${scene_number}`,
          pov: 'char_cinderella',
          location_id: 'loc_chimney_corner',
          dramatic_function: 'a stub function',
          required_beats: ['a stub beat'],
        })),
      });
    }

    // --- extraction -------------------------------------------------------------------------
    if (properties.includes('entities') && properties.includes('relationships')) {
      if (contents.includes('MANY entities and relationships were missed')) {
        return respond({ entities: [], relationships: [] });
      }
      return respond({
        entities: [
          { kind: 'character', name: 'Cinderella', aliases: [], note: 'the daughter', quote: 'sleep in the chimney-corner' },
          { kind: 'location', name: 'the chimney-corner', aliases: [], note: 'by the hearth', quote: 'the chimney-corner among the cinders' },
        ],
        relationships: [],
      });
    }
    if (properties.includes('assignments')) {
      return respond({
        assignments: [
          { proposal: 'Cinderella', entity_id: 'char_cinderella', canonical_name: 'Cinderella' },
          { proposal: 'the chimney-corner', entity_id: 'loc_chimney_corner', canonical_name: 'the chimney-corner' },
        ],
      });
    }
    if (properties.includes('relationships')) return respond({ relationships: [] });
    if (properties.includes('events')) {
      if (this.failEvents) return respond({ events: [] });
      return respond({
        events: [
          {
            summary: 'the stepmother sends Cinderella to the chimney-corner',
            quote: 'sent Cinderella to sleep in the chimney-corner',
            story_time: 'present',
            time_anchor: '',
            participants: ['char_cinderella'],
            location_id: 'loc_chimney_corner',
            state_updates: [],
          },
        ],
      });
    }
    if (properties.includes('ordered_event_ids')) return respond({ ordered_event_ids: [] });
    if (properties.includes('rows')) {
      return respond({
        rows: [
          { id: 'char_cinderella', location_id: 'loc_chimney_corner', status: 'alive', goal: null, bag: [], quote: 'proud and haughty woman' },
        ],
      });
    }
    return respond({});
  }
}

function respond(body: unknown): Promise<ModelResponse> {
  return Promise.resolve({
    model: 'gemini-3.8-flash',
    text: JSON.stringify(body),
    finish_reason: 'STOP',
    usage: { prompt_tokens: 500, output_tokens: 200, thoughts_tokens: 100, cached_tokens: 0 },
  });
}

describe('pastedSource', () => {
  it('takes raw text directly, with no manifest lookup, and normalizes CRLF', () => {
    const source = pastedSource({ id: 'ext-test', title: ' Cinderella ', author: 'Andrew Lang', text: PROSE });
    expect(source.text).not.toContain('\r');
    expect(source.words).toBeGreaterThan(20);
    expect(source.manifest.id).toBe('ext-test');
    expect(source.manifest.title).toBe('Cinderella');
    expect(source.manifest.edition).toBe('Andrew Lang (pasted text)');
    expect(source.manifest.url).toBe('');
    expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('names the provenance honestly when there is no author', () => {
    expect(pastedSource({ id: 'x', title: 't', text: PROSE }).manifest.edition).toBe('pasted text');
  });
});

describe('the Extract entry point (ADR 0021)', () => {
  it('extracts, segments, and persists both stages under one Authoring run', async () => {
    await withRepository(async (repository) => {
      const events: AuthoringProgressEvent[] = [];
      const source = pastedSource({ id: 'ext-test', title: 'Cinderella', text: PROSE });
      const { manifest } = await runExtract({
        source,
        client: new ExtractStubClient(),
        repository,
        model: 'gemini-3.8-flash',
        onProgress: (event) => events.push(event),
      });

      expect(manifest.kind).toBe('extract');
      expect(manifest.run_id.startsWith('ext-')).toBe(true);
      expect(manifest.status).toBe('complete');
      expect(manifest.failure).toBeNull();
      expect(manifest.result?.scenes).toBeGreaterThan(0);
      expect(manifest.result?.events).toBe(1);
      expect(manifest.result?.source_words).toBe(source.words);
      expect(manifest.result?.grounded_rate).toBeGreaterThan(0);
      expect(manifest.cost_usd).toBeGreaterThan(0);
      expect(manifest.models_used).toContain('gemini-3.8-flash');

      const pkg = await repository.getAuthoringRunResult(manifest.run_id);
      expect(pkg?.scene_cards.length).toBe(manifest.result?.scenes);
      expect(pkg?.metadata.title).toBe('Cinderella');
      // The Fabula block still says what prose it was read from, pinned by hash.
      const fabula = (pkg as Record<string, unknown> | null)?.[FABULA_BLOCK] as
        | { source?: { edition: string; sha256: string } }
        | undefined;
      expect(fabula?.source).toEqual({ id: 'ext-test', edition: 'pasted text', sha256: source.sha256 });

      expect(events.some((event) => event.type === 'stage_started' && event.stage === 'extract')).toBe(true);
      // The pipeline's own pass-by-pass text rides the event stream…
      expect(
        events.some(
          (event) => event.type === 'stage_progress' && event.stage === 'extract' && event.text.startsWith('pass 1/5'),
        ),
      ).toBe(true);
      expect(events.some((event) => event.type === 'stage_started' && event.stage === 'segment')).toBe(true);
      expect(events.at(-1)).toEqual({ type: 'run_completed', run_id: manifest.run_id });

      // …and the queued progress writes never land after — and overwrite — the final status.
      const persisted = await repository.getAuthoringRunManifest(manifest.run_id);
      expect(persisted?.status).toBe('complete');
      expect(persisted?.stage_text).toBe('ready to review');
    });
  });

  it('fails at the extract stage, rather than handing over an empty package, when no events come out', async () => {
    await withRepository(async (repository) => {
      const { manifest } = await runExtract({
        source: pastedSource({ id: 'ext-empty', title: 'Nothing happens', text: PROSE }),
        client: new ExtractStubClient({ failEvents: true }),
        repository,
        model: 'gemini-3.8-flash',
      });

      expect(manifest.status).toBe('failed');
      expect(manifest.failure?.stage).toBe('extract');
      expect(manifest.failure?.detail).toContain('no events');
      expect(await repository.getAuthoringRunResult(manifest.run_id)).toBeNull();
      // The extraction calls were still spent, and the manifest says so.
      expect(manifest.cost_usd).toBeGreaterThan(0);
    });
  });

  it('records a thrown pipeline error against the extract stage', async () => {
    await withRepository(async (repository) => {
      const { manifest } = await runExtract({
        source: pastedSource({ id: 'ext-throw', title: 't', text: PROSE }),
        client: new ExtractStubClient(),
        repository,
        model: 'gemini-3.8-flash',
        step: () => Promise.reject(new Error('stand-in pipeline failure')),
      });
      expect(manifest.status).toBe('failed');
      expect(manifest.failure).toEqual({ stage: 'extract', detail: 'stand-in pipeline failure' });
      expect((await repository.getAuthoringRunManifest(manifest.run_id))?.status).toBe('failed');
    });
  });
});

// --- HTTP layer -------------------------------------------------------------------------------

let root: string;
let routes: {
  extract: typeof import('../app/api/authoring/extract/route');
  extractStatus: typeof import('../app/api/authoring/extract/[runId]/route');
  generateStatus: typeof import('../app/api/authoring/generate/[runId]/route');
};
let repository: StoryRepository;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'axiom-extract-route-'));
  process.env.BLOB_LOCAL_ROOT = root;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  routes = {
    extract: await import('../app/api/authoring/extract/route'),
    extractStatus: await import('../app/api/authoring/extract/[runId]/route'),
    generateStatus: await import('../app/api/authoring/generate/[runId]/route'),
  };
  const { storyRepository } = await import('../src/persistence');
  repository = storyRepository();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function post(body: unknown, token?: string): Request {
  return new Request('http://t/api/authoring/extract', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

const story = Array.from({ length: 30 }, () => PROSE).join('\n\n');
const validBody = { title: 'Cinderella', text: story };

describe('POST /api/authoring/extract', () => {
  it('refuses to start a run without the token where one is wanted', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'the-real-token';
    try {
      expect((await routes.extract.POST(post(validBody))).status).toBe(401);
    } finally {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    }
  });

  it('wants exactly one of pasted text or a fixture source', async () => {
    expect((await routes.extract.POST(post({ title: 't' }))).status).toBe(400);
    expect(
      (await routes.extract.POST(post({ ...validBody, fixture_source: 'cinderella' }))).status,
    ).toBe(400);
  });

  it('rejects pasted text with no title', async () => {
    expect((await routes.extract.POST(post({ text: story }))).status).toBe(400);
  });

  it('rejects an unknown fixture source', async () => {
    expect((await routes.extract.POST(post({ fixture_source: 'moby-dick' }))).status).toBe(400);
  });

  it('rejects a model this deployment does not select', async () => {
    expect((await routes.extract.POST(post({ ...validBody, model: 'gpt-4' }))).status).toBe(400);
  });

  it('rejects a fragment too short to be a story', async () => {
    const response = await routes.extract.POST(post({ title: 't', text: 'Once upon a time.' }));
    expect(response.status).toBe(400);
  });

  it('bounds the length before any call is made — the cost guard on a shared key', async () => {
    const long = 'word '.repeat(PASTED_SOURCE_MAX_WORDS + 1);
    const response = await routes.extract.POST(post({ title: 't', text: long }));
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: string }).error).toContain('limit');
  });

  it('fails clearly rather than silently when no key is configured', async () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const response = await routes.extract.POST(post(validBody));
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: string }).error).toContain('GEMINI_API_KEY');
    } finally {
      if (original !== undefined) process.env.GEMINI_API_KEY = original;
    }
  });
});

describe('GET /api/authoring/extract/[runId]', () => {
  const params = (runId: string) => ({ params: Promise.resolve({ runId }) });

  it('reports an extract run under its own path only', async () => {
    const now = new Date().toISOString();
    await repository.putAuthoringRunManifest({
      schema_version: '1.0',
      run_id: 'ext-route-test',
      kind: 'extract',
      status: 'running',
      stage: 'extract',
      stage_text: 'pass 3/5 — events, per window',
      requested_model: 'gemini-3.8-flash',
      models_used: [],
      cost_usd: 0,
      started_at: now,
      completed_at: null,
      updated_at: now,
      failure: null,
      result: null,
    });

    const response = await routes.extractStatus.GET(new Request('http://t/'), params('ext-route-test'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { kind: string; progress: { text: string } };
    expect(body.kind).toBe('extract');
    expect(body.progress.text).toBe('pass 3/5 — events, per window');

    const crossed = await routes.generateStatus.GET(new Request('http://t/'), params('ext-route-test'));
    expect(crossed.status).toBe(404);
  });
});
