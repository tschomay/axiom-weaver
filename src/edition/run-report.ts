/**
 * The run report (ADR 0014 §8).
 *
 * Per scene, whatever diagnostics / retries / fallbacks / repairs the established taxonomy
 * already produces — ADR 0005's and ADR 0012's diagnostic types, ADR 0011's continuity repairs —
 * plus this ticket's own run-level budget and `degraded` flags. Nothing is invented here: the
 * report is a projection of what the loop already had to compute.
 *
 * **It never holds the request envelope sent to Gemini.** `docs/research/vercel-runtime.md` §4's
 * secret-exposure warning is the reason: the assembled prompt is the one artifact of a compile
 * that can carry things a report should not persist, and a report is meant to be read by anyone
 * who can see the edition. Token counts and finish reasons carry the diagnostic value without it.
 *
 * Stored as a Blob document alongside the edition, and aggregated across runs by Scene Card id so
 * an author can see "Scene 13 has degraded on 4 of 20 reads" — the signal that names which cards
 * are underspecified.
 */

import { z } from 'zod';
import {
  DIAGNOSTIC_CODES,
  surfacesFor,
  type Diagnostic,
  type Surface,
} from '../validator/diagnostics';
import { FINDING_MODES } from '../continuity/continuity-pass';
import type { Occasion } from '../validator/state-update-authority';
import { FINISH_REASONS, MODEL_PRICING } from '../writer/model-client';

export const RUN_REPORT_SCHEMA_VERSION = '1.0';

/**
 * ADR 0014 §7: "if more than roughly 20% of a run's scenes degrade to fallback, the whole run is
 * marked `degraded`". Roughly, and a constant rather than a schema field — the shape is the
 * decision, the number is a starting point.
 */
export const DEGRADED_RUN_FRACTION = 0.2;

export const CallRecordSchema = z.object({
  model: z.string().min(1),
  purpose: z.enum([
    'writer',
    'writer_retry',
    'digest_fallback',
    'continuity_repair',
    'digest_rollup',
  ]),
  finish_reason: z.enum(FINISH_REASONS),
  prompt_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cached_tokens: z.number().int().nonnegative(),
  thoughts_tokens: z.number().int().nonnegative(),
});

export const ReportedDiagnosticSchema = z.object({
  code: z.enum(DIAGNOSTIC_CODES),
  severity: z.enum(['error', 'warn', 'info']),
  /** ADR 0016 §4: severity decides which surface, and the report records where it would render. */
  surfaces: z.array(z.enum(['scene_compile_view', 'run_report'])).default([]),
  entity_id: z.string().nullable().default(null),
  column: z.string().nullable().default(null),
  message: z.string(),
});

export const ReportedRepairSchema = z.object({
  mode: z.enum(FINDING_MODES),
  subject: z.string(),
  applied: z.boolean(),
  attempts: z.number().int().nonnegative(),
  detail: z.string(),
  rejection: z.string().nullable().default(null),
});

export const RunReportSceneSchema = z.object({
  scene_id: z.string().min(1),
  scene_index: z.number().int().positive(),
  /** The scene fell back rather than being written whole — the numerator of §7's 20%. */
  degraded: z.boolean().default(false),
  duration_ms: z.number().int().nonnegative().default(0),
  /** Every model call the scene made, retries and fallbacks included — envelopes never. */
  calls: z.array(CallRecordSchema).default([]),
  diagnostics: z.array(ReportedDiagnosticSchema).default([]),
  repairs: z.array(ReportedRepairSchema).default([]),
});

/**
 * ADR 0014 §6: budget is soft-logged, never a hard cap. No global per-run token ceiling aborts a
 * run — exceeding the expected budget is a flag for the author to notice later, never surfaced to
 * the reader and never blocking.
 *
 * "Expected" is the sum of the per-scene output-token budgets the writer contract already sizes
 * (`maxOutputTokensFor`), which is the only figure the compiler knows before a scene is written.
 * Prompt tokens are reported but not budgeted: they are a function of assembly, not of a ceiling
 * anyone set.
 */
export const RunBudgetSchema = z.object({
  expected_output_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  thoughts_tokens: z.number().int().nonnegative(),
  prompt_tokens: z.number().int().nonnegative(),
  cached_tokens: z.number().int().nonnegative(),
  over_budget: z.boolean().default(false),
});

