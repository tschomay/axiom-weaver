/**
 * Entry/exit state chaining, and its Fabula-layer counterpart.
 *
 * `docs/agents/story-authoring-eval.md` §4.1 asks for a check that "for every consecutive scene
 * pair in `order`, the later scene's `entry_state` must not contradict the earlier's `exit_state`
 * on any column both name", calls it the authoring-time analogue of the amnesia guard (ADR 0005),
 * and says whoever builds the generation prototype "should add this check next to the linter
 * rather than inside their own script".
 *
 * It lives here instead, and that is a deliberate, flagged compromise rather than an oversight:
 * issue #119's boundaries say not to touch `src/authoring`. `stateChainingProblems` below is
 * written as a pure function over a parsed `StoryPackage`, returning the linter's own
 * `{severity, code, path, message}` shape, so lifting it into `src/authoring/lint.ts` is a move
 * and an import — no rewrite. Whether it should be lifted (and at what severity: the rubric wants
 * it a gate for generated arcs and a warning for extracted ones, which is a *provenance*-dependent
 * severity the linter has no notion of today) is called out in the ticket report as a real
 * decision, not settled here.
 *
 * **The honesty note that matters.** Over a Fabula-only arc the literal check is *vacuous*: the
 * projection's `entry_state` is `{}` on every scene, because a Fabula event list has no
 * entry-state field to contradict anything with. Reporting "0 chaining violations" from that and
 * calling the gate passed would be measuring nothing. So this module also carries
 * `presenceProblems`, which is the same idea with something to bite on — replay the seed forward
 * through the events' own `state_changes` and check each event's assertions against the running
 * World Model. That is the check a generated arc can actually fail, and it is the one whose number
 * is worth reading.
 */

import {
  entityAssertions,
  scenesInOrder,
  type StoryPackage,
} from '../schema/story-package';
import { eventsInOrder, type FabulaArc } from './fabula';

export interface ChainingProblem {
  readonly severity: 'error' | 'warn';
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/**
 * Consecutive-pair chaining over a package's `entry_state` / `exit_state` blocks.
 *
 * Only columns *both* sides name are compared: a later scene that says nothing about a column has
 * not contradicted anything, and demanding it restate the world would be the opposite of what the
 * schema is for.
 */
export function stateChainingProblems(pkg: StoryPackage): ChainingProblem[] {
  const scenes = scenesInOrder(pkg);
  const problems: ChainingProblem[] = [];

  for (let index = 1; index < scenes.length; index += 1) {
    const earlier = scenes[index - 1];
    const later = scenes[index];
    if (earlier === undefined || later === undefined) continue;

    const exitByEntity = new Map(entityAssertions(earlier.exit_state));
    for (const [entityId, entryColumns] of entityAssertions(later.entry_state)) {
      const exitColumns = exitByEntity.get(entityId);
      if (exitColumns === undefined) continue;
      for (const [column, entryValue] of Object.entries(entryColumns)) {
        if (!Object.prototype.hasOwnProperty.call(exitColumns, column)) continue;
        const exitValue = exitColumns[column];
        if (exitValue === entryValue) continue;
        problems.push({
          severity: 'error',
          code: 'entry_state_contradicts_exit',
          path: `scene_cards.${later.id}.entry_state.${entityId}.${column}`,
          message:
            `asserts ${JSON.stringify(entryValue)} where "${earlier.id}" left it ` +
            `${JSON.stringify(exitValue)}`,
        });
      }
    }
  }

  return problems;
}

/** How many consecutive pairs had any column to compare at all — 0 means the check was vacuous. */
export function chainingCoverage(pkg: StoryPackage): { pairs: number; compared: number } {
  const scenes = scenesInOrder(pkg);
  let compared = 0;
  for (let index = 1; index < scenes.length; index += 1) {
    const earlier = scenes[index - 1];
    const later = scenes[index];
    if (earlier === undefined || later === undefined) continue;
    const exitByEntity = new Map(entityAssertions(earlier.exit_state));
    const overlaps = entityAssertions(later.entry_state).some(([entityId, columns]) => {
      const exitColumns = exitByEntity.get(entityId);
      return (
        exitColumns !== undefined &&
        Object.keys(columns).some((column) =>
          Object.prototype.hasOwnProperty.call(exitColumns, column),
        )
      );
    });
    if (overlaps) compared += 1;
  }
  return { pairs: Math.max(0, scenes.length - 1), compared };
}

export interface PresenceProblem {
  readonly code: 'character_teleported' | 'absent_pov' | 'state_change_for_absentee';
  readonly event_id: string;
  readonly message: string;
}

/**
 * Replay the seed forward through the events and check each event against the running state.
 *
 * The Fabula-layer amnesia guard. Three things it catches, all of which a generated arc produces
 * and none of which `lintPackage` can see:
 *
 * - **`character_teleported`** — an event places a character somewhere the running World Model
 *   says they are not, and does not itself move them there. Being *silent* about a character's
 *   location is fine; asserting a contradiction is not.
 * - **`absent_pov`** — the POV character is not in `characters_present`. (The cross-reference pass
 *   catches this too; kept because the replay reports it against the event, in context.)
 * - **`state_change_for_absentee`** — an event changes a character's state while that character is
 *   not in the scene. Sometimes legitimate off-stage bookkeeping, so it is a warning-shaped
 *   finding, reported and not gated.
 */
export function presenceProblems(arc: FabulaArc): PresenceProblem[] {
  const location = new Map<string, string | null>();
  for (const character of arc.world_model_seed.characters) {
    location.set(character.id, character.location_id);
  }
  for (const object of arc.world_model_seed.objects) {
    location.set(object.id, object.location_id);
  }

  const problems: PresenceProblem[] = [];

  for (const event of eventsInOrder(arc)) {
    const movedHere = new Set(
      event.state_changes
        .filter((change) => change.column === 'location_id' && change.value === event.location_id)
        .map((change) => change.entity_id),
    );

    if (!event.characters_present.includes(event.pov)) {
      problems.push({
        code: 'absent_pov',
        event_id: event.id,
        message: `POV "${event.pov}" is not listed in characters_present`,
      });
    }

    for (const id of event.characters_present) {
      const at = location.get(id);
      if (at === undefined || at === null) continue;
      if (at === event.location_id || movedHere.has(id)) continue;
      problems.push({
        code: 'character_teleported',
        event_id: event.id,
        message: `"${id}" is present at "${event.location_id}" but was last at "${at}", and this event does not move them`,
      });
    }

    const present = new Set(event.characters_present);
    for (const change of event.state_changes) {
      if (location.has(change.entity_id) && !present.has(change.entity_id)) {
        const isObject = arc.world_model_seed.objects.some((row) => row.id === change.entity_id);
        if (!isObject) {
          problems.push({
            code: 'state_change_for_absentee',
            event_id: event.id,
            message: `changes ${change.column} of "${change.entity_id}", who is not present`,
          });
        }
      }
      if (change.column === 'location_id') location.set(change.entity_id, change.value);
    }

    // Everyone on stage is now here, including anyone just reported as teleported. Accepting the
    // arc's implicit assertion is what keeps one misplacement from being re-reported at every
    // subsequent event — the defect is where it happened, not everywhere downstream of it.
    for (const id of event.characters_present) location.set(id, event.location_id);
  }

  return problems;
}
