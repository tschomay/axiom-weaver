/**
 * The persistence layer over the blob store: Story Package snapshots, the pointer to the
 * current version, and the two state-update commit logs.
 *
 * ADR 0015 §2 is the rule this class exists to enforce: **every `package_version` is written to
 * its own immutable snapshot**, and `story/{storyId}/package.json` is a convenience pointer to
 * the current version, not the sole record — an edition's pinned `package_version` must stay
 * dereferenceable after later edits.
 */

import { z } from 'zod';
import {
  StoryPackageSchema,
  parseStoryPackage,
  type StoryPackage,
} from '../schema/story-package';
import { StateLog, StateLogSchema } from '../world-model/state-log';
import { WorldModel } from '../world-model/world-model';
import {
  BakedPointerSchema,
  EDITION_SCHEMA_VERSION,
  EditionDiscourseSchema,
  EditionManifestSchema,
  EditionSceneSchema,
  RunIndexSchema,
  type BakedPointer,
  type EditionDiscourse,
  type EditionManifest,
  type EditionScene,
  type RunIndex,
} from '../edition/edition';
import { RunReportSchema, isPromotable, type RunReport } from '../edition/run-report';
import {
  DraftManifestSchema,
  DraftSceneSchema,
  emptyDraftManifest,
  type DraftManifest,
  type DraftScene,
} from '../draft/working-draft';
import type { BlobStore } from './blob-store';
import {
  bakedPointerPath,
  draftManifestPath,
  draftScenePath,
  draftStateLogPath,
  editionDiscoursePath,
  editionManifestPath,
  editionScenePath,
  editionStateLogPath,
  editionWorldModelPath,
  packagePointerPath,
  packageVersionPath,
  packageVersionPrefix,
  runIndexPath,
  runReportPath,
  versionFromPackagePath,
} from './paths';

export const PackagePointerSchema = z.object({
  schema_version: z.string(),
  story_id: z.string().min(1),
  current_package_version: z.number().int().positive(),
  /** The snapshot this pointer dereferences to. */
  package_path: z.string().min(1),
  updated_at: z.string(),
});

export type PackagePointer = z.infer<typeof PackagePointerSchema>;

export class PackageVersionConflictError extends Error {
  constructor(storyId: string, version: number) {
    super(
      `package_version ${version} of "${storyId}" is already retained with different content; ` +
        `a retained snapshot is immutable (ADR 0015 §2) — increment package_version instead`,
    );
    this.name = 'PackageVersionConflictError';
  }
}

