/**
 * Author-time compiling into the Working Draft.
 *
 * The read-time counterpart is `run-loop.ts`, and the difference is exactly the two things
 * `CONTEXT.md`'s "Compile occasions" names: this one is stepwise (one card at a time, chosen by
 * the author) and has a human in the loop, so the continuity pass runs with full authority
 * (ADR 0011 §2) and a volitional proposal waits in the queue instead of being resolved unattended
 * (ADR 0016 §3 — the validator already does this, keyed on `occasion`).
 *
 * Recompiling a card is where staleness comes from (ADR 0015 §3): the scene's fresh Scene Digest
 * is compared against the digest it replaces, and any diff in the scoped fields flags every later
 * scene in the draft. Nothing is auto-recompiled and nothing nags — stale-but-standing is a
 * legitimate state.
 */

import type { StoryPackage } from '../schema/story-package';
import { scenesInOrder } from '../schema/story-package';
import type { SceneDigest } from '../digest/scene-digest';
import { PlantWalkRejectedError, walkPlantObligations } from '../plants/obligation-walk';
import { parseVoiceCard } from '../voice/voice-card';
import { replayTo } from '../writer/run-state';
import { modelSummarizer, type RollupCall } from '../digest/hierarchy';
import { compileScene, type CallRecord, type CompiledScene } from '../writer/compile-scene';
import type { ModelClient } from '../writer/model-client';
import { continuityPass, type ContinuityPassResult } from '../continuity/continuity-pass';
import type { Diagnostic } from '../validator/diagnostics';
import type { ValidationResult } from '../validator/state-update-authority';
import type { StoryRepository } from '../persistence/story-repository';
import { draftScenePath } from '../persistence/paths';
import {
  DRAFT_SCHEMA_VERSION,
  recordRecompile,
  type DiffSummary,
  type DraftManifest,
} from './working-draft';

export interface DraftCompileResult {
  readonly compiled: CompiledScene;
  readonly pass: ContinuityPassResult;
  readonly validation: ValidationResult;
  readonly manifest: DraftManifest;
  /** The diff that propagated staleness, or `null` when nothing downstream-visible changed. */
  readonly diff: DiffSummary | null;
  readonly newly_stale: string[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Compile one Scene Card into the Working Draft.
 *
 * Earlier draft scenes supply the digests this scene is compiled against, so compiling scene 6
 * costs one call and not six. A scene whose predecessors are not in the draft yet cannot be
 * compiled — `replayTo` says so rather than quietly compiling against an empty history.
 */
export async function compileSceneIntoDraft(input: {
  pkg: StoryPackage;
  sceneId: string;
  client: ModelClient;
  repository: StoryRepository;
  /** Which model writes the scene. Defaults to `WRITER_MODEL`, as the read-time loop does. */
  writerModel?: string;
  window?: number;
  now?: () => Date;
}): Promise<DraftCompileResult> {
  const { pkg, repository } = input;
  const now = input.now ?? (() => new Date());

  const rollupCalls: RollupCall[] = [];

  const walk = walkPlantObligations(pkg);
  if (walk.errors.length > 0) throw new PlantWalkRejectedError(pkg.story_id, walk);

  const scene = scenesInOrder(pkg).find((card) => card.id === input.sceneId);
  if (scene === undefined) {
    throw new Error(`No Scene Card "${input.sceneId}" in "${pkg.story_id}"`);
  }

  const priorDigests = await draftDigests(repository, pkg, scene.order);
  const state = await replayTo(pkg, scene.id, priorDigests, {
    window: input.window,
    occasion: 'author_time',
    // ADR 0003 §6's fresh synthesis, not the offline concatenation. A replay can close a window
    // just as a run can, and a Working Draft built on pasted-together summaries misremembers its
    // own earlier chapters exactly as a telling would.
    summarize: modelSummarizer(input.client, {
      onCall: (call) => rollupCalls.push(call),
    }),
  });

  const compiled = await compileScene({
    pkg,
    scene,
    model: state.model,
    voiceCard: parseVoiceCard(pkg.voice_card),
    hierarchy: state.hierarchy,
    ledger: state.ledger,
    plantWalk: walk,
    client: input.client,
    writerModel: input.writerModel,
    imageryHistory: state.imageryHistory,
    previousParagraph: state.previousParagraph,
    occasion: 'author_time',
  });

  const validation = state.commitWriterUpdates(
    scene,
    compiled.response.state_updates,
    'author_time',
  );

  const previousScene = scenesInOrder(pkg).find((card) => card.order === scene.order - 1);
  const pass = await continuityPass({
    scene,
    digest: compiled.digest,
    prose: compiled.prose,
    state_updates: compiled.response.state_updates,
    previous:
      previousScene === undefined || priorDigests.get(previousScene.id) === undefined
        ? null
        : { scene_id: previousScene.id, digest: priorDigests.get(previousScene.id)! },
    ledgerAtEntry: state.ledger,
    expectedBands: compiled.reanchoring,
    imageryHistory: state.imageryHistory,
    client: input.client,
    occasion: 'author_time',
  });

  // The digest this recompile replaces — what the later draft scenes were built against.
  const existing = await repository.getDraftScene(pkg.story_id, scene.order);

  await repository.putDraftScene({
    schema_version: DRAFT_SCHEMA_VERSION,
    story_id: pkg.story_id,
    scene_id: scene.id,
    scene_index: scene.order,
    prose: pass.prose,
    digest: pass.digest,
    compiled_against_package_version: pkg.package_version,
    compiled_at: now().toISOString(),
  });

  const outcome = recordRecompile({
    manifest: await repository.getDraftManifest(pkg.story_id),
    scene: {
      scene_id: scene.id,
      scene_index: scene.order,
      path: draftScenePath(pkg.story_id, scene.order),
    },
    digest: pass.digest,
    previousDigest: existing?.digest ?? null,
    packageVersion: pkg.package_version,
    now: now(),
  });
  await repository.putDraftManifest(outcome.manifest);

  // The commit log is append-only and per story, so a recompile *adds* what it decided rather
  // than rewriting what an earlier compile decided (ADR 0016 §2). Replay applies entries in
  // order, so the recompile's values are the ones that stand — and the earlier decision, and any
  // proposal still pending against it, stay on the record.
  const log = await repository.getDraftStateLog(pkg.story_id);
  log.appendAll(validation.entries);
  await repository.putDraftStateLog(log);

  return {
    // A window that closed during the replay spent a synthesis call; the compile view's call
    // list is where an author sees what a compile cost, so it belongs there rather than nowhere.
    compiled: {
      ...compiled,
      calls: [
        ...compiled.calls,
        ...rollupCalls.map(
          (call): CallRecord => ({
            ...call,
            purpose: 'digest_rollup',
            finish_reason: call.finish_reason as CallRecord['finish_reason'],
          }),
        ),
      ],
    },
    pass,
    validation,
    manifest: outcome.manifest,
    diff: outcome.diff,
    newly_stale: outcome.newly_stale,
    diagnostics: [...compiled.diagnostics, ...validation.diagnostics, ...pass.diagnostics],
  };
}

/** The digests of every draft scene before `order` — what a mid-draft compile replays through. */
async function draftDigests(
  repository: StoryRepository,
  pkg: StoryPackage,
  order: number,
): Promise<Map<string, SceneDigest>> {
  const digests = new Map<string, SceneDigest>();
  for (const card of scenesInOrder(pkg)) {
    if (card.order >= order) break;
    const stored = await repository.getDraftScene(pkg.story_id, card.order);
    if (stored !== null) digests.set(card.id, stored.digest);
  }
  return digests;
}
