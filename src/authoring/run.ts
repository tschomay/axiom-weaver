/**
 * The Authoring run (ADR 0021): the durable job behind the Generate entry point.
 *
 * Shares the read-time run loop's `StepRunner` seam and mint-id/poll HTTP shape, but not its
 * scene-shaped `EditionManifest` — an Authoring run has pipeline **stages**, not scenes, until
 * the `segment` stage finishes. The loops themselves are `src/authoring/generate-run.ts`
 * (Generate, #172) and `src/authoring/extract-run.ts` (Extract, #173).
 */

import { z } from 'zod';

export const AUTHORING_RUN_SCHEMA_VERSION = '1.0';

export const AUTHORING_RUN_STATUSES = ['running', 'complete', 'failed'] as const;
export type AuthoringRunStatus = (typeof AUTHORING_RUN_STATUSES)[number];

/** Which entry point started the run: a premise (Generate) or existing prose (Extract). */
export const AUTHORING_RUN_KINDS = ['generate', 'extract'] as const;
export type AuthoringRunKind = (typeof AUTHORING_RUN_KINDS)[number];

/**
 * `arc` drafts a Fabula arc from a premise; `extract` reads one out of existing prose; `segment`
 * turns either into Scene Cards. Two stages per run, not two author-visible jobs (ADR 0021
 * decision 5) — an unsegmented package has no Scene Cards yet and isn't reviewable anywhere the
 * author already looks.
 *
 * Extraction is one stage, not the six ADR 0021 decision 4 sketched: its five passes run inside
 * `extractStoryPackage` as one call, and none of them is independently resumable today, so a step
 * boundary per pass would promise a retry granularity nothing backs. Which pass is running still
 * reaches the author, through `stage_text` ("pass 3/5 — events, per window…").
 */
export const AUTHORING_RUN_STAGES = ['arc', 'extract', 'segment'] as const;
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
  /**
   * Extract only (#173): how long the source was, and what share of the pipeline's claims
   * resolved to a real span of it — the one fidelity number a run can report about itself without
   * a ground-truth fixture to score against. `null` on a Generate run, which reads no prose.
   */
  source_words: z.number().int().nonnegative().nullable().default(null),
  grounded_rate: z.number().min(0).max(1).nullable().default(null),
});
export type AuthoringRunResultSummary = z.infer<typeof AuthoringRunResultSummarySchema>;

export const AuthoringRunManifestSchema = z.object({
  schema_version: z.string().default(AUTHORING_RUN_SCHEMA_VERSION),
  run_id: z.string().min(1),
  kind: z.enum(AUTHORING_RUN_KINDS),
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
 * Mint an Authoring run id. Prefixed by kind (`gen-`, `ext-`) rather than keyed by a story id,
 * because — unlike a telling — an Authoring run exists *before* a story does: its output lands
 * wherever the author eventually sends it through the Import entry point (ADR 0021 decision 3).
 */
export function mintAuthoringRunId(
  now: Date = new Date(),
  kind: AuthoringRunKind = 'generate',
): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const nonce = globalThis.crypto.randomUUID().slice(0, 8);
  return `${kind === 'generate' ? 'gen' : 'ext'}-${stamp}-${nonce}`;
}
