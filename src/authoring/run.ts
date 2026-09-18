/**
 * The Authoring run (ADR 0021): the durable job behind the Generate entry point.
 *
 * Shares the read-time run loop's `StepRunner` seam and mint-id/poll HTTP shape, but not its
 * scene-shaped `EditionManifest` — an Authoring run has pipeline **stages**, not scenes, until
 * the `segment` stage finishes. See `src/authoring/generate-run.ts` for the loop itself.
 */

import { z } from 'zod';

export const AUTHORING_RUN_SCHEMA_VERSION = '1.0';

export const AUTHORING_RUN_STATUSES = ['running', 'complete', 'failed'] as const;
export type AuthoringRunStatus = (typeof AUTHORING_RUN_STATUSES)[number];

/**
 * `arc` drafts a Fabula arc from a premise; `segment` turns it into Scene Cards. Two stages, not
 * two author-visible jobs (ADR 0021 decision 5) — an unsegmented package has no Scene Cards yet
 * and isn't reviewable anywhere the author already looks.
 */
export const AUTHORING_RUN_STAGES = ['arc', 'segment'] as const;
export type AuthoringRunStage = (typeof AUTHORING_RUN_STAGES)[number];

export const AuthoringRunFailureSchema = z.object({
  stage: z.enum(AUTHORING_RUN_STAGES),
  detail: z.string(),
});
export type AuthoringRunFailure = z.infer<typeof AuthoringRunFailureSchema>;

/**
 * What the author sees once a run completes — enough to render the same import-preview screen a
 * pasted/uploaded package already renders (`new-story-view.tsx`), plus the scene-count-vs-event-
 * count ratio ADR 0021 decision 5 adds as a quality signal for segmentation's known
 * over-segmentation risk. Never a gate — `lint_errors` is informational here, the same as it is
 * on a hand-pasted import; the real gate is publish (ADR 0017 §4).
 */
export const AuthoringRunResultSummarySchema = z.object({
  title: z.string(),
  scenes: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
  events_per_scene: z.number().nonnegative(),
  entities: z.number().int().nonnegative(),
  lint_errors: z.number().int().nonnegative(),
  lint_warnings: z.number().int().nonnegative(),
});
export type AuthoringRunResultSummary = z.infer<typeof AuthoringRunResultSummarySchema>;

export const AuthoringRunManifestSchema = z.object({
  schema_version: z.string().default(AUTHORING_RUN_SCHEMA_VERSION),
  run_id: z.string().min(1),
  /** Only `generate` exists today (#172); `extract` is #173's to add, not redesigned for here. */
  kind: z.literal('generate'),
  status: z.enum(AUTHORING_RUN_STATUSES),
  stage: z.enum(AUTHORING_RUN_STAGES).nullable().default(null),
  stage_text: z.string().nullable().default(null),
  requested_model: z.string().min(1),
  /** Every model that actually answered — a capacity fallback can differ from `requested_model`. */
  models_used: z.array(z.string()).default([]),
  cost_usd: z.number().nonnegative().default(0),
  started_at: z.string(),
  completed_at: z.string().nullable().default(null),
  updated_at: z.string(),
  failure: AuthoringRunFailureSchema.nullable().default(null),
  result: AuthoringRunResultSummarySchema.nullable().default(null),
});
export type AuthoringRunManifest = z.infer<typeof AuthoringRunManifestSchema>;

/**
 * Mint an Authoring run id. Prefixed `gen-` rather than keyed by a story id, because — unlike a
 * telling — an Authoring run exists *before* a story does: its output lands wherever the author
 * eventually sends it through the Import entry point (ADR 0021 decision 3).
 */
export function mintAuthoringRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const nonce = globalThis.crypto.randomUUID().slice(0, 8);
  return `gen-${stamp}-${nonce}`;
}
