/**
 * Cross-referencing a Story Package against its own World Model.
 *
 * Split out of `./load` so it can be reached without reaching `node:fs` with it. The pass is
 * pure — a package and a model in, a list of problems out — while the loader around it reads
 * files, and `src/authoring/lint.ts` composes this into the linter every authoring surface uses,
 * including the ones that run in a browser.
 *
 * `fixtures/authoring-notes.md` closes on the finding that "schema-conformance checking
 * absolutely should be tooling, not author discipline" — a human-authored package without a
 * validation pass ships silent plant dead-ends and undeclared entity references. This is that
 * pass for everything the schema can see.
 */

import {
  entityAssertions,
  newCharacterKnowledge,
  newRelationships,
  scenesInOrder,
  type SceneCard,
  type StoryPackage,
} from '../schema/story-package';
import { columnAuthority } from '../schema/tiers';
import { WorldModel } from '../world-model/world-model';

export interface LoadedStory {
  readonly pkg: StoryPackage;
  /** The seed World Model — the state as of scene 0. */
  readonly worldModel: WorldModel;
  readonly scenes: SceneCard[];
  /** Cross-reference problems found; empty means the package loads clean. */
  readonly problems: string[];
}

export interface CrossReferenceProblem {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/**
 * Cross-reference every Scene Card against the World Model seed.
 *
 * Checked here: `pov`, `location_id`, `characters_present`, every entity and column named in
 * `entry_state`/`exit_state`, the reserved `_new_*` rows' endpoints, and `pays_off[].plant`
 * pointing at a real earlier scene. Not checked here: the plant-obligation walk itself
 * (ADR 0004) and the told-ledger's `fact_ref` identity scheme (ADR 0003) — neither is this
 * ticket's schema. `src/authoring/lint.ts` composes this with both of those.
 */
export function sceneCardCrossReferences(
  pkg: StoryPackage,
  model: WorldModel,
): CrossReferenceProblem[] {
  const problems: CrossReferenceProblem[] = [];
  const scenes = scenesInOrder(pkg);
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const orderById = new Map(scenes.map((scene) => [scene.id, scene.order]));
  const seenOrders = new Set<number>();

  for (const scene of scenes) {
    const where = `scene_card.${scene.id}`;
    const add = (code: string, path: string, message: string) =>
      problems.push({ code, path, message });

    if (seenOrders.has(scene.order)) {
      add(
        'duplicate_order',
        `${where}.order`,
        `${scene.order} is used by more than one Scene Card`,
      );
    }
    seenOrders.add(scene.order);

    const requireEntity = (id: string, field: string, table?: string) => {
      const found = model.tableOf(id);
      if (found === null) {
        add('unknown_entity', `${where}.${field}`, `references unknown entity "${id}"`);
      } else if (table !== undefined && found !== table) {
        add('wrong_entity_table', `${where}.${field}`, `references "${id}", a ${found}, not a ${table}`);
      }
    };

    requireEntity(scene.pov, 'pov', 'character');
    requireEntity(scene.location_id, 'location_id', 'location');
    for (const id of scene.characters_present) {
      requireEntity(id, 'characters_present', 'character');
    }
    if (!scene.characters_present.includes(scene.pov)) {
      add(
        'pov_absent',
        `${where}.pov`,
        `"${scene.pov}" is not listed in characters_present`,
      );
    }

    for (const [field, state] of [
      ['entry_state', scene.entry_state],
      ['exit_state', scene.exit_state],
    ] as const) {
      for (const [entityId, columns] of entityAssertions(state)) {
        const table = model.tableOf(entityId);
        if (table === null) {
          add('unknown_entity', `${where}.${field}`, `references unknown entity "${entityId}"`);
          continue;
        }
        for (const column of Object.keys(columns)) {
          if (!columnAuthority(table, column).known) {
            add(
              'unknown_column',
              `${where}.${field}.${entityId}`,
              `names "${column}", not a ${table} column`,
            );
          }
        }
      }

      for (const row of newRelationships(state)) {
        for (const endpoint of [row.from_id, row.to_id] as const) {
          if (!model.has(endpoint)) {
            add(
              'unknown_entity',
              `${where}.${field}._new_relationships[${row.id}]`,
              `references unknown entity "${endpoint}"`,
            );
          }
        }
      }
      for (const row of newCharacterKnowledge(state)) {
        if (model.tableOf(row.character_id) !== 'character') {
          add(
            'unknown_entity',
            `${where}.${field}._new_character_knowledge[${row.id}]`,
            `references unknown character "${row.character_id}"`,
          );
        }
      }
    }

    for (const payoff of scene.pays_off) {
      if (payoff.plant === null) continue;
      const path = `${where}.pays_off["${payoff.fact_ref}"]`;
      if (!sceneIds.has(payoff.plant)) {
        add('plant_scene_unknown', path, `plants at unknown scene "${payoff.plant}"`);
        continue;
      }
      const plantOrder = orderById.get(payoff.plant) ?? 0;
      if (plantOrder >= scene.order) {
        add(
          'plant_after_payoff',
          path,
          `plants at "${payoff.plant}" (order ${plantOrder}), which is not earlier than this ` +
            `scene (order ${scene.order})`,
        );
      }
    }
  }

  return problems;
}

/** The same cross-reference pass, rendered flat — what the fixture loader has always printed. */
export function sceneCardProblems(pkg: StoryPackage, model: WorldModel): string[] {
  return sceneCardCrossReferences(pkg, model).map(
    (problem) => `${problem.path} ${problem.message}`,
  );
}

/** Parse a package into a World Model and cross-check its Scene Cards. */
export function loadStory(pkg: StoryPackage): LoadedStory {
  // Unchecked on purpose: `problems` below already reports unresolved seed references, and
  // `fromSeed`'s assertion would throw before this function could collect a single one of them.
  const worldModel = WorldModel.fromSeedUnchecked(pkg.story_id, pkg.world_model_seed);
  return {
    pkg,
    worldModel,
    scenes: scenesInOrder(pkg),
    problems: [...worldModel.referenceProblems(), ...sceneCardProblems(pkg, worldModel)],
  };
}