export const RunReportSchema = z.object({
  schema_version: z.string().default(RUN_REPORT_SCHEMA_VERSION),
  run_id: z.string().min(1),
  story_id: z.string().min(1),
  package_version: z.number().int().positive(),
  occasion: z.enum(['author_time', 'read_time']),
  status: z.enum(['running', 'complete', 'failed']),
  degraded: z.boolean().default(false),
  degraded_scene_count: z.number().int().nonnegative().default(0),
  scene_count: z.number().int().nonnegative(),
  budget: RunBudgetSchema,
  started_at: z.string(),
  completed_at: z.string().nullable().default(null),
  duration_ms: z.number().int().nonnegative().default(0),
  scenes: z.array(RunReportSceneSchema).default([]),
});

export type CallRecordDocument = z.infer<typeof CallRecordSchema>;
export type ReportedDiagnostic = z.infer<typeof ReportedDiagnosticSchema>;
export type ReportedRepair = z.infer<typeof ReportedRepairSchema>;
export type RunReportScene = z.infer<typeof RunReportSceneSchema>;
export type RunBudget = z.infer<typeof RunBudgetSchema>;
export type RunReport = z.infer<typeof RunReportSchema>;

/** Project a compiler diagnostic into its report line, carrying where it would render. */
export function reportDiagnostic(entry: Diagnostic, occasion: Occasion): ReportedDiagnostic {
  return {
    code: entry.code,
    severity: entry.severity,
    surfaces: surfacesFor(entry.severity, occasion) as Surface[],
    entity_id: entry.entity_id,
    column: entry.column,
    message: entry.message,
  };
}

/** Whether a run's degraded-scene share has crossed ADR 0014 §7's threshold. */
export function isRunDegraded(sceneCount: number, degradedScenes: number): boolean {
  if (sceneCount === 0) return false;
  return degradedScenes / sceneCount > DEGRADED_RUN_FRACTION;
}

/**
 * A run may be promoted to Baked only if it completed and is not `degraded` (ADR 0014 §9).
 * Promotion itself is always manual and author-initiated; this only says whether it is allowed.
 */
export function isPromotable(report: Pick<RunReport, 'status' | 'degraded'>): boolean {
  return report.status === 'complete' && !report.degraded;
}

export function sumBudget(scenes: readonly RunReportScene[], expected: number): RunBudget {
  const totals = { output_tokens: 0, thoughts_tokens: 0, prompt_tokens: 0, cached_tokens: 0 };
  for (const scene of scenes) {
    for (const call of scene.calls) {
      totals.output_tokens += call.output_tokens;
      totals.thoughts_tokens += call.thoughts_tokens;
      totals.prompt_tokens += call.prompt_tokens;
      totals.cached_tokens += call.cached_tokens;
    }
  }
  return {
    expected_output_tokens: expected,
    ...totals,
    // Thinking tokens bill against the same cap as prose (ADR 0012's `THINKING_RESERVE_FRACTION`),
    // so they count against the budget too — leaving them out would under-report every run.
    over_budget: totals.output_tokens + totals.thoughts_tokens > expected,
  };
}

// --- Cost, after the fact ----------------------------------------------------------------------

export interface RunCost {
  readonly total_usd: number;
  /** False if any call's model has no listed price — `total_usd` is then a partial figure. */
  readonly complete: boolean;
}

/**
 * Dollar cost of a set of calls, from `MODEL_PRICING` and the same token counts the budget
 * already carries. Computed at read time rather than stored on the report: unlike `duration_ms`,
 * a call's actual cost was never a fact fixed at the moment it happened — it is a function of
 * today's price list — so a persisted figure would silently go stale the day pricing changes. A
 * model missing from the table (an old report, or an operator-set `AXIOM_WRITER_MODEL` outside
 * the allowlist) is skipped rather than guessed at, and reported via `complete: false` so the
 * total reads as partial, never as a false precision.
 */
export function costForCalls(calls: readonly CallRecordDocument[]): RunCost {
  let total = 0;
  let complete = true;

  for (const call of calls) {
    const price = MODEL_PRICING[call.model];
    if (price === undefined) {
      complete = false;
      continue;
    }
    const uncachedInput = Math.max(0, call.prompt_tokens - call.cached_tokens);
    total +=
      (uncachedInput * price.input_per_million +
        call.cached_tokens * price.cached_input_per_million +
        (call.output_tokens + call.thoughts_tokens) * price.output_per_million) /
      1_000_000;
  }

  return { total_usd: total, complete };
}

export function costForScenes(scenes: readonly RunReportScene[]): RunCost {
  return costForCalls(scenes.flatMap((scene) => scene.calls));
}

// --- Aggregation across runs ------------------------------------------------------------------

export interface CardAggregate {
  readonly scene_id: string;
  readonly scene_index: number;
  readonly runs: number;
  readonly degraded_runs: number;
  /** Diagnostic code counts across every run, most frequent first. */
  readonly diagnostics: Array<{ code: string; count: number }>;
  readonly repairs_applied: number;
  readonly repairs_rejected: number;
  readonly average_duration_ms: number;
}