const stringify = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export class StoryRepository {
  private readonly store: BlobStore;

  constructor(store: BlobStore) {
    this.store = store;
  }

  // --- Story Package snapshots -------------------------------------------------------------

  /**
   * Retain a `package_version` as its own immutable snapshot and repoint `package.json` at it.
   *
   * Re-writing a version with byte-identical content is a no-op, so a repeated fixture load is
   * idempotent. Re-writing it with *different* content throws: that is an author editing content
   * without incrementing `package_version`, which would silently break every edition pinned to it.
   */
  async putPackage(pkg: StoryPackage): Promise<PackagePointer> {
    const snapshotPath = packageVersionPath(pkg.story_id, pkg.package_version);
    const body = stringify(pkg);

    const existing = await this.store.get(snapshotPath);
    if (existing !== null && existing !== body) {
      throw new PackageVersionConflictError(pkg.story_id, pkg.package_version);
    }
    if (existing === null) {
      await this.store.put(snapshotPath, body);
    }

    const pointer: PackagePointer = {
      schema_version: pkg.schema_version,
      story_id: pkg.story_id,
      current_package_version: pkg.package_version,
      package_path: snapshotPath,
      updated_at: new Date().toISOString(),
    };
    await this.store.put(packagePointerPath(pkg.story_id), stringify(pointer), {
      allowOverwrite: true,
    });
    return pointer;
  }

  /** Dereference a retained snapshot. This is what an edition's pinned version resolves to. */
  async getPackageVersion(storyId: string, version: number): Promise<StoryPackage | null> {
    const body = await this.store.get(packageVersionPath(storyId, version));
    if (body === null) return null;
    return StoryPackageSchema.parse(JSON.parse(body));
  }

  async getPointer(storyId: string): Promise<PackagePointer | null> {
    const body = await this.store.get(packagePointerPath(storyId));
    if (body === null) return null;
    return PackagePointerSchema.parse(JSON.parse(body));
  }

  /** The current Story Package, resolved through the pointer. */
  async getCurrentPackage(storyId: string): Promise<StoryPackage | null> {
    const pointer = await this.getPointer(storyId);
    if (pointer === null) return null;
    return this.getPackageVersion(storyId, pointer.current_package_version);
  }

  /** Every retained `package_version`, ascending. */
  async listPackageVersions(storyId: string): Promise<number[]> {
    const pathnames = await this.store.list(packageVersionPrefix(storyId));
    return pathnames
      .map(versionFromPackagePath)
      .filter((version): version is number => version !== null)
      .sort((a, b) => a - b);
  }

  /** Story ids with a package pointer written. */
  async listStoryIds(): Promise<string[]> {
    const pathnames = await this.store.list('story/');
    const ids = new Set<string>();
    for (const pathname of pathnames) {
      const match = /^story\/([^/]+)\/package\.json$/.exec(pathname);
      if (match?.[1] !== undefined) ids.add(match[1]);
    }
    return [...ids].sort();
  }

  // --- State-update commit logs ------------------------------------------------------------

  /** The Working Draft's log — read/write, and the proposals queue's backing store. */
  async getDraftStateLog(storyId: string): Promise<StateLog> {
    const body = await this.store.get(draftStateLogPath(storyId));
    if (body === null) return new StateLog(storyId, null);
    return StateLog.fromJSON(StateLogSchema.parse(JSON.parse(body)));
  }

  async putDraftStateLog(log: StateLog): Promise<void> {
    await this.store.put(draftStateLogPath(log.storyId), stringify(log.toJSON()), {
      allowOverwrite: true,
    });
  }

  /** A Compiled edition's log — same shape, immutable once the run completes. */
  async getEditionStateLog(runId: string): Promise<StateLog | null> {
    const body = await this.store.get(editionStateLogPath(runId));
    if (body === null) return null;
    return StateLog.fromJSON(StateLogSchema.parse(JSON.parse(body)));
  }

  async putEditionStateLog(runId: string, log: StateLog): Promise<void> {
    await this.store.put(editionStateLogPath(runId), stringify(log.toJSON()));
  }

  // --- World Model snapshots ---------------------------------------------------------------

  /** `edition/{runId}/world-model.json` — the tables' state at the close of a run. */
  async putEditionWorldModel(runId: string, model: WorldModel): Promise<void> {
    await this.store.put(editionWorldModelPath(runId), stringify(model.toJSON()));
  }

  async getEditionWorldModel(runId: string, storyId: string): Promise<WorldModel | null> {
    const body = await this.store.get(editionWorldModelPath(runId));
    if (body === null) return null;
    return WorldModel.fromJSON(storyId, JSON.parse(body));
  }

  // --- Compiled editions ---------------------------------------------------------------------
  //
  // Written as the run produces them (ADR 0014 §2's scene-boundary flush). Workflow persistence
  // is not an archive — retention is a day on Hobby — so the edition is these documents, never
  // the run's event log (`docs/research/vercel-runtime.md` §2).

  /**
   * The manifest is the one edition document that is rewritten during a run: its scene index
   * grows at every boundary and its status closes out at the end. Everything else is written once.
   */
  async putEditionManifest(manifest: EditionManifest): Promise<void> {
    await this.store.put(
      editionManifestPath(manifest.run_id),
      stringify(EditionManifestSchema.parse(manifest)),
      { allowOverwrite: true },
    );
  }

  async getEditionManifest(runId: string): Promise<EditionManifest | null> {
    const body = await this.store.get(editionManifestPath(runId));
    if (body === null) return null;
    return EditionManifestSchema.parse(JSON.parse(body));
  }

  /** A scene document, written once. A Compiled edition is immutable once produced. */
  async putEditionScene(scene: EditionScene): Promise<void> {
    await this.store.put(
      editionScenePath(scene.run_id, scene.scene_index),
      stringify(EditionSceneSchema.parse(scene)),
      { allowOverwrite: true },
    );
  }

  async getEditionScene(runId: string, sceneIndex: number): Promise<EditionScene | null> {
    const body = await this.store.get(editionScenePath(runId, sceneIndex));
    if (body === null) return null;
    return EditionSceneSchema.parse(JSON.parse(body));
  }

  /** Every scene of an edition, in order — what a reader is handed once a run completes. */
  async getEditionScenes(runId: string): Promise<EditionScene[]> {
    const manifest = await this.getEditionManifest(runId);
    if (manifest === null) return [];
    const scenes: EditionScene[] = [];
    for (const entry of manifest.scenes) {
      const scene = await this.getEditionScene(runId, entry.scene_index);
      if (scene !== null) scenes.push(scene);
    }
    return scenes.sort((a, b) => a.scene_index - b.scene_index);
  }

  async putEditionDiscourse(discourse: EditionDiscourse): Promise<void> {
    await this.store.put(
      editionDiscoursePath(discourse.run_id),
      stringify(EditionDiscourseSchema.parse(discourse)),
      { allowOverwrite: true },
    );
  }

  async getEditionDiscourse(runId: string): Promise<EditionDiscourse | null> {
    const body = await this.store.get(editionDiscoursePath(runId));
    if (body === null) return null;
    return EditionDiscourseSchema.parse(JSON.parse(body));
  }

  // --- Run reports ---------------------------------------------------------------------------

  /**
   * Rewritten at every scene boundary, not only at the close of the run: a run that dies halfway
   * still has to be able to say what happened to the scenes it did compile.
   */
  async putRunReport(report: RunReport): Promise<void> {
    await this.store.put(
      runReportPath(report.run_id),
      stringify(RunReportSchema.parse(report)),
      { allowOverwrite: true },
    );
  }

  async getRunReport(runId: string): Promise<RunReport | null> {
    const body = await this.store.get(runReportPath(runId));
    if (body === null) return null;
    return RunReportSchema.parse(JSON.parse(body));
  }

  // --- The per-story run index -----------------------------------------------------------------

  async getRunIndex(storyId: string): Promise<RunIndex> {
    const body = await this.store.get(runIndexPath(storyId));
    if (body === null) {
      return { schema_version: EDITION_SCHEMA_VERSION, story_id: storyId, runs: [] };
    }
    return RunIndexSchema.parse(JSON.parse(body));
  }

  /** Record (or update) a run in its story's index. Idempotent on run id. */
  async registerRun(manifest: EditionManifest): Promise<RunIndex> {
    const index = await this.getRunIndex(manifest.story_id);
    const existing = index.runs.find((run) => run.run_id === manifest.run_id);
    const runs = index.runs.filter((run) => run.run_id !== manifest.run_id);
    runs.push({
      run_id: manifest.run_id,
      package_version: manifest.package_version,
      status: manifest.status,
      degraded: manifest.degraded,
      started_at: manifest.started_at,
      // The loop rewrites this entry at every scene boundary; the library is the author's, not
      // the loop's, so it is carried across rather than reset by a run advancing.
      saved: existing?.saved ?? false,
      name: existing?.name ?? null,
      saved_at: existing?.saved_at ?? null,
    });
    runs.sort((a, b) => a.started_at.localeCompare(b.started_at));
    const updated: RunIndex = { ...index, runs };
    await this.store.put(runIndexPath(manifest.story_id), stringify(updated), {
      allowOverwrite: true,
    });
    return updated;
  }

  /** Every run report a story has, oldest first — the input to ADR 0014 §8's aggregation. */
  async getRunReports(storyId: string): Promise<RunReport[]> {
    const index = await this.getRunIndex(storyId);
    const reports: RunReport[] = [];
    for (const run of index.runs) {
      const report = await this.getRunReport(run.run_id);
      if (report !== null) reports.push(report);
    }
    return reports;
  }

  // --- The library (ADR 0015 §5) ---------------------------------------------------------------

  /**
   * Save a telling to the story's library under a name, or rename one already there.
   *
   * The library is "a single story-scoped flat list, not a personal collection per reader" and is
   * author-gated — only the author saves, names or deletes (ADR 0015 §5). The route above this
   * enforces that; this only refuses what makes no sense: a run that does not exist, and one that
   * never finished, since ADR 0014 §3's second arm is a telling a reader can *return to*.
   */
  async saveToLibrary(runId: string, name: string, now: Date = new Date()): Promise<RunIndex> {
    const manifest = await this.getEditionManifest(runId);
    if (manifest === null) throw new LibraryError(runId, 'no such run');
    if (manifest.status !== 'complete') {
      throw new LibraryError(runId, `a telling is saveable once it has finished (it is ${manifest.status})`);
    }

    const trimmed = name.trim();
    if (trimmed === '') throw new LibraryError(runId, 'a library entry needs a name');

    return this.updateRunIndexEntry(manifest.story_id, runId, {
      saved: true,
      name: trimmed,
      saved_at: now.toISOString(),
    });
  }

  /**
   * Take a telling off the library list.
   *
   * Off the list, never off the shelf. ADR 0014 §3 and ADR 0015 §5 both say a completed run is
   * "never auto-deleted" and stays "addressable and shareable by its run ID/URL indefinitely" — so
   * this clears the curation and leaves the edition exactly where it was.
   */
  async removeFromLibrary(storyId: string, runId: string): Promise<RunIndex> {
    return this.updateRunIndexEntry(storyId, runId, {
      saved: false,
      name: null,
      saved_at: null,
    });
  }

  private async updateRunIndexEntry(
    storyId: string,
    runId: string,
    patch: Partial<RunIndex['runs'][number]>,
  ): Promise<RunIndex> {
    const index = await this.getRunIndex(storyId);
    const found = index.runs.find((run) => run.run_id === runId);
    if (found === undefined) throw new LibraryError(runId, `not a telling of "${storyId}"`);

    const runs = index.runs.map((run) => (run.run_id === runId ? { ...run, ...patch } : run));
    const updated: RunIndex = { ...index, runs };
    await this.store.put(runIndexPath(storyId), stringify(updated), { allowOverwrite: true });
    return updated;
  }

  // --- Baked promotion (ADR 0014 §9) -----------------------------------------------------------

  async getBakedPointer(storyId: string): Promise<BakedPointer | null> {
    const body = await this.store.get(bakedPointerPath(storyId));
    if (body === null) return null;
    return BakedPointerSchema.parse(JSON.parse(body));
  }

  /**
   * Promote a completed run to Baked.
   *
   * Manual and author-initiated, always — nothing in the run loop calls this. A `degraded` run is
   * refused outright (ADR 0014 §7/§9): the reader who asked for it can still read it, but it never
   * becomes the edition a first-time reader is handed by default.
   */
  async promoteToBaked(runId: string, now: Date = new Date()): Promise<BakedPointer> {
    const manifest = await this.getEditionManifest(runId);
    if (manifest === null) throw new BakedPromotionError(runId, 'no such run');
    if (!isPromotable({ status: manifest.status, degraded: manifest.degraded })) {
      throw new BakedPromotionError(
        runId,
        manifest.degraded
          ? 'the run is marked degraded and can never be promoted'
          : `the run is ${manifest.status}, not complete`,
      );
    }

    const pointer: BakedPointer = {
      schema_version: EDITION_SCHEMA_VERSION,
      story_id: manifest.story_id,
      run_id: runId,
      package_version: manifest.package_version,
      promoted_at: now.toISOString(),
    };
    await this.store.put(bakedPointerPath(manifest.story_id), stringify(pointer), {
      allowOverwrite: true,
    });
    return pointer;
  }

  // --- The Working Draft (ADR 0015 §1) ---------------------------------------------------------

  async getDraftManifest(storyId: string): Promise<DraftManifest> {
    const body = await this.store.get(draftManifestPath(storyId));
    if (body === null) return emptyDraftManifest(storyId);
    return DraftManifestSchema.parse(JSON.parse(body));
  }

  async putDraftManifest(manifest: DraftManifest): Promise<void> {
    await this.store.put(
      draftManifestPath(manifest.story_id),
      stringify(DraftManifestSchema.parse(manifest)),
      { allowOverwrite: true },
    );
  }

  /** A Working Draft scene is overwritten on every recompile — that is what a draft is. */
  async putDraftScene(scene: DraftScene): Promise<void> {
    await this.store.put(
      draftScenePath(scene.story_id, scene.scene_index),
      stringify(DraftSceneSchema.parse(scene)),
      { allowOverwrite: true },
    );
  }

  async getDraftScene(storyId: string, sceneIndex: number): Promise<DraftScene | null> {
    const body = await this.store.get(draftScenePath(storyId, sceneIndex));
    if (body === null) return null;
    return DraftSceneSchema.parse(JSON.parse(body));
  }

  // --- Convenience -------------------------------------------------------------------------

  /** The seed World Model of a story's current package. */
  async getSeedWorldModel(storyId: string): Promise<WorldModel | null> {
    const pkg = await this.getCurrentPackage(storyId);
    if (pkg === null) return null;
    return WorldModel.fromSeed(pkg.story_id, pkg.world_model_seed);
  }
}

/** Why a library write was refused. The library is the author's shortlist, not the run index. */
export class LibraryError extends Error {
  constructor(runId: string, reason: string) {
    super(`Cannot change the library entry for "${runId}": ${reason}`);
    this.name = 'LibraryError';
  }
}

export class BakedPromotionError extends Error {
  constructor(runId: string, reason: string) {
    super(`Refusing to promote "${runId}" to Baked: ${reason}`);
    this.name = 'BakedPromotionError';
  }
}

export { parseStoryPackage };
