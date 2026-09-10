/**
 * The Working Draft and its staleness mechanics (ADR 0015 §1/§3).
 *
 * The Working Draft is the single per-story, author-time-only sequence of scenes built up by
 * stepwise author-time compiles, each scene recording the `package_version` it was compiled
 * against. **Staleness is a property of the Working Draft only** — a Compiled edition pinned to
 * `package_version` N stays fully correct and unlabelled forever, even after the author advances
 * the package (ADR 0015 §1), which is why nothing in this module ever touches an edition.
 *
 * Propagation is blunt for v1: any diff in the scoped fields flags *every* later scene,
 * unconditionally, carrying the source scene's diff summary rather than a computed per-scene
 * relevance judgment. A precise, dependency-tracked propagation is the natural refinement if
 * blunt-flagging proves too noisy — deliberately not built now.
 *
 * Stale-but-standing is legitimate: nothing auto-recompiles, nothing nags the author, and a
 * Working Draft with stale scenes remains fully readable.
 */

import { z } from 'zod';
import { SceneDigestSchema, type SceneDigest } from '../digest/scene-digest';

export const DRAFT_SCHEMA_VERSION = '1.0';

/**
 * The fields a downstream scene can actually depend on (ADR 0015 §3).
 *
 * `payoffs_closed` is excluded: a payoff only ever references an *earlier* plant, so it cannot
 * create a forward dependency, and a change there is already caught by the plant-obligation walk
 * (ADR 0004). `imagery_signature`, `reanchor_used` and `event_summary` are excluded as
 * self-reported style/pacing metadata and free text with no downstream dependency.
 */
export const STALENESS_FIELDS = [
  'facts_revealed',
  'entities_on_stage',
  'closing_situation',
  'plants_opened',
] as const;

export type StalenessField = (typeof STALENESS_FIELDS)[number];

export const FieldDiffSchema = z.object({
  field: z.enum(STALENESS_FIELDS),
  /** List fields: what the recompile added and removed. Empty for a scalar field. */
  added: z.array(z.string()).default([]),
  removed: z.array(z.string()).default([]),
  /** Scalar fields (`closing_situation`): the before and after text. */
  from: z.string().nullable().default(null),
  to: z.string().nullable().default(null),
});

export const DiffSummarySchema = z.object({
  source_scene_id: z.string().min(1),
  source_scene_index: z.number().int().positive(),
  fields: z.array(FieldDiffSchema).default([]),
  /** The human line a stale badge shows, e.g. ADR 0015 §3's own worked example. */
  summary: z.string(),
  flagged_at: z.string(),
});

export const DraftSceneEntrySchema = z.object({
  scene_id: z.string().min(1),
  scene_index: z.number().int().positive(),
  path: z.string().min(1),
  /** Which `package_version` this scene was compiled against (ADR 0015 §1). */
  compiled_against_package_version: z.number().int().positive(),
  compiled_at: z.string(),
  stale: z.boolean().default(false),
  /** The source scene's diff summary, carried on the flag itself. */
  stale_reason: DiffSummarySchema.nullable().default(null),
});

export const DraftManifestSchema = z.object({
  schema_version: z.string().default(DRAFT_SCHEMA_VERSION),
  story_id: z.string().min(1),
  scenes: z.array(DraftSceneEntrySchema).default([]),
  updated_at: z.string().nullable().default(null),
});

export const DraftSceneSchema = z.object({
  schema_version: z.string().default(DRAFT_SCHEMA_VERSION),
  story_id: z.string().min(1),
  scene_id: z.string().min(1),
  scene_index: z.number().int().positive(),
  prose: z.string(),
  digest: SceneDigestSchema,
  compiled_against_package_version: z.number().int().positive(),
  compiled_at: z.string(),
});

export type FieldDiff = z.infer<typeof FieldDiffSchema>;
export type DiffSummary = z.infer<typeof DiffSummarySchema>;
export type DraftSceneEntry = z.infer<typeof DraftSceneEntrySchema>;
export type DraftManifest = z.infer<typeof DraftManifestSchema>;
export type DraftScene = z.infer<typeof DraftSceneSchema>;

export function emptyDraftManifest(storyId: string): DraftManifest {
  return {
    schema_version: DRAFT_SCHEMA_VERSION,
    story_id: storyId,
    scenes: [],
    updated_at: null,
  };
}

