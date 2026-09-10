/**
 * Resolving a volitional proposal at author-time (ADR 0016 §3).
 *
 * ADR 0005 §3's apply-or-drop rule is framed around read-time, where there is no author to ask.
 * Author-time is the silence ADR 0016 fills: a proposal is never auto-applied or auto-dropped —
 * it sits in the proposals queue as `proposed` until the author says. Accept commits the log
 * entry as `proposed_applied`, reject as `proposed_dropped`; the entry is never deleted, because
 * the ledger's job is to keep what was decided.
 *
 * There is no second store and no separate "apply" step. The World Model an author sees is the
 * seed replayed forward through the log (ADR 0016 §2), so flipping the status *is* the state
 * change — which is why this returns the before/after value: the surface that offered the choice
 * can show the author what their accept just did.
 */

import { ROW_COLUMN } from '../schema/tiers';
import { worldModelAsOf, type StateLog, type StateLogEntry } from '../world-model/state-log';
import type { WorldModel } from '../world-model/world-model';
import type { StoryRepository } from '../persistence/story-repository';

export type ProposalDecision = 'accept' | 'reject';

export interface FieldChange {
  readonly previous_value: unknown;
  readonly new_value: unknown;
}

export interface ProposalResolution {
  readonly entry: StateLogEntry;
  /** True when the decision committed the entry as `proposed_applied`. */
  readonly applied: boolean;
  /**
   * The field as of the proposal's own scene, before and after the decision — where an accept
   * actually lands, since the entry replays at its own `scene_index`.
   */
  readonly at_scene: FieldChange & { readonly scene_index: number };
  /** The field as of the whole draft: the same replay run to the end of the log. */
  readonly current: FieldChange;
  /**
   * True when the accept did land at its own scene but a later scene has since written the same
   * field, so the current value is unchanged. Not a failure — replay order is the whole point of
   * an append-only log — but the author asked what their accept did, and "nothing you can see
   * from here" is the honest answer to give them at the head of the log.
   */
  readonly superseded: boolean;
}

export class NoSuchStoryError extends Error {
  constructor(storyId: string) {
    super(`No package retained for "${storyId}"`);
    this.name = 'NoSuchStoryError';
  }
}

/**
 * Accept or reject one pending proposal in a story's Working Draft.
 *
 * Throws when the sequence names no entry, or names one that is not still pending — resolving a
 * proposal twice is a mistake worth hearing about, not an idempotent no-op, because the second
 * caller believed they were deciding something.
 */
export async function resolveDraftProposal(input: {
  repository: StoryRepository;
  storyId: string;
  sequence: number;
  decision: ProposalDecision;
}): Promise<ProposalResolution> {
  const { repository, storyId, sequence, decision } = input;

  const seed = await repository.getSeedWorldModel(storyId);
  if (seed === null) throw new NoSuchStoryError(storyId);

  const log = await repository.getDraftStateLog(storyId);
  const pending = log
    .all()
    .find((candidate) => candidate.sequence === sequence && candidate.status === 'proposed');
  const sceneIndex = pending?.scene_index ?? Number.POSITIVE_INFINITY;

  const wasAtScene = fieldValue(seed, log, sequence, sceneIndex);
  const wasCurrent = fieldValue(seed, log, sequence, Number.POSITIVE_INFINITY);

  // `resolveProposal` is the one in-place transition the ledger allows, and it throws on an entry
  // that is missing or already resolved — so the log is only written back once it has agreed.
  const entry = log.resolveProposal(sequence, decision);
  await repository.putDraftStateLog(log);

  const isAtScene = fieldValue(seed, log, sequence, sceneIndex);
  const isCurrent = fieldValue(seed, log, sequence, Number.POSITIVE_INFINITY);
  const applied = entry.status === 'proposed_applied';

  return {
    entry,
    applied,
    at_scene: {
      scene_index: entry.scene_index,
      previous_value: wasAtScene,
      new_value: isAtScene,
    },
    current: { previous_value: wasCurrent, new_value: isCurrent },
    superseded:
      applied && !Object.is(wasAtScene, isAtScene) && Object.is(wasCurrent, isCurrent),
  };
}

/**
 * The value the World Model holds for an entry's field, as of some scene.
 *
 * A row-insert entry (`column === '_row'`) is about the row's own existence, so the value it has
 * to report is the row rather than a column of it.
 */
function fieldValue(
  seed: WorldModel,
  log: StateLog,
  sequence: number,
  sceneIndex: number,
): unknown {
  const entry = log.all().find((candidate) => candidate.sequence === sequence);
  if (entry === undefined) return undefined;
  const model = worldModelAsOf(seed, log, sceneIndex);
  if (entry.column === ROW_COLUMN) return model.row(entry.entity_id);
  return model.value(entry.entity_id, entry.column);
}
