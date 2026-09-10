/**
 * The read-time run loop (ADR 0014).
 *
 * Pressing "generate a new telling" starts a durable run that compiles every scene in order into
 * a persisted Compiled edition. The reader never watches prose stream in — they see scene-count
 * progress until the run completes, then read the finished edition exactly as they would a Baked
 * one (ADR 0014 §1).
 *
 * **One step per scene** (ADR 0014 §2). Inside a single step boundary, in sequence: the writer
 * call (with its own internal bounded retry, ADR 0012) → state-update validation (ADR 0005) →
 * the continuity pass (ADR 0011) → a digest rollup if a window closes (ADR 0008) → a Blob flush.
 * These sub-operations are fast and none needs its own durability boundary, so splitting them
 * would only inflate the billed Workflow Events count with no reliability upside.
 *
 * **The Workflow seam.** `StepRunner` is where Vercel Workflows' `"use step"` goes: `compileStep`
 * below is exactly one step's worth of work, and `runTelling` is exactly the `"use workflow"`
 * body. The default runner executes inline so the loop runs in a test, a script, and a session
 * with no platform underneath it; on Vercel the same function is wrapped by a runner that defers
 * to WDK, and nothing else about this file changes. The durability contract the platform supplies
 * — resume the step that failed, keep running while the reader's tab is closed — is the reason
 * every scene is flushed to Blob before the next one starts rather than at the end of the run.
 */

import { parseVoiceCard } from '../voice/voice-card';
import { scenesInOrder, type SceneCard, type StoryPackage } from '../schema/story-package';
import {
  PlantWalkRejectedError,
  walkPlantObligations,
  type PlantWalk,
} from '../plants/obligation-walk';
import { RunState } from '../writer/run-state';
import { compileScene, maxOutputTokensFor, type CompiledScene } from '../writer/compile-scene';
import type { ModelClient } from '../writer/model-client';
import type { Occasion } from '../validator/state-update-authority';
import type { Diagnostic } from '../validator/diagnostics';
import type { SceneDigest } from '../digest/scene-digest';
import { continuityPass, type ContinuityPassResult } from '../continuity/continuity-pass';
import type { StoryRepository } from '../persistence/story-repository';
import {
  EDITION_SCHEMA_VERSION,
  mintRunId,
  type EditionManifest,
  type EditionSceneEntry,
} from './edition';
import {
  RUN_REPORT_SCHEMA_VERSION,
  isRunDegraded,
  reportDiagnostic,
  sumBudget,
  type RunReport,
  type RunReportScene,
} from './run-report';
import {
  editionDiscoursePath,
  editionScenePath,
  editionStateLogPath,
  editionWorldModelPath,
  runReportPath,
} from '../persistence/paths';

// --- The step seam ----------------------------------------------------------------------------

/** One durable unit of work. On Vercel this is a `"use step"` function; inline everywhere else. */
export type StepRunner = <T>(name: string, run: () => Promise<T>) => Promise<T>;

export const inlineStepRunner: StepRunner = (_name, run) => run();

// --- Progress ---------------------------------------------------------------------------------

/**
 * Status events only — never prose, never diagnostics, never any other compiler artifact
 * (ADR 0014 §4).
 *
 * This is what travels over the resumable stream the Workflow already provides for
 * reconnect-safety. One mechanism serves both reliability and the progress UI rather than a
 * second polling path duplicating the same reconnect edge cases.
 */
export type ProgressEvent =
  | { type: 'run_started'; run_id: string; scene_count: number }
  | { type: 'scene_started'; run_id: string; scene_number: number; scene_count: number }
  | { type: 'scene_completed'; run_id: string; scene_number: number; scene_count: number }
  /** ADR 0014 §7's escape hatch: read the Baked edition while this run keeps compiling. */
  | { type: 'baked_fallback_offered'; run_id: string; stalled_ms: number }
  | { type: 'run_completed'; run_id: string; scene_count: number; degraded: boolean }
  | { type: 'run_failed'; run_id: string; scene_number: number; detail: string };

export type ProgressListener = (event: ProgressEvent) => void;

/** "compiling scene 7 of 14" — the progress UI's whole vocabulary, sourced from step completion. */
export function progressText(event: ProgressEvent): string {
  switch (event.type) {
    case 'run_started':
      return `starting a new telling — ${event.scene_count} scenes`;
    case 'scene_started':
      return `compiling scene ${event.scene_number} of ${event.scene_count}`;
    case 'scene_completed':
      return `compiled scene ${event.scene_number} of ${event.scene_count}`;
    case 'baked_fallback_offered':
      return 'this is taking longer than usual — you can read the Baked edition while it finishes';
    case 'run_completed':
      return event.degraded ? 'telling complete (degraded)' : 'telling complete';
    case 'run_failed':
      return `the telling stopped at scene ${event.scene_number}: ${event.detail}`;
  }
}

