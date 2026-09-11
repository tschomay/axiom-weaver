/**
 * The World Model: relational tables holding cold, queryable ground truth *at the current
 * moment* (`CONTEXT.md`, The two memories).
 *
 * Modelled here as normalized in-memory tables keyed by row id — "as if SQL", per ADR 0001 and
 * `docs/research/vercel-runtime.md` §3.5's "the table is the prefix; the primary key is the
 * pathname". Nothing in this module decides *whether* an update may be applied; that is the
 * validator's job (ADR 0005). This is the store the validator reads and the commit log writes.
 */

import { ROW_COLUMN, type TableName } from '../schema/tiers';
import type {
  Character,
  CharacterKnowledge,
  Relationship,
  StateValue,
  StoryLocation,
  StoryObject,
  WorldModelSeed,
} from '../schema/story-package';

export type WorldModelRow =
  | Character
  | StoryLocation
  | StoryObject
  | Relationship
  | CharacterKnowledge;

export interface WorldModelTables {
  character: Record<string, Character>;
  location: Record<string, StoryLocation>;
  object: Record<string, StoryObject>;
  relationship: Record<string, Relationship>;
  character_knowledge: Record<string, CharacterKnowledge>;
}

function emptyTables(): WorldModelTables {
  return {
    character: {},
    location: {},
    object: {},
    relationship: {},
    character_knowledge: {},
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class WorldModel {
  readonly storyId: string;
  private readonly tables: WorldModelTables;
  /** Row id → table, so an update never has to guess a table from a slug prefix. */
  private readonly index = new Map<string, TableName>();

  private constructor(storyId: string, tables: WorldModelTables) {
    this.storyId = storyId;
    this.tables = tables;
    for (const table of Object.keys(tables) as TableName[]) {
      for (const id of Object.keys(tables[table])) {
        this.index.set(id, table);
      }
    }
  }

  /**
   * Load a World Model from a Story Package's `world_model_seed`.
   *
   * `story_id` is stamped onto every row here — inside the package it is implied by the
   * envelope, and this is where it becomes part of the composite key.
   */
  static fromSeed(storyId: string, seed: WorldModelSeed): WorldModel {
    const model = WorldModel.fromSeedUnchecked(storyId, seed);
    model.assertReferentialIntegrity();
    return model;
  }

  /**
   * The same load without the integrity assertion — for callers whose job is to *report* broken
   * references rather than refuse them.
   *
   * `fromSeed` throwing is right for the compiler, which must not run against a seed that does
   * not resolve. It is wrong for the linter (ADR 0017 §4) and for `loadStory`, both of which
   * collect `referenceProblems()` into a list for a human to act on and so must be able to build
   * the model that produces that list.
   */
  static fromSeedUnchecked(storyId: string, seed: WorldModelSeed): WorldModel {
    const tables = emptyTables();
    const stamp = <T extends { id: string; story_id?: string | undefined }>(row: T): T => ({
      ...clone(row),
      story_id: storyId,
    });

    for (const row of seed.characters) tables.character[row.id] = stamp(row);
    for (const row of seed.locations) tables.location[row.id] = stamp(row);
    for (const row of seed.objects) tables.object[row.id] = stamp(row);
    for (const row of seed.relationships) tables.relationship[row.id] = stamp(row);
    for (const row of seed.character_knowledge) tables.character_knowledge[row.id] = stamp(row);

    return new WorldModel(storyId, tables);
  }

  /** A deep, independent copy — replay and "as of scene N" never mutate a shared model. */
  copy(): WorldModel {
    return new WorldModel(this.storyId, clone(this.tables));
  }

  /** The table holding a row id, or `null` if no row with that id exists. */
  tableOf(id: string): TableName | null {
    return this.index.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  row(id: string): WorldModelRow | null {
    const table = this.tableOf(id);
    if (table === null) return null;
    return (this.tables[table] as Record<string, WorldModelRow>)[id] ?? null;
  }

  rows<T extends TableName>(table: T): WorldModelTables[T][string][] {
    return Object.values(this.tables[table]) as WorldModelTables[T][string][];
  }

  /** The current committed value of a column, or `undefined` if the row or column is absent. */
  value(id: string, column: string): unknown {
    const row = this.row(id);
    if (row === null) return undefined;
    return (row as Record<string, unknown>)[column];
  }

  /**
   * The display name of a row, where it has one. Used by the validator's entailment heuristic,
   * which has to relate an id-valued update to the prose of a required beat.
   */
  nameOf(id: string): string | null {
    const row = this.row(id);
    if (row === null) return null;
    const name = (row as Record<string, unknown>).name;
    return typeof name === 'string' ? name : null;
  }

  /** Write a column on an existing row. Callers are expected to have validated the write. */
  setColumn(id: string, column: string, value: StateValue): void {
    const table = this.tableOf(id);
    if (table === null) {
      throw new Error(`Cannot set ${column} on unknown row "${id}"`);
    }
    const row = (this.tables[table] as Record<string, Record<string, unknown>>)[id];
    if (row === undefined) {
      throw new Error(`Cannot set ${column} on unknown row "${id}"`);
    }
    row[column] = value;
  }

  /** Insert a `relationship` or `character_knowledge` row. */
  insertRow(table: 'relationship' | 'character_knowledge', row: WorldModelRow): void {
    const stored = { ...clone(row), story_id: this.storyId } as WorldModelRow;
    (this.tables[table] as Record<string, WorldModelRow>)[stored.id] = stored;
    this.index.set(stored.id, table);
  }

  /** Delete a row — used only to undo an insert while replaying a log backwards. */
  deleteRow(id: string): void {
    const table = this.tableOf(id);
    if (table === null) return;
    delete (this.tables[table] as Record<string, WorldModelRow>)[id];
    this.index.delete(id);
  }

  /** Relationship edges leaving a row. */
  relationshipsFrom(id: string): Relationship[] {
    return this.rows('relationship').filter((edge) => edge.from_id === id);
  }

  /** Relationship edges arriving at a row. */
  relationshipsTo(id: string): Relationship[] {
    return this.rows('relationship').filter((edge) => edge.to_id === id);
  }

  /** In-world knowledge rows for a character. */
  knowledgeOf(characterId: string): CharacterKnowledge[] {
    return this.rows('character_knowledge').filter((k) => k.character_id === characterId);
  }

  /** A plain snapshot suitable for `edition/{runId}/world-model.json`. */
  toJSON(): WorldModelTables {
    return clone(this.tables);
  }

  /** Rehydrate from a snapshot written by `toJSON`. */
  static fromJSON(storyId: string, tables: WorldModelTables): WorldModel {
    return new WorldModel(storyId, clone(tables));
  }

  /**
   * Check every foreign key in the seed resolves. `fixtures/authoring-notes.md` calls
   * reference-existence checking "load-bearing for author-time authoring at any scale" — this is
   * that check for the World Model half; the Scene Card half lives in `src/fixtures/load.ts`.
   */
  assertReferentialIntegrity(): void {
    const problems = this.referenceProblems();
    if (problems.length > 0) {
      throw new Error(
        `World Model seed for "${this.storyId}" has unresolved references:\n  ${problems.join('\n  ')}`,
      );
    }
  }

  referenceProblems(): string[] {
    const problems: string[] = [];
    const requireRow = (id: string | null | undefined, where: string, table?: TableName) => {
      if (id === null || id === undefined) return;
      const found = this.tableOf(id);
      if (found === null) {
        problems.push(`${where} references unknown row "${id}"`);
      } else if (table !== undefined && found !== table) {
        problems.push(`${where} references "${id}", which is a ${found}, not a ${table}`);
      }
    };

    for (const character of this.rows('character')) {
      requireRow(character.location_id, `character.${character.id}.location_id`, 'location');
    }
    for (const object of this.rows('object')) {
      requireRow(object.location_id, `object.${object.id}.location_id`, 'location');
    }
    for (const edge of this.rows('relationship')) {
      requireRow(edge.from_id, `relationship.${edge.id}.from_id`);
      requireRow(edge.to_id, `relationship.${edge.id}.to_id`);
    }
    for (const known of this.rows('character_knowledge')) {
      requireRow(known.character_id, `character_knowledge.${known.id}.character_id`, 'character');
    }
    return problems;
  }
}

/** Re-exported so callers can talk about the row pseudo-column without importing tiers. */
export { ROW_COLUMN };
