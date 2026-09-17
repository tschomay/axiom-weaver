/**
 * `entry_state` and `exit_state`, replayed rather than guessed.
 *
 * A Fabula event carries `state_changes`: per-entity, per-column assertions about what this event
 * makes true. A Scene Card carries two blocks instead — what holds entering the scene, and what
 * holds leaving it. Getting from one to the other is a replay, and it is the one part of
 * segmentation with no judgment in it at all:
 *
 * - **`exit_state`** is the merge of every `state_change` the scene's events make, last write
 *   wins. That is what the scene asserts about the world on its way out.
 * - **`entry_state`** is, for exactly the columns `exit_state` names, the value that held *before*
 *   the scene ran — read off a running projection that starts at the World Model seed and is
 *   advanced scene by scene.
 *
 * Restricting `entry_state` to columns the scene also exits is deliberate and matches what
 * `src/authoring/lint.ts` can actually check: `stateChaining` compares consecutive scenes on the
 * columns *both* name, because a column only one side asserts depends on the seed or on a scene
 * further back and is not statically decidable. Asserting more than that would be writing rows
 * nothing verifies.
 *
 * ## The consequence worth stating out loud
 *
 * Because `entry_state` is *derived from* the same replay that produces `exit_state`, the linter's
 * `entry_exit_contradiction` check **cannot fire** on a package this module builds. It is
 * satisfied by construction, not by the segmentation getting anything right. Rubric §4.1 lists
 * entry/exit chaining as "already satisfied" for generated arcs on the strength of that check, so
 * anyone reading a G0 pass on a derived package should discount it accordingly — and
 * `SegmentationReport` says so in the result rather than leaving it to be noticed.
 *
 * What the replay *does* catch is a state change naming an entity the World Model seed has never
 * heard of. Those would be `unknown_entity` lint errors, they come from the upstream entry point
 * rather than from segmentation, and they are dropped and counted here instead of being laundered
 * into a Scene Card.
 */

import type { FabulaEvent } from '../schema/fabula';
import type { SceneState, WorldModelSeed } from '../schema/story-package';
import { columnAuthority, type TableName } from '../schema/tiers';

type Columns = Map<string, string | null>;

export interface SceneStates {
  readonly entry_state: SceneState;
  readonly exit_state: SceneState;
}

export interface StateReplayResult {
  readonly states: readonly SceneStates[];
  /** State changes dropped because no seed row carries the entity. */
  readonly dropped_unknown_entity: number;
  readonly dropped_entity_ids: readonly string[];
  /**
   * State changes dropped because the column is not one that table has.
   *
   * `goal` is the live case: a `character` column (V-tier), not an `object` one, and a Fabula
   * event list is free to assert it against either. The cross-reference pass would report
   * `unknown_column` and block the publish, so the assertion is dropped here and counted rather
   * than written into a card.
   */
  readonly dropped_unknown_column: number;
}

/** The seed's own assertions, as the replay's starting point. */
function seedState(seed: WorldModelSeed): Map<string, { table: TableName; columns: Columns }> {
  const state = new Map<string, { table: TableName; columns: Columns }>();
  for (const character of seed.characters) {
    state.set(character.id, {
      table: 'character',
      columns: new Map<string, string | null>([
        ['location_id', character.location_id],
        ['status', character.status],
        ['goal', character.goal],
      ]),
    });
  }
  for (const object of seed.objects) {
    state.set(object.id, {
      table: 'object',
      columns: new Map<string, string | null>([
        ['location_id', object.location_id],
        ['status', object.status],
      ]),
    });
  }
  for (const location of seed.locations) {
    state.set(location.id, { table: 'location', columns: new Map() });
  }
  return state;
}

function toSceneState(rows: Map<string, Columns>): SceneState {
  const out: Record<string, Record<string, string | null>> = {};
  for (const [entityId, columns] of rows) {
    if (columns.size === 0) continue;
    out[entityId] = Object.fromEntries(columns);
  }
  return out as SceneState;
}

/**
 * Replay the scenes' events over the seed, producing one `{entry_state, exit_state}` per scene.
 *
 * `scenes` is the event list already grouped — array of arrays, in scene order.
 */
export function replayStates(
  seed: WorldModelSeed,
  scenes: ReadonlyArray<readonly FabulaEvent[]>,
): StateReplayResult {
  const current = seedState(seed);
  const states: SceneStates[] = [];
  const droppedIds = new Set<string>();
  let dropped = 0;
  let droppedColumn = 0;

  for (const events of scenes) {
    const exit = new Map<string, Columns>();

    for (const event of events) {
      for (const change of event.state_changes) {
        const row = current.get(change.entity_id);
        if (row === undefined) {
          dropped += 1;
          droppedIds.add(change.entity_id);
          continue;
        }
        if (!columnAuthority(row.table, change.column).known) {
          droppedColumn += 1;
          continue;
        }
        const columns = exit.get(change.entity_id) ?? new Map<string, string | null>();
        columns.set(change.column, change.value);
        exit.set(change.entity_id, columns);
      }
    }

    const entry = new Map<string, Columns>();
    for (const [entityId, columns] of exit) {
      const known = current.get(entityId);
      if (known === undefined) continue;
      const row = new Map<string, string | null>();
      for (const column of columns.keys()) {
        if (known.columns.has(column)) row.set(column, known.columns.get(column) ?? null);
      }
      if (row.size > 0) entry.set(entityId, row);
    }

    states.push({ entry_state: toSceneState(entry), exit_state: toSceneState(exit) });

    for (const [entityId, columns] of exit) {
      const row = current.get(entityId);
      if (row === undefined) continue;
      for (const [column, value] of columns) row.columns.set(column, value);
    }
  }

  return {
    states,
    dropped_unknown_entity: dropped,
    dropped_entity_ids: [...droppedIds],
    dropped_unknown_column: droppedColumn,
  };
}
