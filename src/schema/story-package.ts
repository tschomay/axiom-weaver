/**
 * The Story Package envelope, the World Model tables, and the Scene Card.
 *
 * Shapes are `docs/schema/story-package.md`; the governing principles behind the column choices
 * are ADR 0001. Tiering lives in `./tiers.ts` — this module is shape only.
 */

import { z } from 'zod';

/** Principle 4: bag values are flat scalars only — no nested objects. */
export const BagValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
]);

export const BagSchema = z.record(z.string(), BagValueSchema).default({});

const slug = z.string().min(1);

// --- World Model tables ------------------------------------------------------------------
//
// `story_id` is optional on the wire: inside a Story Package every row belongs to the
// envelope's story, and the fixtures leave it off. The World Model fills it in on load, which
// is where it becomes "part of the composite key in a real multi-tenant table".

export const CharacterSchema = z.object({
  id: slug,
  story_id: z.string().optional(),
  name: z.string().min(1),
  location_id: slug.nullable().default(null),
  status: z.string().nullable().default(null),
  goal: z.string().nullable().default(null),
  bag: BagSchema,
});

export const LocationSchema = z.object({
  id: slug,
  story_id: z.string().optional(),
  name: z.string().min(1),
  bag: BagSchema,
});

export const StoryObjectSchema = z.object({
  id: slug,
  story_id: z.string().optional(),
  name: z.string().min(1),
  location_id: slug.nullable().default(null),
  status: z.string().nullable().default(null),
  bag: BagSchema,
});

export const RelationshipSchema = z.object({
  id: slug,
  story_id: z.string().optional(),
  from_id: slug,
  to_id: slug,
  kind: z.string().min(1),
  sentiment: z.string().nullable().default(null),
  bag: BagSchema,
});

export const CharacterKnowledgeSchema = z.object({
  id: slug,
  story_id: z.string().optional(),
  character_id: slug,
  fact_ref: z.string().min(1),
  /** `null` means known from the World Model seed — true from the story's start. */
  learned_at_scene: slug.nullable().default(null),
  bag: BagSchema,
});

export const WorldModelSeedSchema = z.object({
  characters: z.array(CharacterSchema).default([]),
  locations: z.array(LocationSchema).default([]),
  objects: z.array(StoryObjectSchema).default([]),
  relationships: z.array(RelationshipSchema).default([]),
  /**
   * Not part of the seed by default. Present where the author needs a character to start
   * already knowing something — the abbreviated envelope example in the schema doc omits this
   * array, but its prose allows it and `fixtures/a-christmas-carol` relies on it.
   */
  character_knowledge: z.array(CharacterKnowledgeSchema).default([]),
});

// --- Scene Card --------------------------------------------------------------------------

/**
 * Reserved keys inside `exit_state` for rows a scene *creates* rather than columns it updates.
 *
 * `docs/schema/story-package.md` types `entry_state`/`exit_state` as opaque JSON. Both fixtures
 * needed a concrete convention and adopted `{ <entity_id>: { <column>: <value> } }` plus these
 * two reserved keys (`fixtures/authoring-notes.md` §2). This module makes that convention the
 * parsed shape, and `src/schema/state-update.ts` normalizes it into the same per-entity,
 * per-column update list ADR 0005's consequences require of the writer — so authors and the
 * runtime are not inventing two conventions independently.
 */
export const NEW_RELATIONSHIPS_KEY = '_new_relationships';
export const NEW_CHARACTER_KNOWLEDGE_KEY = '_new_character_knowledge';

/** A column value an author may assert or the engine may propose. */
export const StateValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const EntityStateSchema = z.record(z.string(), StateValueSchema);

export const SceneStateSchema = z.record(
  z.string(),
  z.union([
    EntityStateSchema,
    z.array(RelationshipSchema),
    z.array(CharacterKnowledgeSchema),
  ]),
);

export const PayoffSchema = z.object({
  fact_ref: z.string().min(1),
  /** `null` = grounded in the World Model seed, not planted by any scene. */
  plant: slug.nullable(),
});

