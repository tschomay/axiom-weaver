/**
 * Loading a Story Package end to end: parse → World Model → cross-reference check → persist.
 *
 * `fixtures/authoring-notes.md` closes on the finding that "schema-conformance checking
 * absolutely should be tooling, not author discipline" — a human-authored package without a
 * validation pass ships silent plant dead-ends and undeclared entity references. The
 * cross-reference checks below are that pass for everything this ticket's schema can see.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  entityAssertions,
  newCharacterKnowledge,
  newRelationships,
  parseStoryPackage,
  scenesInOrder,
  type SceneCard,
  type StoryPackage,
} from '../schema/story-package';
import { columnAuthority } from '../schema/tiers';
import { WorldModel } from '../world-model/world-model';
import type { StoryRepository } from '../persistence/story-repository';

export const FIXTURE_STORY_IDS = [
  'cinderella',
  'a-christmas-carol',
  // Three original short packages (3-5 scenes). The two public-domain fixtures are the scale
  // test; these are the iteration loop — short enough that a whole live telling costs a handful
  // of writer requests rather than a day's allowance (AGENTS.md, The Gemini API key).
  'the-amber-cat',
  'the-dragon-of-thistlewick',
  'the-lamp-at-cairn-head',
] as const;
export type FixtureStoryId = (typeof FIXTURE_STORY_IDS)[number];

export function fixturePath(fixture: string, root = process.cwd()): string {
  return join(root, 'fixtures', fixture, 'package.json');
}

/** Read and parse a fixture Story Package. Throws a `ZodError` on a schema mismatch. */
export async function readFixturePackage(
  fixture: string,
  root = process.cwd(),
): Promise<StoryPackage> {
  const body = await readFile(fixturePath(fixture, root), 'utf8');
  return parseStoryPackage(JSON.parse(body));
}

export interface LoadedStory {
  readonly pkg: StoryPackage;
  /** The seed World Model — the state as of scene 0. */
  readonly worldModel: WorldModel;
  readonly scenes: SceneCard[];
  /** Cross-reference problems found; empty means the package loads clean. */
  readonly problems: string[];
}

/**
 * One cross-reference problem, located at the package field that owns it.
 *
 * The `path` is the load-bearing half — ADR 0017 §4 makes it what lets the authoring screen put
 * the author on the offending field, and a problem an author cannot navigate to is a problem they
 * will not fix. `sceneCardProblems` below renders the same data as the flat strings the fixture
 * loader has always printed.
 */
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

export async function loadFixtureStory(
  fixture: string,
  root = process.cwd(),
): Promise<LoadedStory> {
  return loadStory(await readFixturePackage(fixture, root));
}

/** Load a fixture and retain its `package_version` snapshot in the repository. */
export async function loadFixtureIntoRepository(
  fixture: string,
  repository: StoryRepository,
  root = process.cwd(),
): Promise<LoadedStory> {
  const loaded = await loadFixtureStory(fixture, root);
  if (loaded.problems.length > 0) {
    throw new Error(
      `Fixture "${fixture}" does not cross-reference cleanly:\n  ${loaded.problems.join('\n  ')}`,
    );
  }
  await repository.putPackage(loaded.pkg);
  return loaded;
}
