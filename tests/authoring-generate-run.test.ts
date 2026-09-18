/**
 * Offline tests for the Generate entry point's durable job (ADR 0021, #172).
 *
 * Every call runs through a stub `ModelClient` that answers both halves of the pipeline — the
 * arc-generation prompt and the four segmentation passes — so the whole `runGenerate` loop
 * (draft the arc, then segment it into Scene Cards, persisting both stages) runs end to end
 * without a network call. The stub's arc response is the same well-formed, gate-passing arc
 * `tests/arc-generation.test.ts`'s `sampleArc()` uses, so the arc-generation stage never needs
 * its one bounded repair round — what these tests hold is the machinery around the two calls,
 * not a judgment about generation quality.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import { StoryRepository } from '@/persistence/story-repository';
import { materializeBrief } from '@/arc/brief';
import {
  authoringProgressText,
  costOfGenerationCalls,
  runGenerate,
  type AuthoringProgressEvent,
} from '@/authoring/generate-run';
import type { ModelClient, ModelRequest, ModelResponse } from '@/writer/model-client';

afterEach(() => {
  vi.restoreAllMocks();
});

async function withRepository<T>(run: (repository: StoryRepository) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'axiom-authoring-run-'));
  try {
    return await run(new StoryRepository(new FileSystemBlobStore(root)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** A well-formed, gate-passing 5-event arc — the same one `arc-generation.test.ts` scores clean. */
function sampleArcResponse(): Record<string, unknown> {
  return {
    title: 'The Low Water',
    world_model_seed: {
      characters: [
        { id: 'char_inspector', name: 'Wren Adeyemi', location_id: 'loc_office', status: 'working', goal: 'keep the crossing open', bag: {} },
        { id: 'char_pilot', name: 'Tomas Vrba', location_id: 'loc_landing', status: 'working', goal: 'get one more season', bag: {} },
      ],
      locations: [
        { id: 'loc_office', name: 'District office', bag: {} },
        { id: 'loc_landing', name: 'Ferry landing', bag: {} },
      ],
      objects: [{ id: 'obj_logbook', name: 'Inspection logbook', location_id: 'loc_office', status: 'intact', bag: {} }],
      relationships: [],
      character_knowledge: [],
    },
    events: [
      {
        id: 'ev_01_signing', sequence: 1, summary: 'The inspection is signed off.',
        pov: 'char_inspector', location_id: 'loc_office', characters_present: ['char_inspector'],
        dramatic_function: 'Establish the certification and the pressure behind it.',
        beats: ['the certificate is signed'], caused_by: [], reveals: ['hull_seam_was_reported'],
        conceals: [], pays_off: [], state_changes: [],
      },
      {
        id: 'ev_02_crossing', sequence: 2, summary: 'The ferry crosses.',
        pov: 'char_pilot', location_id: 'loc_landing', characters_present: ['char_pilot'],
        dramatic_function: 'Show the crossing as routine.',
        beats: ['the ferry makes the crossing'], caused_by: ['ev_01_signing'], reveals: [],
        conceals: [], pays_off: [], state_changes: [],
      },
      {
        id: 'ev_03_sinking', sequence: 3, summary: 'The ferry goes down in calm water.',
        pov: 'char_pilot', location_id: 'loc_landing', characters_present: ['char_pilot'],
        dramatic_function: 'The disturbance.',
        beats: ['the ferry sinks'], caused_by: ['ev_02_crossing'], reveals: [],
        conceals: [], pays_off: [], state_changes: [{ entity_id: 'char_pilot', column: 'status', value: 'missing' }],
      },
      {
        id: 'ev_04_inquiry', sequence: 4, summary: 'The inquiry opens.',
        pov: 'char_inspector', location_id: 'loc_office', characters_present: ['char_inspector'],
        dramatic_function: 'Raise the cost of the answer.',
        beats: ['the inquiry names her'], caused_by: ['ev_03_sinking'], reveals: [],
        conceals: [], pays_off: [], state_changes: [],
      },
      {
        id: 'ev_05_account', sequence: 5, summary: 'She finds the report she never wrote down.',
        pov: 'char_inspector', location_id: 'loc_office', characters_present: ['char_inspector'],
        dramatic_function: 'The solution, and its cost.',
        beats: ['she reads the seam report back'], caused_by: ['ev_04_inquiry'], reveals: [],
        conceals: [], pays_off: [{ fact_ref: 'hull_seam_was_reported', plant: 'ev_01_signing' }],
        state_changes: [],
      },
    ],
  };
}