/**
 * ADR 0014 §8's aggregation: across runs, grouped by Scene Card id.
 *
 * This is the signal that names which cards are underspecified — a card that degrades on four
 * reads in twenty is telling the author something a single run cannot.
 */
export function aggregateByCard(reports: readonly RunReport[]): CardAggregate[] {
  const byCard = new Map<
    string,
    {
      scene_index: number;
      runs: number;
      degraded: number;
      codes: Map<string, number>;
      applied: number;
      rejected: number;
      duration: number;
    }
  >();

  for (const report of reports) {
    for (const scene of report.scenes) {
      const entry = byCard.get(scene.scene_id) ?? {
        scene_index: scene.scene_index,
        runs: 0,
        degraded: 0,
        codes: new Map<string, number>(),
        applied: 0,
        rejected: 0,
        duration: 0,
      };
      entry.runs += 1;
      if (scene.degraded) entry.degraded += 1;
      entry.duration += scene.duration_ms;
      for (const diagnostic of scene.diagnostics) {
        entry.codes.set(diagnostic.code, (entry.codes.get(diagnostic.code) ?? 0) + 1);
      }
      for (const repair of scene.repairs) {
        if (repair.applied) entry.applied += 1;
        else entry.rejected += 1;
      }
      byCard.set(scene.scene_id, entry);
    }
  }

  return [...byCard.entries()]
    .map(([scene_id, entry]) => ({
      scene_id,
      scene_index: entry.scene_index,
      runs: entry.runs,
      degraded_runs: entry.degraded,
      diagnostics: [...entry.codes.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
      repairs_applied: entry.applied,
      repairs_rejected: entry.rejected,
      average_duration_ms: entry.runs === 0 ? 0 : Math.round(entry.duration / entry.runs),
    }))
    .sort((a, b) => a.scene_index - b.scene_index);
}

// --- The pre-generation estimate (ADR 0014 §5) ------------------------------------------------

/**
 * The project-wide default per-scene compile time, used before any run data exists for a story.
 *
 * A placeholder, and knowingly so: the map's "cost and latency envelope per read at novel scale"
 * fog item wants a *measured* figure, which only real runs can supply. Every completed run feeds
 * `averageSceneDurationMs` below, so a story stops using this number as soon as it has one run of
 * its own.
 */
export const DEFAULT_SCENE_SECONDS = 12;

/** The ±band the estimate is shown with, so "about 2–4 minutes" is a range, not a promise. */
export const ESTIMATE_BAND = 0.35;

export function averageSceneDurationMs(reports: readonly RunReport[]): number | null {
  const durations = reports.flatMap((report) =>
    report.scenes.filter((scene) => scene.duration_ms > 0).map((scene) => scene.duration_ms),
  );
  if (durations.length === 0) return null;
  return durations.reduce((sum, value) => sum + value, 0) / durations.length;
}

export interface CompileEstimate {
  readonly low_seconds: number;
  readonly high_seconds: number;
  /** True when the estimate rests on the project-wide default, not this story's own runs. */
  readonly from_default: boolean;
  readonly text: string;
}

/**
 * ADR 0014 §5: wall-clock only, never cost. A pre-generation cost estimate would need per-scene
 * token projections with no principled basis before the scene is written, and cost is an
 * author/ops concern the run report already covers.
 */
export function estimateCompile(
  sceneCount: number,
  history: readonly RunReport[],
): CompileEstimate {
  const measured = averageSceneDurationMs(history);
  const perScene = measured === null ? DEFAULT_SCENE_SECONDS : measured / 1000;
  const total = perScene * sceneCount;
  // Rounded coarsely on purpose: an estimate accurate to the second would be claiming a precision
  // a rolling average does not have.
  const step = total < 90 ? 5 : 30;
  const low = Math.max(step, Math.round((total * (1 - ESTIMATE_BAND)) / step) * step);
  const high = Math.max(low + step, Math.round((total * (1 + ESTIMATE_BAND)) / step) * step);
  return {
    low_seconds: low,
    high_seconds: high,
    from_default: measured === null,
    text: describeRange(low, high),
  };
}

/** ADR 0014 §5's own phrasing: "about 2–4 minutes" — a range in one unit, never a promise. */
function describeRange(low: number, high: number): string {
  const unit = high < 90 ? 'seconds' : 'minutes';
  const scale = (seconds: number): string => {
    if (unit === 'seconds') return `${seconds}`;
    const minutes = seconds / 60;
    return Number.isInteger(minutes) ? `${minutes}` : minutes.toFixed(1);
  };
  return `about ${scale(low)}–${scale(high)} ${unit}`;
}