export const SceneCardSchema = z.object({
  id: slug,
  order: z.number().int().positive(),
  pov: slug,
  location_id: slug,
  characters_present: z.array(slug),
  dramatic_function: z.string(),
  entry_state: SceneStateSchema,
  exit_state: SceneStateSchema,
  required_beats: z.array(z.string()).default([]),
  reader_must_learn: z.array(z.string()).default([]),
  must_stay_hidden: z.array(z.string()).default([]),
  force_reintroduce: z.array(z.string()).default([]),
  tone: z.string().optional(),
  length_budget: z.number().int().positive().optional(),
  invariants: z.array(z.string()).default([]),
  pays_off: z.array(PayoffSchema).default([]),
});

// --- Envelope ----------------------------------------------------------------------------

export const StoryPackageMetadataSchema = z.looseObject({
  title: z.string(),
  source: z.string().optional(),
  created_at: z.string().optional(),
});

/**
 * The envelope is parsed loosely: the Voice Card's field-level shape is owned by issue #11 and
 * carried opaquely here, and both fixtures attach a non-schema `_authoring_conventions` block
 * that must survive a parse/serialize round trip into a retained `package_version` snapshot.
 */
export const StoryPackageSchema = z.looseObject({
  /** The shape of this document. Bumped only on breaking changes to the schema. */
  schema_version: z.string(),
  /** Author-facing integer, incremented on meaningful content edits — never auto-incremented. */
  package_version: z.number().int().positive(),
  story_id: slug,
  world_model_seed: WorldModelSeedSchema,
  scene_cards: z.array(SceneCardSchema).min(1),
  voice_card: z.record(z.string(), z.unknown()).default({}),
  metadata: StoryPackageMetadataSchema,
});

export type Character = z.infer<typeof CharacterSchema>;
export type StoryLocation = z.infer<typeof LocationSchema>;
export type StoryObject = z.infer<typeof StoryObjectSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type CharacterKnowledge = z.infer<typeof CharacterKnowledgeSchema>;
export type WorldModelSeed = z.infer<typeof WorldModelSeedSchema>;
export type SceneCard = z.infer<typeof SceneCardSchema>;
export type SceneState = z.infer<typeof SceneStateSchema>;
export type EntityState = z.infer<typeof EntityStateSchema>;
export type StateValue = z.infer<typeof StateValueSchema>;
export type Payoff = z.infer<typeof PayoffSchema>;
export type StoryPackage = z.infer<typeof StoryPackageSchema>;
export type BagValue = z.infer<typeof BagValueSchema>;

/** Parse and validate a Story Package, throwing a `ZodError` on a schema mismatch. */
export function parseStoryPackage(input: unknown): StoryPackage {
  return StoryPackageSchema.parse(input);
}

/** Scene Cards in Syuzhet order. `order` is the author's field; array position is incidental. */
export function scenesInOrder(pkg: StoryPackage): SceneCard[] {
  return [...pkg.scene_cards].sort((a, b) => a.order - b.order);
}

/** Read the per-entity column assertions out of an `entry_state`/`exit_state` block. */
export function entityAssertions(state: SceneState): Array<[string, EntityState]> {
  return Object.entries(state).filter(
    (entry): entry is [string, EntityState] =>
      !entry[0].startsWith('_') && !Array.isArray(entry[1]),
  );
}

/** Read the reserved `_new_relationships` rows out of an `exit_state` block. */
export function newRelationships(state: SceneState): Relationship[] {
  const rows = state[NEW_RELATIONSHIPS_KEY];
  return Array.isArray(rows) ? (rows as Relationship[]) : [];
}

/** Read the reserved `_new_character_knowledge` rows out of an `exit_state` block. */
export function newCharacterKnowledge(state: SceneState): CharacterKnowledge[] {
  const rows = state[NEW_CHARACTER_KNOWLEDGE_KEY];
  return Array.isArray(rows) ? (rows as CharacterKnowledge[]) : [];
}
