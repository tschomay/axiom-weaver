/**
 * The Extract entry point's durable job (ADR 0021, #173): read a Fabula event list and World Model
 * seed out of existing prose, then segment it into Scene Cards. The reference implementation is
 * the CLI pair `scripts/extract-story.ts` then `scripts/segment-story.ts` — this is the same two
 * calls, run as one job an author can start from a phone and poll.
 *
 * Structurally `runGenerate`'s twin — same manifest, same progress vocabulary, same hand-off to
 * the *existing* Import entry point (decision 3) — with `extract` in place of `arc`. The one real
 * difference is duration: extraction is minutes of windowed calls, not one, so the pipeline's own
 * pass-by-pass progress text is flushed to the manifest as it arrives, not only emitted, or a
 * poller would see "reading the story" and nothing else for the whole stage.
 */

import { ExtractionModel } from '../extraction/call';
import { extractStoryPackage } from '../extraction/pipeline';
import type { LoadedSource } from '../extraction/sources';
import { segmentFabulaPackage } from '../segmentation/segment';
import type { ModelClient } from '../writer/model-client';
import type { StoryRepository } from '../persistence/story-repository';
import { inlineStepRunner, type StepRunner } from '../edition/step-runner';
import type { AuthoringProgressEvent, AuthoringProgressListener } from './generate-run';
import { importSummary } from './transfer';
import {
  AUTHORING_RUN_SCHEMA_VERSION,
  mintAuthoringRunId,
  type AuthoringRunFailure,
  type AuthoringRunManifest,
  type AuthoringRunResultSummary,
  type AuthoringRunStage,
} from './run';

export interface RunExtractInput {
  readonly source: LoadedSource;
  readonly client: ModelClient;
  readonly repository: StoryRepository;
  /** Minted fresh for every run unless a caller is resuming a known run id. */
  readonly runId?: string;
  readonly model: string;
  readonly step?: StepRunner;
  readonly onProgress?: AuthoringProgressListener;
  readonly now?: () => Date;
}

export interface RunExtractResult {
  readonly manifest: AuthoringRunManifest;
}