// --- The loop ---------------------------------------------------------------------------------

/**
 * ADR 0014 §7: past roughly 90 seconds with no scene completing, the reader is offered the Baked
 * edition. The run keeps compiling, unattended, in the background regardless of whether they take
 * the offer — the offer is a progress event, never an instruction to the loop.
 */
export const STALL_THRESHOLD_MS = 90_000;

/**
 * How many times the loop itself re-attempts a step that threw before giving up on the run.
 *
 * A thrown step is the systemic-outage shape (ADR 0014 §7): repeated hard errors, not a content
 * issue. On Vercel the platform's own retry/backoff owns this and the step simply resumes; this
 * local bound is what stands in for it when the same loop runs inline, so an offline run behaves
 * the same way rather than dying on the first 503.
 */
export const OUTAGE_RETRIES = 2;
export const OUTAGE_BACKOFF_MS = 2_000;

export interface RunTellingInput {
  readonly pkg: StoryPackage;
  readonly client: ModelClient;
  readonly repository: StoryRepository;
  /** Minted fresh for every telling (ADR 0014 §3) unless a caller is resuming a known run. */
  readonly runId?: string;
  readonly occasion?: Occasion;
  /** Overrides the writer model for every scene of the run — see `TESTING_WRITER_MODEL`. */
  readonly writerModel?: string;
  readonly window?: number;
  readonly onProgress?: ProgressListener;
  readonly step?: StepRunner;
  readonly now?: () => Date;
  readonly stallThresholdMs?: number;
  readonly outageRetries?: number;
  readonly outageBackoffMs?: number;
}

export interface RunTellingResult {
  readonly manifest: EditionManifest;
  readonly report: RunReport;
  readonly state: RunState;
}

export async function runTelling(input: RunTellingInput): Promise<RunTellingResult> {
  const { pkg, repository } = input;
  const now = input.now ?? (() => new Date());
  const step = input.step ?? inlineStepRunner;
  const occasion: Occasion = input.occasion ?? 'read_time';
  const runId = input.runId ?? mintRunId(pkg.story_id, now());
  const emit = (event: ProgressEvent) => input.onProgress?.(event);

  // ADR 0004 §4: the plant walk is a hard failure *before* generation, never silently patched.
  // Rejecting here costs no tokens, which is exactly why it runs before the first step.
  const walk = walkPlantObligations(pkg);
  if (walk.errors.length > 0) throw new PlantWalkRejectedError(pkg.story_id, walk);

  const scenes = scenesInOrder(pkg);
  const voiceCard = parseVoiceCard(pkg.voice_card);
  const state = new RunState(pkg, { window: input.window, runId });
  const startedAt = now();

  const manifest: EditionManifest = {
    schema_version: EDITION_SCHEMA_VERSION,
    run_id: runId,
    story_id: pkg.story_id,
    package_version: pkg.package_version,
    status: 'running',
    degraded: false,
    scene_count: scenes.length,
    scenes: [],
    run_report_path: runReportPath(runId),
    world_model_path: null,
    discourse_path: null,
    state_log_path: null,
    started_at: startedAt.toISOString(),
    completed_at: null,
  };

  const report: RunReport = {
    schema_version: RUN_REPORT_SCHEMA_VERSION,
    run_id: runId,
    story_id: pkg.story_id,
    package_version: pkg.package_version,
    occasion,
    status: 'running',
    degraded: false,
    degraded_scene_count: 0,
    scene_count: scenes.length,
    budget: sumBudget([], expectedOutputTokens(scenes)),
    started_at: startedAt.toISOString(),
    completed_at: null,
    duration_ms: 0,
    scenes: [],
  };

  await repository.putEditionManifest(manifest);
  await repository.putRunReport(report);
  await repository.registerRun(manifest);
  emit({ type: 'run_started', run_id: runId, scene_count: scenes.length });

  let previous: { scene_id: string; digest: SceneDigest } | null = null;

  for (const [position, scene] of scenes.entries()) {
    const sceneNumber = position + 1;
    emit({ type: 'scene_started', run_id: runId, scene_number: sceneNumber, scene_count: scenes.length });

    // The stall watch is a timer on the step, not a deadline for it: the offer goes out and the
    // run carries on compiling either way (ADR 0014 §7).
    const stallTimer = setTimeout(
      () =>
        emit({
          type: 'baked_fallback_offered',
          run_id: runId,
          stalled_ms: input.stallThresholdMs ?? STALL_THRESHOLD_MS,
        }),
      input.stallThresholdMs ?? STALL_THRESHOLD_MS,
    );
    if (typeof stallTimer === 'object' && 'unref' in stallTimer) stallTimer.unref();

    let outcome: SceneOutcome;
    try {
      outcome = await withOutageRetry(
        () =>
          step(`scene-${scene.order}`, () =>
            compileStep({
              pkg,
              scene,
              state,
              walk,
              voiceCard,
              client: input.client,
              occasion,
              writerModel: input.writerModel,
              previous,
              runId,
              repository,
              manifest,
              report,
              now,
            }),
          ),
        input.outageRetries ?? OUTAGE_RETRIES,
        input.outageBackoffMs ?? OUTAGE_BACKOFF_MS,
      );
    } catch (error) {
      clearTimeout(stallTimer);
      // The outage outlived its retries. Everything already flushed stands — the reader's own
      // still-in-flight run is the only thing ever rejoined, and it is rejoined from Blob.
      const detail = error instanceof Error ? error.message : String(error);
      await closeOut({
        repository,
        manifest,
        report,
        state,
        status: 'failed',
        startedAt,
        now,
      });
      emit({ type: 'run_failed', run_id: runId, scene_number: sceneNumber, detail });
      throw error;
    }
    clearTimeout(stallTimer);

    previous = { scene_id: scene.id, digest: outcome.digest };
    emit({
      type: 'scene_completed',
      run_id: runId,
      scene_number: sceneNumber,
      scene_count: scenes.length,
    });
  }

  const closed = await closeOut({
    repository,
    manifest,
    report,
    state,
    status: 'complete',
    startedAt,
    now,
  });

  emit({
    type: 'run_completed',
    run_id: runId,
    scene_count: scenes.length,
    degraded: closed.manifest.degraded,
  });

  return { manifest: closed.manifest, report: closed.report, state };
}

