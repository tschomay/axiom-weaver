/**
 * The state a telling carries forward from scene to scene.
 *
 * The run loop itself is ticket 3's (ADR 0014); this is the state that loop will drive — the
 * World Model and its commit log (ticket 1), plus the three things the writer call needs that
 * only exist once scenes have actually been generated: the digest hierarchy, the told-ledger, and
 * the imagery history.
 *
 * Kept deliberately separate from `compileScene`, which compiles exactly one scene and mutates
 * nothing: advancing state is a decision about what to *commit*, and the validator owns that.
 */

import type { SceneCard, StoryPackage } from '../schema/story-package';
import { scenesInOrder } from '../schema/story-package';
import { WorldModel } from '../world-model/world-model';
import { StateLog } from '../world-model/state-log';
import { stateToUpdates, type StateUpdate } from '../schema/state-update';
import {
  columnUpdate,
  characterKnowledgeInsert,
  relationshipInsert,
} from '../schema/state-update';
import {
  commitValidated,
  validateStateUpdates,
  type Occasion,
  type ValidationResult,
} from '../validator/state-update-authority';
import { DigestHierarchy, type Summarizer } from '../digest/hierarchy';
import { joinSceneRows, presentEntityIds } from '../assembler/join';
import { ToldLedger, metFact } from '../digest/told-ledger';
import type { SceneDigest } from '../digest/scene-digest';
import type { RecordedImagery } from '../voice/imagery-ledger';
import type { WriterStateUpdates } from './response-schema';
import { finalParagraph } from './salvage';

export class RunState {
  readonly pkg: StoryPackage;
  readonly model: WorldModel;
  readonly log: StateLog;
  readonly hierarchy: DigestHierarchy;
  readonly ledger: ToldLedger;
  readonly imageryHistory: RecordedImagery[] = [];
  previousParagraph: string | null = null;

  constructor(
    pkg: StoryPackage,
    options: { window?: number; summarize?: Summarizer; runId?: string } = {},
  ) {
    this.pkg = pkg;
    this.model = WorldModel.fromSeed(pkg.story_id, pkg.world_model_seed);
    // A read-time run's log is persisted as `edition/{runId}/state-log.json` and carries the run
    // it belongs to; the Working Draft's carries none (ADR 0016 §2).
    this.log = new StateLog(pkg.story_id, options.runId ?? null);
    this.hierarchy = new DigestHierarchy(options.window, options.summarize);
    this.ledger = ToldLedger.forPackage(pkg);
  }

  /**
   * Fold a generated scene into the run.
   *
   * Order matters: the digest updates the told-ledger and imagery history *before* it is pushed
   * onto the hierarchy, because a rollup clears the band it consumed and the ledger needs to have
   * seen every scene individually.
   *
   * `met:` facts are touched from the digest's `entities_on_stage` **and** the deterministic join
   * (ADR 0008 §4) — the same join that built the prompt's re-anchoring list and filtered World
   * Model rows. Trusting the self-report alone meant one omitted array entry silently reset a
   * character or a location for the rest of the telling: the reader's memory of a place they had
   * not left went missing, the next scene computed `introduce`, and the continuity pass agreed
   * with it, because expectation and report were being read off the same empty row. The join is
   * already the authority on presence everywhere else in the compiler.
   */
  async advance(scene: SceneCard, digest: SceneDigest, prose: string | null): Promise<void> {
    this.ledger.applyDigest(digest, scene.order);
    for (const entityId of presentEntityIds(joinSceneRows(scene, this.model))) {
      this.ledger.touch(metFact(entityId), scene.order);
    }
    this.imageryHistory.push({
      scene_order: scene.order,
      signature: digest.imagery_signature,
    });
    await this.hierarchy.push(digest, scene.id, scene.order);
    if (prose !== null) this.previousParagraph = finalParagraph(prose);
  }

  /**
   * Validate and commit a writer's proposed state updates (ADR 0005, via ticket 1's validator).
   *
   * The writer proposes `{entity_id, column, value}` and never a tier; the table is resolved from
   * the World Model's own row index, so nothing has to guess a table from an id prefix.
   */
  commitWriterUpdates(
    scene: SceneCard,
    updates: WriterStateUpdates,
    occasion: Occasion,
  ): ValidationResult {
    const result = validateStateUpdates({
      scene,
      model: this.model,
      updates: this.toStateUpdates(scene, updates),
      occasion,
    });
    commitValidated(this.model, this.log, result);
    return result;
  }

  /**
   * Commit a Scene Card's authored `exit_state` directly.
   *
   * This is how earlier scenes are advanced when their prose is not being regenerated — replaying
   * a telling to reach scene N without paying for scenes 1..N-1. It goes through the same
   * validator, so a fixture whose own exit_state violates ADR 0005 is caught here rather than
   * quietly applied.
   */
  commitAuthoredExitState(scene: SceneCard, occasion: Occasion): ValidationResult {
    const result = validateStateUpdates({
      scene,
      model: this.model,
      updates: stateToUpdates(scene.exit_state, (id) => this.model.tableOf(id)),
      occasion,
    });
    commitValidated(this.model, this.log, result);
    return result;
  }

  private toStateUpdates(scene: SceneCard, updates: WriterStateUpdates): StateUpdate[] {
    const converted: StateUpdate[] = [];

    for (const update of updates.updates) {
      const table = this.model.tableOf(update.entity_id);
      if (table === null) continue; // an unknown row is caught by the validator's footprint rule
      converted.push(columnUpdate(table, update.entity_id, update.column, update.value));
    }

    updates.new_relationships.forEach((row, index) => {
      converted.push(
        relationshipInsert({
          id: `rel_${scene.id}_${index}`,
          from_id: row.from_id,
          to_id: row.to_id,
          kind: row.kind,
          sentiment: row.sentiment,
          bag: {},
        }),
      );
    });

    updates.new_character_knowledge.forEach((row, index) => {
      converted.push(
        characterKnowledgeInsert({
          id: `ck_${scene.id}_${index}`,
          character_id: row.character_id,
          fact_ref: row.fact_ref,
          learned_at_scene: scene.id,
          bag: {},
        }),
      );
    });

    return converted;
  }
}

/**
 * Replay a telling forward to just before a target scene, using recorded digests.
 *
 * This is what makes a mid-book scene compilable without regenerating everything before it: the
 * digests are what earlier scenes contributed to context, and the Scene Cards' authored
 * `exit_state` is what they contributed to the World Model. Both are already on record.
 */
export async function replayTo(
  pkg: StoryPackage,
  targetSceneId: string,
  priorDigests: ReadonlyMap<string, SceneDigest>,
  options: { window?: number; summarize?: Summarizer; occasion?: Occasion; runId?: string } = {},
): Promise<RunState> {
  const state = new RunState(pkg, options);
  const occasion = options.occasion ?? 'read_time';

  for (const scene of scenesInOrder(pkg)) {
    if (scene.id === targetSceneId) break;
    const digest = priorDigests.get(scene.id);
    if (digest === undefined) {
      throw new Error(`No recorded digest for "${scene.id}", needed to reach "${targetSceneId}"`);
    }
    state.commitAuthoredExitState(scene, occasion);
    await state.advance(scene, digest, null);
  }

  return state;
}
