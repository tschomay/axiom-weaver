import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemBlobStore } from '@/persistence/fs-blob-store';
import { StoryRepository, BakedPromotionError } from '@/persistence/story-repository';
import { readFixturePackage } from '@/fixtures/load';
import { SyntheticWriterClient } from '@/writer/synthetic-client';
import { progressText, runTelling, type ProgressEvent } from '@/edition/run-loop';
import { PlantWalkRejectedError } from '@/plants/obligation-walk';
import { DEGRADED_RUN_FRACTION, isRunDegraded } from '@/edition/run-report';
import { renderRunReport } from '@/edition/report-view';
import { scenesInOrder, type StoryPackage } from '@/schema/story-package';
import type { ModelClient, ModelRequest, ModelResponse } from '@/writer/model-client';

async function withRepository<T>(run: (repository: StoryRepository) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'axiom-run-loop-'));
  try {
    return await run(new StoryRepository(new FileSystemBlobStore(root)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** The stand-in writer, with named scenes made to fail the way a real one fails. */
class FailingForScenes implements ModelClient {
  readonly seen: string[] = [];
  constructor(
    private readonly inner: ModelClient,
    private readonly failing: ReadonlySet<string>,
    private readonly how: 'unparseable' | 'throw' = 'unparseable',
  ) {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const sceneId = /SCENE CARD — (\S+)/.exec(request.contents)?.[1] ?? '';
    this.seen.push(sceneId);
    if (!this.failing.has(sceneId)) return this.inner.generate(request);
    if (this.how === 'throw') throw new Error('503 UNAVAILABLE');
    return {
      text: 'not a response',
      finish_reason: 'MALFORMED_RESPONSE',
      model: 'gemini-3.7-flash',
      usage: { prompt_tokens: 0, output_tokens: 0, cached_tokens: 0, thoughts_tokens: 0 },
    };
  }
}

const cinderella = async (): Promise<StoryPackage> => readFixturePackage('cinderella');

describe('the read-time run loop (ADR 0014)', () => {
  it('compiles every scene in order into a persisted Compiled edition', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      await repository.putPackage(pkg);
      const events: ProgressEvent[] = [];

      const { manifest, report } = await runTelling({
        pkg,
        client: new SyntheticWriterClient(pkg),
        repository,
        onProgress: (event) => events.push(event),
      });

      const scenes = scenesInOrder(pkg);
      expect(manifest.status).toBe('complete');
      expect(manifest.package_version).toBe(pkg.package_version);
      expect(manifest.scenes.map((scene) => scene.scene_id)).toEqual(
        scenes.map((scene) => scene.id),
      );

      // Everything the edition is made of is actually in the store, not only in the return value.
      const persisted = await repository.getEditionManifest(manifest.run_id);
      expect(persisted?.status).toBe('complete');
      const persistedScenes = await repository.getEditionScenes(manifest.run_id);
      expect(persistedScenes).toHaveLength(scenes.length);
      expect(persistedScenes[0]?.prose.length).toBeGreaterThan(0);
      expect(await repository.getEditionWorldModel(manifest.run_id, pkg.story_id)).not.toBeNull();
      expect(await repository.getEditionStateLog(manifest.run_id)).not.toBeNull();
      expect(await repository.getEditionDiscourse(manifest.run_id)).not.toBeNull();
      expect(await repository.getRunReport(manifest.run_id)).not.toBeNull();
      expect(report.scenes).toHaveLength(scenes.length);

      // The story's own index can find the run — what cross-run aggregation reads (§8).
      const index = await repository.getRunIndex(pkg.story_id);
      expect(index.runs.map((run) => run.run_id)).toEqual([manifest.run_id]);
    });
  });

  it('mints a fresh run id on every telling and never reuses a previous one (§3)', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      await repository.putPackage(pkg);
      const client = new SyntheticWriterClient(pkg);

      const first = await runTelling({ pkg, client, repository });
      const second = await runTelling({ pkg, client: new SyntheticWriterClient(pkg), repository });

      expect(first.manifest.run_id).not.toBe(second.manifest.run_id);
      const index = await repository.getRunIndex(pkg.story_id);
      expect(index.runs).toHaveLength(2);
      // Nothing threw the first run away.
      expect(await repository.getEditionManifest(first.manifest.run_id)).not.toBeNull();
    });
  });

  it('reports scene-count progress and never prose or diagnostics (§4)', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      await repository.putPackage(pkg);
      const events: ProgressEvent[] = [];

      await runTelling({
        pkg,
        client: new SyntheticWriterClient(pkg),
        repository,
        onProgress: (event) => events.push(event),
      });

      const started = events.filter((event) => event.type === 'scene_started');
      expect(started).toHaveLength(scenesInOrder(pkg).length);
      expect(progressText(started[6]!)).toBe('compiling scene 7 of 14');
      expect(events.at(-1)).toMatchObject({ type: 'run_completed', degraded: false });

      // The whole event payload, serialized, holds no prose and no diagnostic text.
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain('stand-in prose');
      expect(serialized).not.toContain('entry_state_mismatch');
    });
  });

  it('flushes each scene before the next one starts, so an interrupted run keeps its scenes', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      await repository.putPackage(pkg);
      const runId = 'run-flush-check';
      const flushedBeforeStep: number[] = [];

      await runTelling({
        pkg,
        client: new SyntheticWriterClient(pkg),
        repository,
        runId,
        step: async (name, run) => {
          // What is in the store *before* this scene's step is what the previous step flushed.
          flushedBeforeStep.push((await repository.getEditionManifest(runId))?.scenes.length ?? -1);
          return run();
        },
      });

      expect(flushedBeforeStep).toEqual(scenesInOrder(pkg).map((_, index) => index));
    });
  });

  it('marks a run degraded past the 20% threshold and refuses to promote it (§7/§9)', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      await repository.putPackage(pkg);
      const scenes = scenesInOrder(pkg);
      const failing = new Set(scenes.slice(0, 4).map((scene) => scene.id));

      const { manifest, report } = await runTelling({
        pkg,
        client: new FailingForScenes(new SyntheticWriterClient(pkg), failing),
        repository,
      });

      expect(report.degraded_scene_count).toBe(4);
      expect(isRunDegraded(scenes.length, 4)).toBe(true);
      expect(manifest.degraded).toBe(true);
      // The run still finished: no diagnostic severity aborts a read-time run.
      expect(manifest.status).toBe('complete');
      expect(manifest.scenes).toHaveLength(scenes.length);

      await expect(repository.promoteToBaked(manifest.run_id)).rejects.toBeInstanceOf(
        BakedPromotionError,
      );
      expect(await repository.getBakedPointer(pkg.story_id)).toBeNull();
    });
  });

  it('promotes a clean run to Baked only when an author asks (§9)', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      await repository.putPackage(pkg);
      const { manifest } = await runTelling({
        pkg,
        client: new SyntheticWriterClient(pkg),
        repository,
      });

      // Nothing in the loop promoted it.
      expect(await repository.getBakedPointer(pkg.story_id)).toBeNull();

      const pointer = await repository.promoteToBaked(manifest.run_id);
      expect(pointer.run_id).toBe(manifest.run_id);
      expect((await repository.getBakedPointer(pkg.story_id))?.run_id).toBe(manifest.run_id);
    });
  });

  it('a few degraded scenes do not degrade the whole run', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      await repository.putPackage(pkg);
      const failing = new Set([scenesInOrder(pkg)[0]!.id]);

      const { manifest, report } = await runTelling({
        pkg,
        client: new FailingForScenes(new SyntheticWriterClient(pkg), failing),
        repository,
      });

      expect(report.degraded_scene_count).toBe(1);
      expect(1 / scenesInOrder(pkg).length).toBeLessThan(DEGRADED_RUN_FRACTION);
      expect(manifest.degraded).toBe(false);
      expect(await repository.promoteToBaked(manifest.run_id)).toMatchObject({
        run_id: manifest.run_id,
      });
    });
  });

  it('halts on a systemic outage, marking the run failed with its flushed scenes intact (§7)', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      await repository.putPackage(pkg);
      const scenes = scenesInOrder(pkg);
      const events: ProgressEvent[] = [];

      await expect(
        runTelling({
          pkg,
          client: new FailingForScenes(
            new SyntheticWriterClient(pkg),
            new Set([scenes[2]!.id]),
            'throw',
          ),
          repository,
          outageRetries: 1,
          outageBackoffMs: 0,
          onProgress: (event) => events.push(event),
        }),
      ).rejects.toThrow('503 UNAVAILABLE');

      const manifest = await repository.getEditionManifest(
        (events[0] as { run_id: string }).run_id,
      );
      expect(manifest?.status).toBe('failed');
      expect(manifest?.scenes).toHaveLength(2);
      expect(events.at(-1)?.type).toBe('run_failed');
    });
  });

  it('offers the Baked edition once a scene stalls past the threshold (§7)', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      await repository.putPackage(pkg);
      const events: ProgressEvent[] = [];

      const slow: ModelClient = {
        generate: async (request) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return new SyntheticWriterClient(pkg).generate(request);
        },
      };

      await runTelling({
        pkg,
        client: slow,
        repository,
        stallThresholdMs: 1,
        onProgress: (event) => events.push(event),
      });

      const offers = events.filter((event) => event.type === 'baked_fallback_offered');
      expect(offers.length).toBeGreaterThan(0);
      // The offer is an offer: the run compiled every scene regardless.
      expect(events.at(-1)).toMatchObject({ type: 'run_completed' });
    });
  });

  it('soft-logs the budget and never enforces it (§6)', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      await repository.putPackage(pkg);

      const { report } = await runTelling({
        pkg,
        client: new SyntheticWriterClient(pkg),
        repository,
      });

      expect(report.budget.expected_output_tokens).toBeGreaterThan(0);
      expect(report.budget.over_budget).toBe(false);
      expect(report.scenes).toHaveLength(scenesInOrder(pkg).length);
    });
  });

  it('never writes the request envelope into the run report (§8)', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      await repository.putPackage(pkg);

      const { report } = await runTelling({
        pkg,
        client: new SyntheticWriterClient(pkg),
        repository,
      });

      const serialized = JSON.stringify(report);
      // Fragments every assembled prompt carries, and none of which belongs in a report.
      expect(serialized).not.toContain('SCENE CARD —');
      expect(serialized).not.toContain('IMAGERY LEDGER');
      expect(serialized).not.toContain('WORLD MODEL');
      expect(renderRunReport(report)).toContain('RUN REPORT');
    });
  });

  it('rejects a package the plant-obligation walk fails, before spending a token', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      const broken: StoryPackage = {
        ...pkg,
        scene_cards: pkg.scene_cards.map((card, index) =>
          index === 0 ? { ...card, pays_off: [{ fact_ref: 'fact_unplanted', plant: null }] } : card,
        ),
      };
      const client = new SyntheticWriterClient(pkg);

      await expect(
        runTelling({ pkg: broken, client, repository }),
      ).rejects.toBeInstanceOf(PlantWalkRejectedError);
      expect(client.requests).toHaveLength(0);
    });
  });

  it('runs each scene inside one step boundary (§2)', async () => {
    await withRepository(async (repository) => {
      const pkg = await cinderella();
      await repository.putPackage(pkg);
      const steps: string[] = [];

      await runTelling({
        pkg,
        client: new SyntheticWriterClient(pkg),
        repository,
        step: async (name, run) => {
          steps.push(name);
          return run();
        },
      });

      expect(steps).toHaveLength(scenesInOrder(pkg).length);
      expect(steps[0]).toBe('scene-1');
    });
  });
});