/** Answers the arc-generation prompt and every segmentation pass with a fixed, schema-shaped reply. */
class GenerateStubClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  private readonly failArc: boolean;
  private readonly failSegment: boolean;

  constructor(options: { failArc?: boolean; failSegment?: boolean } = {}) {
    this.failArc = options.failArc ?? false;
    this.failSegment = options.failSegment ?? false;
  }

  generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const contents = request.contents;

    if (contents.includes('EVENTS — exactly')) {
      if (this.failArc) return Promise.reject(new Error('arc generation stand-in failure'));
      return respond(sampleArcResponse());
    }
    if (contents.includes('EVENTS:')) {
      if (this.failSegment) return Promise.reject(new Error('segmentation stand-in failure'));
      const ids = [...contents.matchAll(/^\d+\. \[([a-z0-9_]+)\]/gm)].map((match) => match[1]!);
      return respond({ decisions: ids.slice(1).map((id) => ({ after_event_id: id, decision: 'same_scene', why: 'stub' })) });
    }
    if (contents.includes('SCENE ')) {
      const numbers = [...contents.matchAll(/^SCENE (\d+)$/gm)].map((match) => Number(match[1]));
      return respond({
        scenes: numbers.map((scene_number) => ({
          scene_number,
          label: `stub ${scene_number}`,
          pov: 'char_inspector',
          location_id: 'loc_office',
          dramatic_function: 'a stub function',
          required_beats: ['a stub beat'],
        })),
      });
    }
    if (contents.includes('SCENES IN FOCUS')) return respond({ pairs: [] });
    if (contents.includes('PAIR fact_ref')) return respond({ verdicts: [] });
    if (contents.includes('FACT:')) return respond({ facts: [] });
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

function testBrief(): ReturnType<typeof materializeBrief> {
  return materializeBrief({
    story_id: 'gen-test',
    title: 'The Low Water',
    premise: { logline: 'A ferry sinks in calm water.', modules: null },
    plot_shape_preset: 'mystery',
    event_count: 12,
  });
}

