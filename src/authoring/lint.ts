/**
 * The package linter.
 *
 * [ADR 0017](../../docs/adr/0017-the-manuscript-and-publishing.md) §4. One module answers "what
 * is wrong with this package", and every surface reads it: the authoring screen continuously, the
 * publish path as a gate, the fixture loader as it already does.
 *
 * It composes what already exists — `WorldModel.referenceProblems`, the Scene Card
 * cross-reference pass, and the plant-obligation walk's hard errors (ADR 0004) — rather than
 * inventing a second opinion about correctness. `fixtures/authoring-notes.md` closes on exactly
 * this: "schema-conformance checking absolutely should be tooling, not author discipline", and
 * issues #18 and #16 measured that the errors hand-authoring actually produces are
 * cross-reference errors, not prose ones.
 *
 * Two severities, and only one of them blocks. An `error` is a defect that would otherwise fail
 * at compile time, more expensively and further from the field that caused it. A `warn` is a
 * judgment about craft or completeness an author is allowed to disagree with, or to publish
 * mid-thought. There is deliberately no third severity: ADR 0016 §4 already cut `info` from live
 * display as the one real noise risk, and a severity nobody acts on trains an author to ignore
 * the two that matter.
 *
 * Severity is a property of the check, never of the instance — the same rule tiering follows
 * (ADR 0001, Principle 2).
 */

import { z } from 'zod';

import {
  StoryPackageSchema,
  entityAssertions,
  newCharacterKnowledge,
  newRelationships,
  scenesInOrder,
  type SceneCard,
  type StoryPackage,
} from '../schema/story-package';
import { sceneCardCrossReferences } from '../fixtures/load';
import { walkPlantObligations } from '../plants/obligation-walk';
import { STYLE_PRESETS, cardFromPreset } from '../voice/voice-card';
import { WorldModel } from '../world-model/world-model';

export type ProblemSeverity = 'error' | 'warn';

export interface PackageProblem {
  readonly severity: ProblemSeverity;
  /** A stable machine name for the check that fired. */
  readonly code: string;
  /**
   * The package field that owns the problem, e.g.
   * `scene_cards.scene_04_godmother.characters_present`.
   *
   * Array positions are rendered as the id at that position wherever one exists, because an
   * author navigates by scene id and never by index.
   */
  readonly path: string;
  readonly message: string;
}

export interface LintResult {
  readonly problems: PackageProblem[];
  readonly errors: PackageProblem[];
  readonly warnings: PackageProblem[];
  /** Whether publishing is allowed: no `error` stands. */
  readonly publishable: boolean;
}

/** Seed table name → the array that holds it in the envelope. */
const SEED_ARRAYS: Record<string, string> = {
  character: 'characters',
  location: 'locations',
  object: 'objects',
  relationship: 'relationships',
  character_knowledge: 'character_knowledge',
};

function result(problems: PackageProblem[]): LintResult {
  const errors = problems.filter((problem) => problem.severity === 'error');
  return {
    problems,
    errors,
    warnings: problems.filter((problem) => problem.severity === 'warn'),
    publishable: errors.length === 0,
  };
}

/**
 * Render a Zod issue path against the raw input, substituting ids for array indices.
 *
 * `scene_cards.3.pov` is a position in a document the author is not looking at;
 * `scene_cards.scene_04_godmother.pov` is a field they can find.
 */
function readablePath(input: unknown, path: ReadonlyArray<PropertyKey>): string {
  const segments: string[] = [];
  let cursor: unknown = input;

  for (const key of path) {
    if (typeof key === 'number' && Array.isArray(cursor)) {
      const element: unknown = cursor[key];
      const id =
        typeof element === 'object' && element !== null && 'id' in element
          ? (element as { id: unknown }).id
          : undefined;
      segments.push(typeof id === 'string' && id !== '' ? id : String(key));
      cursor = element;
      continue;
    }
    segments.push(String(key));
    cursor =
      typeof cursor === 'object' && cursor !== null
        ? (cursor as Record<string, unknown>)[String(key)]
        : undefined;
  }

  return segments.join('.');
}

/**
 * Split a `WorldModel.referenceProblems` string into its path and its message.
 *
 * Those strings are built as `${where} references …` with `where` a dotted
 * `table.rowId.column`, so the first space is the boundary. Re-pointed at the envelope's own
 * array names so the path names a field the editor actually renders.
 */
function seedProblem(raw: string): PackageProblem {
  const boundary = raw.indexOf(' ');
  const where = boundary === -1 ? raw : raw.slice(0, boundary);
  const message = boundary === -1 ? '' : raw.slice(boundary + 1);
  const [table, ...rest] = where.split('.');
  const array = SEED_ARRAYS[table ?? ''] ?? table ?? '';
  return {
    severity: 'error',
    code: 'unknown_entity',
    path: ['world_model_seed', array, ...rest].filter((part) => part !== '').join('.'),
    message,
  };
}

/** Every entity id any Scene Card names, in any field. */
function entitiesUsedByScenes(scenes: readonly SceneCard[]): Set<string> {
  const used = new Set<string>();
  for (const scene of scenes) {
    used.add(scene.pov);
    used.add(scene.location_id);
    for (const id of scene.characters_present) used.add(id);
    for (const state of [scene.entry_state, scene.exit_state]) {
      for (const [entityId] of entityAssertions(state)) used.add(entityId);
      for (const row of newRelationships(state)) {
        used.add(row.from_id);
        used.add(row.to_id);
      }
      for (const row of newCharacterKnowledge(state)) used.add(row.character_id);
    }
  }
  return used;
}

