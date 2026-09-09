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
import type { BlobStore } from './blob-store';
import {
  draftStateLogPath,
  editionStateLogPath,
  editionWorldModelPath,
  packagePointerPath,
  packageVersionPath,
  packageVersionPrefix,
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

  // --- Convenience -------------------------------------------------------------------------

  /** The seed World Model of a story's current package. */
  async getSeedWorldModel(storyId: string): Promise<WorldModel | null> {
    const pkg = await this.getCurrentPackage(storyId);
    if (pkg === null) return null;
    return WorldModel.fromSeed(pkg.story_id, pkg.world_model_seed);
  }
}

export { parseStoryPackage };