// --- One step ---------------------------------------------------------------------------------

interface SceneOutcome {
  readonly digest: SceneDigest;
  readonly degraded: boolean;
}

interface CompileStepInput {
  readonly pkg: StoryPackage;
  readonly scene: SceneCard;
  readonly state: RunState;
  readonly walk: PlantWalk;
  readonly voiceCard: ReturnType<typeof parseVoiceCard>;
  readonly client: ModelClient;
  readonly occasion: Occasion;
  readonly writerModel: string | undefined;
  readonly previous: { scene_id: string; digest: SceneDigest } | null;
  readonly runId: string;
  readonly repository: StoryRepository;
  readonly manifest: EditionManifest;
  readonly report: RunReport;
  readonly now: () => Date;
}

/**
 * Everything one scene needs, inside one durability boundary.
 *
 * The manifest and report are carried in memory here and flushed at the end of the step. Under
 * WDK, where each step is a separate invocation, this is the one thing that changes shape: the
 * step re-reads both from Blob instead of closing over them. The flush itself — what is written
 * and when — stays exactly as it is, which is why the durability port does not touch anything
 * else in this file.
 *
 * The order is ADR 0014 §2's, and it is load-bearing in two places: the continuity pass must run
 * *before* the run state advances, because it compares against the told-ledger as it stood at the
 * scene's entry (ADR 0011 §2); and the Blob flush must come last, because it is what makes the
 * scene survive the step.
 */
async function compileStep(input: CompileStepInput): Promise<SceneOutcome> {
  const { scene, state, pkg, repository } = input;
  const startedAt = input.now();

  const compiled = await compileScene({
    pkg,
    scene,
    model: state.model,
    voiceCard: input.voiceCard,
    hierarchy: state.hierarchy,
    ledger: state.ledger,
    plantWalk: input.walk,
    client: input.client,
    imageryHistory: state.imageryHistory,
    previousParagraph: state.previousParagraph,
    occasion: input.occasion,
    writerModel: input.writerModel,
  });

  // 2. State-update validation (ADR 0005). The writer's proposals are never trusted on sight.
  const validation = state.commitWriterUpdates(
    scene,
    compiled.response.state_updates,
    input.occasion,
  );

  // 3. The continuity pass (ADR 0011), against the told-ledger as it stands at scene entry.
  const pass = await continuityPass({
    scene,
    digest: compiled.digest,
    prose: compiled.prose,
    state_updates: compiled.response.state_updates,
    previous: input.previous,
    ledgerAtEntry: state.ledger,
    expectedBands: compiled.reanchoring,
    imageryHistory: state.imageryHistory,
    client: input.client,
    occasion: input.occasion,
  });

  // 4. Advance the run: told-ledger, imagery history, and the digest rollup if a window closes.
  state.advance(scene, pass.digest, pass.prose);

  const degraded = isDegraded(compiled);
  const diagnostics: Diagnostic[] = [
    ...compiled.diagnostics,
    ...validation.diagnostics,
    ...pass.diagnostics,
  ];
  const finishedAt = input.now();

  // 5. The Blob flush. Scene document first, then the manifest and report that point at it, so a
  //    run interrupted between writes never advertises a scene that is not there.
  await repository.putEditionScene({
    schema_version: EDITION_SCHEMA_VERSION,
    run_id: input.runId,
    scene_id: scene.id,
    scene_index: scene.order,
    prose: pass.prose,
    digest: pass.digest,
    compiled_at: finishedAt.toISOString(),
    degraded,
  });

  const entry: EditionSceneEntry = {
    scene_id: scene.id,
    scene_index: scene.order,
    path: editionScenePath(input.runId, scene.order),
    degraded,
    repairs_applied: pass.repairs.filter((repair) => repair.applied).length,
  };
  input.manifest.scenes.push(entry);
  input.report.scenes.push(
    reportScene({
      scene,
      compiled,
      pass,
      diagnostics,
      degraded,
      occasion: input.occasion,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    }),
  );

  const degradedCount = input.manifest.scenes.filter((item) => item.degraded).length;
  input.manifest.degraded = isRunDegraded(input.manifest.scene_count, degradedCount);
  input.report.degraded = input.manifest.degraded;
  input.report.degraded_scene_count = degradedCount;
  input.report.budget = sumBudget(input.report.scenes, input.report.budget.expected_output_tokens);

  await repository.putEditionManifest(input.manifest);
  await repository.putRunReport(input.report);

  return { digest: pass.digest, degraded };
}