/**
 * Whether the Voice Card is still exactly one of the five presets.
 *
 * ADR 0007 materializes an override fully onto the card rather than storing a diff, so "equals a
 * preset" is a real signal that the author never opened it, not an artifact of how overrides are
 * stored.
 */
function isUntouchedPreset(voiceCard: Record<string, unknown>): boolean {
  const serialized = JSON.stringify(voiceCard, Object.keys(voiceCard).sort());
  return STYLE_PRESETS.some((preset) => {
    const card = cardFromPreset(preset.id) as unknown as Record<string, unknown>;
    return JSON.stringify(card, Object.keys(card).sort()) === serialized;
  });
}

/** The craft-and-completeness half: never blocks a publish. */
function warnings(pkg: StoryPackage, model: WorldModel): PackageProblem[] {
  const problems: PackageProblem[] = [];
  const scenes = scenesInOrder(pkg);

  for (const scene of scenes) {
    if (scene.required_beats.length === 0) {
      problems.push({
        severity: 'warn',
        code: 'no_required_beats',
        path: `scene_cards.${scene.id}.required_beats`,
        message:
          'declares no required beats, so the variance contract leaves this whole scene free to vary',
      });
    }
  }

  // Only worth saying where the author has established a habit to break: a package that budgets
  // no scene at all has made a choice, not an omission.
  const budgeted = scenes.filter((scene) => scene.length_budget !== undefined).length;
  if (budgeted > 0 && budgeted < scenes.length) {
    for (const scene of scenes) {
      if (scene.length_budget === undefined) {
        problems.push({
          severity: 'warn',
          code: 'no_length_budget',
          path: `scene_cards.${scene.id}.length_budget`,
          message: `has no length budget while ${budgeted} of ${scenes.length} scenes do`,
        });
      }
    }
  }

  const used = entitiesUsedByScenes(scenes);
  for (const table of ['character', 'location', 'object'] as const) {
    for (const row of model.rows(table)) {
      if (!used.has(row.id)) {
        problems.push({
          severity: 'warn',
          code: 'unused_seed_entity',
          path: `world_model_seed.${SEED_ARRAYS[table]}.${row.id}`,
          message: 'is in the seed but no Scene Card ever names it',
        });
      }
    }
  }

  const paidOff = new Set(
    scenes.flatMap((scene) => scene.pays_off.map((payoff) => payoff.fact_ref)),
  );
  for (const scene of scenes) {
    for (const fact of scene.reader_must_learn) {
      if (!paidOff.has(fact)) {
        problems.push({
          severity: 'warn',
          code: 'unpaid_fact',
          path: `scene_cards.${scene.id}.reader_must_learn`,
          message: `"${fact}" is shown to the reader but no scene pays it off`,
        });
      }
    }
  }

  if (isUntouchedPreset(pkg.voice_card)) {
    problems.push({
      severity: 'warn',
      code: 'voice_card_untouched',
      path: 'voice_card',
      message: 'is still exactly a style preset — nothing on it is specific to this story',
    });
  }

  return problems;
}

/**
 * Lint a package that has not been parsed yet — the authoring screen's and the import path's
 * entry point.
 *
 * A shape violation stops the pass: reference checks over a package whose shape is unknown would
 * report noise about fields that are not there yet, and the author's next move is the same either
 * way — fix the shape.
 */
export function lintPackage(input: unknown): LintResult {
  const parsed = StoryPackageSchema.safeParse(input);
  if (!parsed.success) {
    return result(
      parsed.error.issues.map((issue: z.core.$ZodIssue) => ({
        severity: 'error' as const,
        code: `schema.${issue.code}`,
        path: readablePath(input, issue.path),
        message: issue.message,
      })),
    );
  }
  return lintStoryPackage(parsed.data);
}

/** Lint an already-parsed package: the cross-reference, plant-walk and craft passes. */
export function lintStoryPackage(pkg: StoryPackage): LintResult {
  // Unchecked: reporting a broken seed reference is this module's job, and `fromSeed` would
  // throw before a single problem could be collected.
  const model = WorldModel.fromSeedUnchecked(pkg.story_id, pkg.world_model_seed);
  const problems: PackageProblem[] = [
    ...model.referenceProblems().map(seedProblem),
    ...sceneCardCrossReferences(pkg, model).map((problem) => ({
      severity: 'error' as const,
      code: problem.code,
      // `scene_card.X.field` is the cross-reference pass's own idiom; the envelope's array is
      // `scene_cards`, and the path has to name the field as the document holds it.
      path: problem.path.replace(/^scene_card\./, 'scene_cards.'),
      message: problem.message,
    })),
    ...walkPlantObligations(pkg).errors.map((error) => ({
      severity: 'error' as const,
      code: error.code,
      path: `scene_cards.${error.payoff_scene_id}.pays_off["${error.fact_ref}"]`,
      message: error.message,
    })),
    ...warnings(pkg, model),
  ];
  return result(problems);
}
