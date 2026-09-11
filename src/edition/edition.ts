/**
 * The Compiled edition's persisted documents (ADR 0015 §4).
 *
 * A Compiled edition holds the World Model seed, the `package_version` it was compiled from,
 * per-scene prose + Scene Digest, and the run report. It is written *as it is produced* — the
 * scene-boundary flush of ADR 0014 §2 — because Workflow persistence is not an archive (1 day on
 * Hobby, 7 on Pro; `docs/research/vercel-runtime.md` §2's warning). The event log is not the
 * edition; these documents are.
 *
 * Immutable once produced (ADR 0015 §1): an edition pinned to `package_version` N stays fully
 * correct and unlabelled forever, even after the author advances the package. Only the manifest
 * is rewritten during a run, and only to grow its scene index and close out its status.
 */

import { z } from 'zod';
import { SceneDigestSchema } from '../digest/scene-digest';
import { ToldLedgerRowSchema } from '../digest/told-ledger';

export const EDITION_SCHEMA_VERSION = '1.0';

export const EDITION_STATUSES = [
  /** Scenes are still being compiled. The scene index grows at every scene boundary. */
  'running',
  /** Every scene compiled and flushed. The only status a reader may be handed. */
  'complete',
  /** A systemic outage outlived the run's retries. Whatever flushed before it stands. */
  'failed',
] as const;

export type EditionStatus = (typeof EDITION_STATUSES)[number];

export const EditionSceneEntrySchema = z.object({
  scene_id: z.string().min(1),
  scene_index: z.number().int().positive(),
  /** Where the scene document lives — `edition/{runId}/scene-{n}.json`. */
  path: z.string().min(1),
  /** True when the scene fell back rather than being written whole (ADR 0014 §7). */
  degraded: z.boolean().default(false),
  /** Seams the continuity pass repaired in this scene (ADR 0011). */
  repairs_applied: z.number().int().nonnegative().default(0),
});

/**
 * Why a `failed` run stopped.
 *
 * The manifest has always recorded *that* a run failed and never *why*, which is fine for a
 * reader — ADR 0014 §4 shows them scene-count progress and nothing else — and useless for the
 * author surface that has to decide what to offer next. The one failure worth telling apart is a
 * spent daily quota: waiting does not clear it, and only a model with its own allowance gets past
 * it today. Choosing that model stays a decision for a person (AGENTS.md), so this records the
 * fact and nothing more.
 */
export const EditionFailureSchema = z.object({
  detail: z.string(),
  quota_exhausted_for_today: z.boolean().default(false),
  /** The model that ran out, so the surface can say what it was. */
  model: z.string().nullable().default(null),
});

export const EditionManifestSchema = z.object({
  schema_version: z.string().default(EDITION_SCHEMA_VERSION),
  run_id: z.string().min(1),
  story_id: z.string().min(1),
  /** The version this edition pins. Dereferenceable forever via ADR 0015 §2's snapshots. */
  package_version: z.number().int().positive(),
  status: z.enum(EDITION_STATUSES),
  /** ADR 0014 §7: >20% of scenes degraded marks the whole run, and blocks promotion. */
  degraded: z.boolean().default(false),
  /** How many scenes the run expects in total — the denominator of "scene 7 of 14". */
  scene_count: z.number().int().nonnegative(),
  scenes: z.array(EditionSceneEntrySchema).default([]),
  run_report_path: z.string().min(1),
  world_model_path: z.string().nullable().default(null),
  discourse_path: z.string().nullable().default(null),
  state_log_path: z.string().nullable().default(null),
  started_at: z.string(),
  completed_at: z.string().nullable().default(null),
  /**
   * When the run last reported anything — rewritten at every scene-boundary flush.
   *
   * `status` alone cannot tell a live run from an abandoned one. A loop that dies mid-flight — a
   * dev server restarting, a serverless invocation ending and taking the un-awaited loop with it
   * (`docs/research/vercel-runtime.md` §2), a crash before the failure path runs — leaves the
   * manifest saying `running` forever, and a reader watching scene-count progress waits on a run
   * that no longer exists. This is what makes that distinguishable without writing to an edition
   * from a read.
   */
  updated_at: z.string().nullable().default(null),
  /** Null on every status but `failed`, and on a failure with nothing useful to say. */
  failure: EditionFailureSchema.nullable().default(null),
});

export const EditionSceneSchema = z.object({
  schema_version: z.string().default(EDITION_SCHEMA_VERSION),
  run_id: z.string().min(1),
  scene_id: z.string().min(1),
  scene_index: z.number().int().positive(),
  prose: z.string(),
  digest: SceneDigestSchema,
  compiled_at: z.string(),
  degraded: z.boolean().default(false),
});

/**
 * `edition/{runId}/discourse.json` — the Discourse Record at the close of the run.
 *
 * `CONTEXT.md`'s second memory: the Scene Digests plus the told-ledger of what the reader has
 * been told and how recently. The digests are already in the per-scene documents; what only
 * exists here is the told-ledger's final state and the rollups the hierarchy synthesised, neither
 * of which is reconstructible from a scene document alone.
 */