describe('the Generate entry point (ADR 0021)', () => {
  it('drafts an arc, segments it, and persists both stages under one Authoring run', async () => {
    await withRepository(async (repository) => {
      const events: AuthoringProgressEvent[] = [];
      const { manifest } = await runGenerate({
        brief: testBrief(),
        client: new GenerateStubClient(),
        repository,
        model: 'gemini-3.8-flash',
        onProgress: (event) => events.push(event),
      });

      expect(manifest.status).toBe('complete');
      expect(manifest.kind).toBe('generate');
      expect(manifest.stage).toBe('segment');
      expect(manifest.failure).toBeNull();
      expect(manifest.result).not.toBeNull();
      expect(manifest.result?.scenes).toBeGreaterThan(0);
      expect(manifest.result?.events).toBe(5);
      expect(manifest.cost_usd).toBeGreaterThan(0);
      expect(manifest.models_used).toContain('gemini-3.8-flash');

      // What the API route reads back is what actually landed in the store.
      const persistedManifest = await repository.getAuthoringRunManifest(manifest.run_id);
      expect(persistedManifest?.status).toBe('complete');
      const persistedPackage = await repository.getAuthoringRunResult(manifest.run_id);
      expect(persistedPackage?.scene_cards.length).toBe(manifest.result?.scenes);

      // Stage-based progress, not a scene count — the vocabulary decision 5 settles.
      expect(events[0]).toEqual({ type: 'run_started', run_id: manifest.run_id });
      expect(events.map((event) => event.type)).toContain('stage_started');
      expect(
        events.some((event) => event.type === 'stage_started' && event.stage === 'arc'),
      ).toBe(true);
      expect(
        events.some((event) => event.type === 'stage_started' && event.stage === 'segment'),
      ).toBe(true);
      // Segmentation's own onProgress hook (its four passes) rides the same event stream.
      expect(events.some((event) => event.type === 'stage_progress' && event.stage === 'segment')).toBe(
        true,
      );
      expect(events.at(-1)).toEqual({ type: 'run_completed', run_id: manifest.run_id });
    });
  });

  it('mints a fresh run id on every run and never reuses one (mirrors ADR 0014 §3)', async () => {
    await withRepository(async (repository) => {
      const first = await runGenerate({
        brief: testBrief(),
        client: new GenerateStubClient(),
        repository,
        model: 'gemini-3.8-flash',
      });
      const second = await runGenerate({
        brief: testBrief(),
        client: new GenerateStubClient(),
        repository,
        model: 'gemini-3.8-flash',
      });
      expect(first.manifest.run_id).not.toBe(second.manifest.run_id);
    });
  });

  it('fails the run at the arc stage and records which stage, without throwing past the caller', async () => {
    await withRepository(async (repository) => {
      const events: AuthoringProgressEvent[] = [];
      const { manifest } = await runGenerate({
        brief: testBrief(),
        client: new GenerateStubClient({ failArc: true }),
        repository,
        model: 'gemini-3.8-flash',
        onProgress: (event) => events.push(event),
      });

      expect(manifest.status).toBe('failed');
      expect(manifest.failure?.stage).toBe('arc');
      expect(manifest.failure?.detail).toContain('arc generation stand-in failure');
      expect(manifest.result).toBeNull();

      const persisted = await repository.getAuthoringRunManifest(manifest.run_id);
      expect(persisted?.status).toBe('failed');
      expect(await repository.getAuthoringRunResult(manifest.run_id)).toBeNull();

      expect(events.at(-1)).toEqual({
        type: 'run_failed',
        run_id: manifest.run_id,
        stage: 'arc',
        detail: expect.stringContaining('arc generation stand-in failure') as unknown as string,
      });
    });
  });

  it('completes even when a segmentation pass fails, the same tolerance the CLI pipeline has', async () => {
    // Segmentation catches `ExtractionCallError` per-window/per-batch and degrades rather than
    // aborting (`src/segmentation/pass-boundaries.ts`, `pass-scene-cards.ts` — "a failed window is
    // recorded and the run continues"), so a model failure here should not surface as a `failed`
    // Authoring run; it should complete with the failure counted in the segmentation report.
    await withRepository(async (repository) => {
      const { manifest } = await runGenerate({
        brief: testBrief(),
        client: new GenerateStubClient({ failSegment: true }),
        repository,
        model: 'gemini-3.8-flash',
      });

      expect(manifest.status).toBe('complete');
      expect(manifest.failure).toBeNull();
      // The arc stage's own cost is still counted even though a later stage's call failed.
      expect(manifest.cost_usd).toBeGreaterThan(0);
    });
  });
});

describe('authoringProgressText', () => {
  it('renders each event type to a line a progress bar can show', () => {
    const runId = 'gen-test-run';
    expect(authoringProgressText({ type: 'run_started', run_id: runId })).toBe('starting…');
    expect(
      authoringProgressText({ type: 'stage_started', run_id: runId, stage: 'arc', text: 'drafting the arc' }),
    ).toBe('drafting the arc');
    expect(authoringProgressText({ type: 'run_completed', run_id: runId })).toBe('ready to review');
    expect(
      authoringProgressText({ type: 'run_failed', run_id: runId, stage: 'segment', detail: 'boom' }),
    ).toBe('stopped at segment: boom');
  });
});

describe('costOfGenerationCalls', () => {
  it('prices a set of calls from MODEL_PRICING, skipping any model with no listed price', () => {
    const priced = costOfGenerationCalls([
      { stage: 'arc', model: 'gemini-3.8-flash', finish_reason: 'STOP', prompt_tokens: 1_000_000, output_tokens: 0, thoughts_tokens: 0, ms: 0 },
    ]);
    expect(priced).toBeCloseTo(0.75, 5);

    const unpriced = costOfGenerationCalls([
      { stage: 'arc', model: 'not-a-real-model', finish_reason: 'STOP', prompt_tokens: 1_000_000, output_tokens: 0, thoughts_tokens: 0, ms: 0 },
    ]);
    expect(unpriced).toBe(0);
  });
});