export async function runExtract(input: RunExtractInput): Promise<RunExtractResult> {
  const { repository, source, client, model } = input;
  const now = input.now ?? ((): Date => new Date());
  const step = input.step ?? inlineStepRunner;
  const runId = input.runId ?? mintAuthoringRunId(now(), 'extract');
  const emit = (event: AuthoringProgressEvent): void => input.onProgress?.(event);
  const startedAt = now();

  let manifest: AuthoringRunManifest = {
    schema_version: AUTHORING_RUN_SCHEMA_VERSION,
    run_id: runId,
    kind: 'extract',
    status: 'running',
    stage: null,
    stage_text: null,
    requested_model: model,
    models_used: [],
    cost_usd: 0,
    started_at: startedAt.toISOString(),
    completed_at: null,
    updated_at: startedAt.toISOString(),
    failure: null,
    result: null,
  };
  await repository.putAuthoringRunManifest(manifest);
  emit({ type: 'run_started', run_id: runId });

  const modelsUsed = new Set<string>();

  // Every manifest write goes through one queue, so a progress flush fired from a synchronous
  // `onProgress` callback can never land after — and overwrite — a later stage or status write.
  let writes: Promise<void> = Promise.resolve();
  const flush = (patch: Partial<AuthoringRunManifest>): Promise<void> => {
    // `.catch` first: a failed progress write must not poison every write queued behind it.
    writes = writes.catch(() => {}).then(async () => {
      manifest = { ...manifest, ...patch, updated_at: now().toISOString() };
      await repository.putAuthoringRunManifest(manifest);
    });
    return writes;
  };

  const stageProgress = (stage: AuthoringRunStage) => (message: string): void => {
    const text = message.trim();
    if (text === '') return;
    emit({ type: 'stage_progress', run_id: runId, stage, text });
    void flush({ stage_text: text }).catch(() => {
      // A lost progress line is cosmetic; the next stage/status write carries the real state.
    });
  };

  const fail = async (stage: AuthoringRunStage, detail: string): Promise<void> => {
    const failure: AuthoringRunFailure = { stage, detail };
    await flush({ status: 'failed', failure, completed_at: now().toISOString() });
    emit({ type: 'run_failed', run_id: runId, stage, detail });
  };

  // --- stage 1: extract the Fabula and World Model seed from the prose -------------------------

  const extractText = `reading ${source.words.toLocaleString('en-US')} words`;
  await flush({ stage: 'extract', stage_text: extractText });
  emit({ type: 'stage_started', run_id: runId, stage: 'extract', text: extractText });

  let extracted;
  try {
    extracted = await step('extract', () =>
      extractStoryPackage(source, client, model, { onProgress: stageProgress('extract') }),
    );
  } catch (error) {
    await fail('extract', error instanceof Error ? error.message : String(error));
    return { manifest };
  }

  const provenance = extracted.sidecar.provenance;
  for (const usedModel of provenance.models_used) modelsUsed.add(usedModel);
  const extractedText =
    `extracted ${extracted.sidecar.events.length} events, ` +
    `${countEntities(extracted.package)} entities`;
  await flush({
    models_used: [...modelsUsed],
    cost_usd: manifest.cost_usd + provenance.cost_usd,
    stage_text: extractedText,
  });
  emit({ type: 'stage_completed', run_id: runId, stage: 'extract', text: extractedText });

  if (extracted.sidecar.events.length === 0) {
    // Segmentation over an empty event list produces an empty package; say so plainly instead of
    // handing the author a zero-scene "result" to review.
    await fail('extract', 'no events were extracted from the text — nothing to segment');
    return { manifest };
  }

  // --- stage 2: segment into Scene Cards --------------------------------------------------------

  await flush({ stage: 'segment', stage_text: 'segmenting into scenes' });
  emit({ type: 'stage_started', run_id: runId, stage: 'segment', text: 'segmenting into scenes' });

  const extraction = new ExtractionModel(client, model);
  let segmentation;
  try {
    segmentation = await step('segment', () =>
      segmentFabulaPackage(extracted.package, extraction, {
        onProgress: stageProgress('segment'),
      }),
    );
  } catch (error) {
    for (const usedModel of extraction.modelsUsed) modelsUsed.add(usedModel);
    await flush({ models_used: [...modelsUsed], cost_usd: manifest.cost_usd + extraction.costUsd });
    await fail('segment', error instanceof Error ? error.message : String(error));
    return { manifest };
  }

  for (const usedModel of extraction.modelsUsed) modelsUsed.add(usedModel);
  await repository.putAuthoringRunResult(runId, segmentation.package);

  const summary = importSummary(segmentation.package);
  const result: AuthoringRunResultSummary = {
    title: summary.title,
    scenes: summary.scenes,
    events: segmentation.report.events,
    events_per_scene: segmentation.report.events_per_scene,
    entities: summary.entities,
    lint_errors: segmentation.report.lint.errors.length,
    lint_warnings: segmentation.report.lint.warnings.length,
    source_words: source.words,
    grounded_rate: extracted.sidecar.grounding.grounded_rate,
  };

  await flush({
    status: 'complete',
    stage: 'segment',
    stage_text: 'ready to review',
    models_used: [...modelsUsed],
    cost_usd: manifest.cost_usd + extraction.costUsd,
    completed_at: now().toISOString(),
    result,
  });
  emit({ type: 'stage_completed', run_id: runId, stage: 'segment', text: 'ready to review' });
  emit({ type: 'run_completed', run_id: runId });

  return { manifest };
}

function countEntities(pkg: { world_model_seed: { characters: unknown[]; locations: unknown[]; objects: unknown[] } }): number {
  const seed = pkg.world_model_seed;
  return seed.characters.length + seed.locations.length + seed.objects.length;
}