/**
 * A scene is degraded when it fell back rather than being written whole — ADR 0012 §6's
 * conservative-digest path, logged as `scene_generation_failed`.
 *
 * A `truncated_scene` recovery is deliberately *not* degraded: the prose survived the cut and the
 * digest was fully recovered by the fallback call, so nothing had to be guessed. ADR 0012 already
 * grades that `info` for the same reason.
 */
export function isDegraded(compiled: CompiledScene): boolean {
  return compiled.diagnostics.some((entry) => entry.code === 'scene_generation_failed');
}

function reportScene(input: {
  scene: SceneCard;
  compiled: CompiledScene;
  pass: ContinuityPassResult;
  diagnostics: readonly Diagnostic[];
  degraded: boolean;
  occasion: Occasion;
  durationMs: number;
}): RunReportScene {
  return {
    scene_id: input.scene.id,
    scene_index: input.scene.order,
    degraded: input.degraded,
    duration_ms: Math.max(0, input.durationMs),
    calls: [...input.compiled.calls, ...input.pass.calls],
    diagnostics: input.diagnostics.map((entry) => reportDiagnostic(entry, input.occasion)),
    repairs: input.pass.repairs.map((repair) => ({
      mode: repair.finding.mode,
      subject: repair.finding.subject,
      applied: repair.applied,
      attempts: repair.attempts,
      detail: repair.finding.detail,
      rejection: repair.rejection,
    })),
  };
}

function expectedOutputTokens(scenes: readonly SceneCard[]): number {
  return scenes.reduce((total, scene) => total + maxOutputTokensFor(scene), 0);
}

async function withOutageRetry<T>(
  run: () => Promise<T>,
  retries: number,
  backoffMs: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, backoffMs * (attempt + 1)));
    }
  }
  throw lastError;
}

/** Write the documents that only exist once the run stops advancing, and close the manifest. */
async function closeOut(input: {
  repository: StoryRepository;
  manifest: EditionManifest;
  report: RunReport;
  state: RunState;
  status: 'complete' | 'failed';
  startedAt: Date;
  now: () => Date;
}): Promise<{ manifest: EditionManifest; report: RunReport }> {
  const { repository, manifest, report, state } = input;
  const completedAt = input.now();

  await repository.putEditionWorldModel(manifest.run_id, state.model);
  await repository.putEditionStateLog(manifest.run_id, state.log);
  await repository.putEditionDiscourse({
    schema_version: EDITION_SCHEMA_VERSION,
    run_id: manifest.run_id,
    story_id: manifest.story_id,
    told_ledger: state.ledger.all(),
    digest_hierarchy: state.hierarchy.inPayloadOrder().map((entry) => ({
      level: entry.level,
      scene_ids: entry.scene_ids,
      scene_orders: entry.scene_orders,
      digest: entry.digest,
    })),
    rollup_events: state.hierarchy.rollupEvents(),
  });

  manifest.status = input.status;
  manifest.completed_at = completedAt.toISOString();
  manifest.world_model_path = editionWorldModelPath(manifest.run_id);
  manifest.discourse_path = editionDiscoursePath(manifest.run_id);
  manifest.state_log_path = editionStateLogPath(manifest.run_id);

  report.status = input.status;
  report.completed_at = completedAt.toISOString();
  report.duration_ms = Math.max(0, completedAt.getTime() - input.startedAt.getTime());

  await repository.putEditionManifest(manifest);
  await repository.putRunReport(report);
  await repository.registerRun(manifest);

  return { manifest, report };
}