export const EditionDiscourseSchema = z.object({
  schema_version: z.string().default(EDITION_SCHEMA_VERSION),
  run_id: z.string().min(1),
  story_id: z.string().min(1),
  told_ledger: z.array(ToldLedgerRowSchema).default([]),
  /** The hierarchy as it stands at the close of the run, in ADR 0008's payload order. */
  digest_hierarchy: z
    .array(
      z.object({
        level: z.number().int().nonnegative(),
        scene_ids: z.array(z.string()),
        scene_orders: z.array(z.number().int()),
        digest: SceneDigestSchema,
      }),
    )
    .default([]),
  /** Which windows closed, and when — the rollups the run actually paid a synthesis call for. */
  rollup_events: z
    .array(
      z.object({
        from_level: z.number().int().nonnegative(),
        to_level: z.number().int().nonnegative(),
        scene_orders: z.array(z.number().int()),
      }),
    )
    .default([]),
});

/**
 * `story/{storyId}/runs.json` — the story's own list of run ids.
 *
 * Editions are addressed by run id alone (`edition/{runId}/…`, ADR 0015 §4), which is right for
 * sharing but leaves no way to ask "which runs belong to this story" without listing every
 * edition in the store. ADR 0014 §8 requires exactly that question to be answerable: the run
 * report "aggregates across runs grouped by Scene Card id". This index is that lookup and nothing
 * more — it holds no edition content, and an edition stands on its own without it.
 */
export const RunIndexSchema = z.object({
  schema_version: z.string().default(EDITION_SCHEMA_VERSION),
  story_id: z.string().min(1),
  runs: z
    .array(
      z.object({
        run_id: z.string().min(1),
        package_version: z.number().int().positive(),
        status: z.enum(EDITION_STATUSES),
        degraded: z.boolean().default(false),
        started_at: z.string(),
        /**
         * The library (ADR 0015 §5): the author-curated shortlist of tellings worth returning to.
         *
         * A flag on the index rather than a second document, because the library *is* a subset of
         * the runs a story already has — ADR 0014 §3 keeps every completed run and ADR 0015 §5
         * never auto-deletes one, so removing a library entry takes a telling off the list and
         * never off the shelf: its run id keeps working, and a reader who has the URL keeps it.
         */
        saved: z.boolean().default(false),
        /** What the author called it. `null` for a run nobody has named. */
        name: z.string().nullable().default(null),
        saved_at: z.string().nullable().default(null),
      }),
    )
    .default([]),
});

/** `baked/{storyId}.json` — the pointer to the run promoted to Baked (ADR 0014 §9). */
export const BakedPointerSchema = z.object({
  schema_version: z.string().default(EDITION_SCHEMA_VERSION),
  story_id: z.string().min(1),
  run_id: z.string().min(1),
  package_version: z.number().int().positive(),
  /** Manual and author-initiated, always — never a value the run loop writes for itself. */
  promoted_at: z.string(),
});

/**
 * How long a `running` manifest may go without reporting before it is treated as abandoned.
 *
 * Generous on purpose, and a different question from ADR 0014 §7's stall threshold: that one asks
 * "is this slow enough to offer the reader the Baked edition while it carries on", and this one
 * asks "is anything still running at all". A live scene with retries and a paced key can take
 * minutes, so the cost of guessing early is telling a reader their run is dead while it is
 * writing.
 */
export const ABANDONED_AFTER_MS = 6 * 60_000;

/**
 * Milliseconds since a run last reported, or `null` when it has reported nothing at all.
 *
 * Falls back to `started_at` for a manifest written before `updated_at` existed, and for the
 * window between a run starting and its first scene landing.
 */
export function msSinceLastReport(
  manifest: Pick<EditionManifest, 'updated_at' | 'started_at'>,
  now: Date = new Date(),
): number | null {
  const last = manifest.updated_at ?? manifest.started_at;
  const at = Date.parse(last);
  if (Number.isNaN(at)) return null;
  return Math.max(0, now.getTime() - at);
}

/** Whether a run still calling itself `running` has stopped reporting for long enough to doubt. */
export function hasStoppedReporting(
  manifest: Pick<EditionManifest, 'status' | 'updated_at' | 'started_at'>,
  now: Date = new Date(),
): boolean {
  if (manifest.status !== 'running') return false;
  const since = msSinceLastReport(manifest, now);
  return since !== null && since > ABANDONED_AFTER_MS;
}

export type EditionManifest = z.infer<typeof EditionManifestSchema>;
export type EditionFailure = z.infer<typeof EditionFailureSchema>;
export type EditionSceneEntry = z.infer<typeof EditionSceneEntrySchema>;
export type EditionScene = z.infer<typeof EditionSceneSchema>;
export type EditionDiscourse = z.infer<typeof EditionDiscourseSchema>;
export type RunIndex = z.infer<typeof RunIndexSchema>;
export type BakedPointer = z.infer<typeof BakedPointerSchema>;

/**
 * Mint a run id. ADR 0014 §3: a brand-new one every time "generate a new telling" is pressed —
 * every read of the story is a fresh run by design, and a previous run is never silently reused.
 */
export function mintRunId(storyId: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  // The timestamp is for reading a run id, not for telling two apart: two readers pressing the
  // button in the same second must still get different runs.
  const nonce = globalThis.crypto.randomUUID().slice(0, 8);
  return `${storyId}-${stamp}-${nonce}`;
}