/**
 * The field-scoped digest diff (ADR 0015 §3): the scene's freshly produced Scene Digest against
 * the digest it is about to replace — the one later Working Draft scenes were originally built
 * against. No extra history is needed beyond what is already stored.
 *
 * ADR 0016 §1 reuses this same diff as the stale-badge popover content rather than inventing a
 * second diff mechanic, so it returns structure, not just a boolean.
 */
export function diffDigests(before: SceneDigest, after: SceneDigest): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  for (const field of STALENESS_FIELDS) {
    if (field === 'closing_situation') {
      if (before.closing_situation !== after.closing_situation) {
        diffs.push({
          field,
          added: [],
          removed: [],
          from: before.closing_situation,
          to: after.closing_situation,
        });
      }
      continue;
    }

    const wasList = new Set(before[field]);
    const isList = new Set(after[field]);
    const added = [...isList].filter((value) => !wasList.has(value));
    const removed = [...wasList].filter((value) => !isList.has(value));
    if (added.length > 0 || removed.length > 0) {
      diffs.push({ field, added, removed, from: null, to: null });
    }
  }

  return diffs;
}

/** ADR 0015 §3's own example line: "scene 5 changed: facts_revealed added X, removed Y; …". */
export function describeDiff(sceneIndex: number, diffs: readonly FieldDiff[]): string {
  const parts = diffs.map((diff) => {
    if (diff.field === 'closing_situation') return 'closing_situation changed';
    const clauses: string[] = [];
    if (diff.added.length > 0) clauses.push(`added ${diff.added.join(', ')}`);
    if (diff.removed.length > 0) clauses.push(`removed ${diff.removed.join(', ')}`);
    return `${diff.field} ${clauses.join(', ')}`;
  });
  return `scene ${sceneIndex} changed: ${parts.join('; ')}`;
}

export interface RecompileOutcome {
  readonly manifest: DraftManifest;
  /** The diff that triggered propagation, or `null` when nothing downstream-visible changed. */
  readonly diff: DiffSummary | null;
  readonly newly_stale: string[];
}

/**
 * Record a recompiled scene in the Working Draft and propagate staleness.
 *
 * Triggered when the author recompiles an edited Scene Card: the fresh digest is compared against
 * the digest it replaces, and on any diff in the scoped fields every later scene is flagged
 * stale — bluntly, unconditionally, never auto-recompiled or cascaded.
 *
 * The recompiled scene itself always comes back fresh: it was just built against the current
 * package, so whatever flag it carried is now answered.
 */
export function recordRecompile(input: {
  manifest: DraftManifest;
  scene: { scene_id: string; scene_index: number; path: string };
  digest: SceneDigest;
  previousDigest: SceneDigest | null;
  packageVersion: number;
  now?: Date;
}): RecompileOutcome {
  const now = (input.now ?? new Date()).toISOString();
  const entry: DraftSceneEntry = {
    scene_id: input.scene.scene_id,
    scene_index: input.scene.scene_index,
    path: input.scene.path,
    compiled_against_package_version: input.packageVersion,
    compiled_at: now,
    stale: false,
    stale_reason: null,
  };

  const scenes = input.manifest.scenes.filter((item) => item.scene_id !== entry.scene_id);
  scenes.push(entry);
  scenes.sort((a, b) => a.scene_index - b.scene_index);

  const diffs =
    input.previousDigest === null ? [] : diffDigests(input.previousDigest, input.digest);

  if (diffs.length === 0) {
    return {
      manifest: { ...input.manifest, scenes, updated_at: now },
      diff: null,
      newly_stale: [],
    };
  }

  const summary: DiffSummary = {
    source_scene_id: entry.scene_id,
    source_scene_index: entry.scene_index,
    fields: diffs,
    summary: describeDiff(entry.scene_index, diffs),
    flagged_at: now,
  };

  const newlyStale: string[] = [];
  const propagated = scenes.map((item) => {
    if (item.scene_index <= entry.scene_index) return item;
    if (!item.stale) newlyStale.push(item.scene_id);
    // A later flag replaces an earlier one: the badge shows what most recently invalidated the
    // scene, and the older summary described a digest that has since been replaced anyway.
    return { ...item, stale: true, stale_reason: summary };
  });

  return {
    manifest: { ...input.manifest, scenes: propagated, updated_at: now },
    diff: summary,
    newly_stale: newlyStale,
  };
}

/** Scenes currently flagged stale, in order — the Working Draft's badge list (ADR 0016 §1). */
export function staleScenes(manifest: DraftManifest): DraftSceneEntry[] {
  return manifest.scenes.filter((scene) => scene.stale);
}
