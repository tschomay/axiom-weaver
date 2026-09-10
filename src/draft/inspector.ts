/**
 * The World & Discourse inspector's read model (ADR 0016 §1, surface 2).
 *
 * One question — "what does my story know as of scene N?" — asked of `CONTEXT.md`'s two
 * memories: the World Model (what is true) and the told-ledger (what the reader has been told).
 * ADR 0016 collapses them into two tabs over one scrubber precisely because they are the same
 * interaction pointed at different tables, so they are reconstructed here side by side.
 *
 * Neither half is stored per scene. The World Model half replays the state-update commit log over
 * the seed (`worldModelAsOf`, ADR 0016 §2). The told-ledger half replays the Working Draft's
 * Scene Digests through `ToldLedger.applyDigest`, which is the same path the run loop walks — a
 * fact enters the ledger by having been *told*, so replaying the digests the author's draft
 * actually produced is the only honest way to answer the question backwards.
 *
 * Everything here reads; nothing writes. The inspector never edits the World Model directly —
 * ADR 0016's prototype leaves that out deliberately, and accepting a proposal is the one path by
 * which an author changes state from these surfaces.
 */

import type { StoryPackage } from '../schema/story-package';
import { scenesInOrder } from '../schema/story-package';
import type { SceneDigest } from '../digest/scene-digest';
import { ToldLedger, type ToldLedgerRow } from '../digest/told-ledger';
import { WorldModel } from '../world-model/world-model';
import { StateLog, worldModelAsOf } from '../world-model/state-log';
import type { StoryRepository } from '../persistence/story-repository';

/** One compiled Working Draft scene, reduced to what a replay needs. */
export interface DraftDigestEntry {
  readonly scene_id: string;
  readonly scene_index: number;
  readonly digest: SceneDigest;
}

/**
 * The digests of every scene the Working Draft has compiled, in scene order.
 *
 * Gaps are possible and are not an error: an author who has compiled scenes 1–3 has a draft that
 * stops at 3, and the inspector answers for the scenes that exist rather than refusing.
 */
export async function draftDigestEntries(
  repository: StoryRepository,
  pkg: StoryPackage,
): Promise<DraftDigestEntry[]> {
  const entries: DraftDigestEntry[] = [];
  for (const card of scenesInOrder(pkg)) {
    const stored = await repository.getDraftScene(pkg.story_id, card.order);
    if (stored === null) continue;
    entries.push({ scene_id: card.id, scene_index: card.order, digest: stored.digest });
  }
  return entries;
}

/**
 * The told-ledger as it stood at the close of scene N — every draft digest with
 * `scene_index <= N`, applied in order.
 *
 * Pass `Infinity` for the whole draft; pass `0` for the empty ledger a reader starts a telling
 * with, before anything has been told.
 */
export function toldLedgerAsOf(
  pkg: StoryPackage,
  digests: readonly DraftDigestEntry[],
  sceneIndex: number,
): ToldLedger {
  const ledger = ToldLedger.forPackage(pkg);
  for (const entry of [...digests].sort((a, b) => a.scene_index - b.scene_index)) {
    if (entry.scene_index > sceneIndex) break;
    ledger.applyDigest(entry.digest, entry.scene_index);
  }
  return ledger;
}

export interface InspectorSnapshot {
  /** The scene the scrubber is pointed at; `null` when it is pointed past the whole draft. */
  readonly as_of_scene: number | null;
  /** Scene indexes the Working Draft has compiled — the positions the scrubber can stop at. */
  readonly compiled_scenes: number[];
  readonly world_model: WorldModel;
  readonly told_ledger: ToldLedgerRow[];
  /** State-log entries recorded at exactly this scene — what changed *here*, not cumulatively. */
  readonly changes_at_scene: ReturnType<StateLog['forScene']>;
}

/** Both tabs of the inspector, at one scrubber position. */
export function inspectAsOf(input: {
  pkg: StoryPackage;
  log: StateLog;
  digests: readonly DraftDigestEntry[];
  sceneIndex: number;
}): InspectorSnapshot {
  const { pkg, log, digests, sceneIndex } = input;
  const seed = WorldModel.fromSeed(pkg.story_id, pkg.world_model_seed);
  const compiled = digests.map((entry) => entry.scene_index).sort((a, b) => a - b);

  return {
    as_of_scene: Number.isFinite(sceneIndex) ? sceneIndex : (compiled.at(-1) ?? null),
    compiled_scenes: compiled,
    world_model: worldModelAsOf(seed, log, sceneIndex),
    told_ledger: toldLedgerAsOf(pkg, digests, sceneIndex).all(),
    changes_at_scene: Number.isFinite(sceneIndex) ? log.forScene(sceneIndex) : [],
  };
}

/**
 * The inspector snapshot as a plain, serializable document — one shape for the screen and the
 * JSON route behind it, so a scrubber position means the same thing to both.
 */
export interface InspectorPayload {
  readonly story_id: string;
  readonly as_of_scene: number | null;
  readonly compiled_scenes: number[];
  readonly world_model: ReturnType<WorldModel['toJSON']>;
  readonly told_ledger: ToldLedgerRow[];
  readonly changes_at_scene: ReturnType<StateLog['forScene']>;
  readonly log_entries: number;
}

export async function buildInspectorPayload(
  repository: StoryRepository,
  pkg: StoryPackage,
  sceneIndex: number,
): Promise<InspectorPayload> {
  const log = await repository.getDraftStateLog(pkg.story_id);
  const snapshot = inspectAsOf({
    pkg,
    log,
    digests: await draftDigestEntries(repository, pkg),
    sceneIndex,
  });

  return {
    story_id: pkg.story_id,
    as_of_scene: snapshot.as_of_scene,
    compiled_scenes: snapshot.compiled_scenes,
    world_model: snapshot.world_model.toJSON(),
    told_ledger: snapshot.told_ledger,
    changes_at_scene: snapshot.changes_at_scene,
    log_entries: log.length,
  };
}
