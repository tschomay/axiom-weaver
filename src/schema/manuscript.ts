/**
 * The Manuscript: the author's mutable, unversioned working copy of a Story Package.
 *
 * Shapes are [ADR 0017](../../docs/adr/0017-the-manuscript-and-publishing.md) §1/§2. The reason
 * this file exists at all is the collision ADR 0017 opens on: a retained `package_version` is
 * immutable because Compiled editions pin it forever (ADR 0015 §2/§4), while an author editing a
 * scene produces a write every few seconds. Those writes land here instead.
 *
 * The relaxation is deliberate and one-directional. `StoryPackageSchema` requires a non-empty
 * `scene_cards` and eight fields on every card; a story being written from scratch satisfies none
 * of that for its first hour. So the draft shapes below are the strict ones with `.partial()`
 * applied and the `min(1)` string constraints dropped — same field names throughout, so a
 * Manuscript that *is* complete parses as a Story Package unchanged. The strict parse happens at
 * exactly one moment: publish.
 */

import { z } from 'zod';

import {
  BagSchema,
  CharacterKnowledgeSchema,
  CharacterSchema,
  LocationSchema,
  PayoffSchema,
  RelationshipSchema,
  SceneCardSchema,
  SceneStateSchema,
  StoryObjectSchema,
  StoryPackageMetadataSchema,
} from './story-package';

export const MANUSCRIPT_SCHEMA_VERSION = '1.0';

/** A slug an author is still typing: may be blank, never absent-by-accident. */
const draftSlug = z.string();

// --- World Model seed, relaxed ------------------------------------------------------------

export const DraftCharacterSchema = CharacterSchema.partial().extend({
  id: draftSlug,
  name: z.string(),
  bag: BagSchema,
});

export const DraftLocationSchema = LocationSchema.partial().extend({
  id: draftSlug,
  name: z.string(),
  bag: BagSchema,
});

export const DraftObjectSchema = StoryObjectSchema.partial().extend({
  id: draftSlug,
  name: z.string(),
  bag: BagSchema,
});

export const DraftRelationshipSchema = RelationshipSchema.partial().extend({
  id: draftSlug,
  from_id: draftSlug,
  to_id: draftSlug,
  kind: z.string(),
  bag: BagSchema,
});

export const DraftCharacterKnowledgeSchema = CharacterKnowledgeSchema.partial().extend({
  id: draftSlug,
  character_id: draftSlug,
  fact_ref: z.string(),
  bag: BagSchema,
});

export const DraftWorldModelSeedSchema = z.object({
  characters: z.array(DraftCharacterSchema).default([]),
  locations: z.array(DraftLocationSchema).default([]),
  objects: z.array(DraftObjectSchema).default([]),
  relationships: z.array(DraftRelationshipSchema).default([]),
  character_knowledge: z.array(DraftCharacterKnowledgeSchema).default([]),
});

// --- Scene Card, relaxed ------------------------------------------------------------------

/**
 * `order` keeps its integer shape but loses `positive()`: the editor assigns it, so a
 * nonsensical value is a bug rather than something an author types, and the strict parse at
 * publish is what has to catch it either way.
 */
export const DraftSceneCardSchema = SceneCardSchema.partial().extend({
  id: draftSlug,
  order: z.number().int(),
  pov: draftSlug.default(''),
  location_id: draftSlug.default(''),
  characters_present: z.array(draftSlug).default([]),
  dramatic_function: z.string().default(''),
  entry_state: SceneStateSchema.default({}),
  exit_state: SceneStateSchema.default({}),
  required_beats: z.array(z.string()).default([]),
  reader_must_learn: z.array(z.string()).default([]),
  must_stay_hidden: z.array(z.string()).default([]),
  force_reintroduce: z.array(z.string()).default([]),
  invariants: z.array(z.string()).default([]),
  pays_off: z.array(PayoffSchema.partial().extend({ fact_ref: z.string() })).default([]),
});

// --- Envelope, relaxed --------------------------------------------------------------------

/**
 * Loose for the same reason `StoryPackageSchema` is (ADR 0017 §2, and the `_authoring_conventions`
 * block both long fixtures carry): a Manuscript must survive a round trip through the editor
 * without quietly dropping what the forms do not yet know how to show.
 */
export const DraftStoryPackageSchema = z.looseObject({
  schema_version: z.string().default('1.0'),
  package_version: z.number().int().positive().default(1),
  story_id: draftSlug,
  world_model_seed: DraftWorldModelSeedSchema.prefault({}),
  scene_cards: z.array(DraftSceneCardSchema).default([]),
  voice_card: z.record(z.string(), z.unknown()).default({}),
  metadata: StoryPackageMetadataSchema.partial().extend({ title: z.string() }),
});

/** How a Manuscript came to exist — the three entry points of ADR 0017 §5. */
export const MANUSCRIPT_SOURCES = ['new', 'edit', 'duplicate'] as const;
export type ManuscriptSource = (typeof MANUSCRIPT_SOURCES)[number];

export const ManuscriptSchema = z.object({
  schema_version: z.string(),
  story_id: z.string().min(1),
  /**
   * The retained version this was opened from; `null` when the story has never published.
   *
   * Read it as provenance, never as arithmetic: the next `package_version` is
   * `max(retained) + 1`, which is what keeps a publish from colliding with a version an
   * edition already pins (ADR 0017 §3).
   */
  based_on_version: z.number().int().positive().nullable(),
  source: z.enum(MANUSCRIPT_SOURCES),
  /** Where a `duplicate` came from, for provenance. `null` otherwise. */
  duplicated_from: z
    .object({ story_id: z.string(), package_version: z.number().int().positive() })
    .nullable()
    .default(null),
  created_at: z.string(),
  /** The optimistic-concurrency precondition of ADR 0017 §8 — two tabs on one phone. */
  updated_at: z.string(),
  package: DraftStoryPackageSchema,
});

export type DraftStoryPackage = z.infer<typeof DraftStoryPackageSchema>;
export type DraftSceneCard = z.infer<typeof DraftSceneCardSchema>;
export type Manuscript = z.infer<typeof ManuscriptSchema>;

export function parseManuscript(input: unknown): Manuscript {
  return ManuscriptSchema.parse(input);
}
