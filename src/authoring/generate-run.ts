/**
 * The Generate entry point's durable job (ADR 0021): draft a Fabula arc from a premise, then
 * segment it into Scene Cards. The reference implementation is the CLI pair
 * `scripts/generate-arc.ts` then `scripts/segment-story.ts` — this is the same two calls, run as
 * one job an author can start from a phone and poll instead of two terminal commands.
 *
 * Two stages, not two author-visible jobs (decision 5): an unsegmented Fabula-only package has no
 * Scene Cards yet and isn't reviewable in any surface the author already has, so there is no real
 * decision to pause for between them. On completion the produced package is handed to the
 * *existing* Import entry point (`src/authoring/transfer.ts`) — this module never writes a
 * Manuscript itself (decision 3).
 */

import { draftPackage } from '../arc/fabula';
import { generateArc, type GenerationCall } from '../arc/generator';
import type { ArcBrief } from '../arc/brief';
import { ExtractionModel } from '../extraction/call';
import { segmentFabulaPackage } from '../segmentation/segment';
import { MODEL_PRICING, type ModelClient } from '../writer/model-client';
import type { StoryRepository } from '../persistence/story-repository';
import { inlineStepRunner, type StepRunner } from '../edition/step-runner';
import { importSummary } from './transfer';
import {
  AUTHORING_RUN_SCHEMA_VERSION,
  mintAuthoringRunId,
  type AuthoringRunFailure,
  type AuthoringRunManifest,
  type AuthoringRunResultSummary,
  type AuthoringRunStage,
} from './run';

/**
 * Stage-based progress (decision 5), mirroring ADR 0014 §4's status-events-only mechanism but
 * with a stage vocabulary instead of a scene count — there is no scene count until `segment`
 * finishes.
 */
export type AuthoringProgressEvent =
  | { readonly type: 'run_started'; readonly run_id: string }
  | { readonly type: 'stage_started'; readonly run_id: string; readonly stage: AuthoringRunStage; readonly text: string }
  | { readonly type: 'stage_progress'; readonly run_id: string; readonly stage: AuthoringRunStage; readonly text: string }
  | { readonly type: 'stage_completed'; readonly run_id: string; readonly stage: AuthoringRunStage; readonly text: string }
  | { readonly type: 'run_completed'; readonly run_id: string }
  | { readonly type: 'run_failed'; readonly run_id: string; readonly stage: AuthoringRunStage; readonly detail: string };

export type AuthoringProgressListener = (event: AuthoringProgressEvent) => void;

export function authoringProgressText(event: AuthoringProgressEvent): string {
  switch (event.type) {
    case 'run_started':
      return 'starting…';
    case 'stage_started':
    case 'stage_progress':
    case 'stage_completed':
      return event.text;
    case 'run_completed':
      return 'ready to review';
    case 'run_failed':
      return `stopped at ${event.stage}: ${event.detail}`;
  }
}

/**
 * Dollar cost of the arc-generation stage's calls.
 *
 * `GenerationCall` (`src/arc/generator.ts`) does not carry `cached_tokens` the way
 * `ExtractionModel`'s `CallRecord` does, because the single arc-generation call has no caching
 * header to benefit from — it is one call, not a per-scene loop over a cached prefix. So this is
 * `costForCalls`'s same formula with the cached term dropped, not an approximation of one.
 */
export function costOfGenerationCalls(calls: readonly GenerationCall[]): number {
  let total = 0;
  for (const call of calls) {
    const price = MODEL_PRICING[call.model];
    if (price === undefined) continue;
    total +=
      (call.prompt_tokens * price.input_per_million +
        (call.output_tokens + call.thoughts_tokens) * price.output_per_million) /
      1_000_000;
  }
  return total;
}

export interface RunGenerateInput {
  readonly brief: ArcBrief;
  readonly client: ModelClient;
  readonly repository: StoryRepository;
  /** Minted fresh for every run unless a caller is resuming a known run id. */
  readonly runId?: string;
  readonly model: string;
  readonly step?: StepRunner;
  readonly onProgress?: AuthoringProgressListener;
  readonly now?: () => Date;
}

export interface RunGenerateResult {
  readonly manifest: AuthoringRunManifest;
}

export async function runGenerate(input: RunGenerateInput): Promise<RunGenerateResult> {
  const { repository, brief, client, model } = input;
  const now = input.now ?? ((): Date => new Date());
  const step = input.step ?? inlineStepRunner;
  const runId = input.runId ?? mintAuthoringRunId(now());
  const emit = (event: AuthoringProgressEvent): void => input.onProgress?.(event);
  const startedAt = now();

  let manifest: AuthoringRunManifest = {
    schema_version: AUTHORING_RUN_SCHEMA_VERSION,
    run_id: runId,
    kind: 'generate',
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

  const flush = async (patch: Partial<AuthoringRunManifest>): Promise<void> => {
    manifest = { ...manifest, ...patch, updated_at: now().toISOString() };
    await repository.putAuthoringRunManifest(manifest);
  };

  const fail = async (stage: AuthoringRunStage, detail: string): Promise<void> => {
    const failure: AuthoringRunFailure = { stage, detail };
    await flush({ status: 'failed', failure, completed_at: now().toISOString() });
    emit({ type: 'run_failed', run_id: runId, stage, detail });
  };

  // --- stage 1: draft the Fabula arc -----------------------------------------------------------

  await flush({ stage: 'arc', stage_text: 'drafting the arc' });
  emit({ type: 'stage_started', run_id: runId, stage: 'arc', text: 'drafting the arc' });

  let generated;
  try {
    generated = await step('arc', () => generateArc(brief, { client, model }));
  } catch (error) {
    await fail('arc', error instanceof Error ? error.message : String(error));
    return { manifest };
  }

  modelsUsed.add(generated.model);
  const arcStageText = `drafted ${generated.arc.events.length} events`;
  await flush({
    models_used: [...modelsUsed],
    cost_usd: manifest.cost_usd + costOfGenerationCalls(generated.calls),
    stage_text: arcStageText,
  });
  emit({ type: 'stage_completed', run_id: runId, stage: 'arc', text: arcStageText });

  const draft = draftPackage(generated.arc, runId, {
    generator: 'app/stories/new — Generate (ADR 0021)',
    model: generated.model,
    generated_at: now().toISOString(),
    brief,
    repairs: generated.repairs,
  });

  // --- stage 2: segment into Scene Cards --------------------------------------------------------

  await flush({ stage: 'segment', stage_text: 'segmenting into scenes' });
  emit({ type: 'stage_started', run_id: runId, stage: 'segment', text: 'segmenting into scenes' });

  const extraction = new ExtractionModel(client, model);
  let segmentation;
  try {
    segmentation = await step('segment', () =>
      segmentFabulaPackage(draft, extraction, {
        onProgress: (text) => emit({ type: 'stage_progress', run_id: runId, stage: 'segment', text }),
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
