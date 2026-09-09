/**
 * The normalized state-update shape.
 *
 * ADR 0005's consequences require the writer to emit `state_updates` as a **per-column,
 * per-entity list** (not free-form prose), "since §2's rules validate at column granularity".
 * This module fixes that shape and provides the one conversion the rest of the system needs:
 * from the fixtures' `entry_state`/`exit_state` JSON convention into the same list, so a Scene
 * Card's assertions and the engine's proposals are compared in a single vocabulary.
 *
 * `fixtures/authoring-notes.md` §2 asks for exactly this alignment.
 */

import { z } from 'zod';
import { ROW_COLUMN, TABLE_NAMES, type TableName } from './tiers';
import {
  CharacterKnowledgeSchema,
  RelationshipSchema,
  StateValueSchema,
  newCharacterKnowledge,
  newRelationships,
  entityAssertions,
  type CharacterKnowledge,
  type Relationship,
  type SceneState,
  type StateValue,
} from './story-package';

/** A change to one column of one existing row. */
export const ColumnUpdateSchema = z.object({
  kind: z.literal('column'),
  table: z.enum(TABLE_NAMES),
  entity_id: z.string().min(1),
  column: z.string().min(1),
  value: StateValueSchema,
});

/**
 * The creation of one `relationship` or `character_knowledge` row.
 *
 * Entity rows (character/location/object) are deliberately absent: the engine never creates
 * entities. Both fixtures express an object that does not yet exist as a `status` convention on
 * an author-seeded row instead (`fixtures/authoring-notes.md` §5).
 */
export const RowInsertSchema = z.object({
  kind: z.literal('row'),
  table: z.enum(['relationship', 'character_knowledge']),
  row: z.union([RelationshipSchema, CharacterKnowledgeSchema]),
});

export const StateUpdateSchema = z.discriminatedUnion('kind', [
  ColumnUpdateSchema,
  RowInsertSchema,
]);

export type ColumnUpdate = z.infer<typeof ColumnUpdateSchema>;
export type RowInsert = z.infer<typeof RowInsertSchema>;
export type StateUpdate = z.infer<typeof StateUpdateSchema>;

/** The row id a state update addresses, whichever shape it takes. */
export function updateTargetId(update: StateUpdate): string {
  return update.kind === 'column' ? update.entity_id : update.row.id;
}

/** The column a state update writes — `_row` for an insert, whose subject is the row itself. */
export function updateColumn(update: StateUpdate): string {
  return update.kind === 'column' ? update.column : ROW_COLUMN;
}

/** The value a state update writes. An insert's value is the whole row. */
export function updateValue(update: StateUpdate): StateValue | Relationship | CharacterKnowledge {
  return update.kind === 'column' ? update.value : update.row;
}

/** Convenience constructor for a column update. */
export function columnUpdate(
  table: TableName,
  entity_id: string,
  column: string,
  value: StateValue,
): ColumnUpdate {
  return { kind: 'column', table, entity_id, column, value };
}

/** Convenience constructor for a relationship insert. */
export function relationshipInsert(row: Relationship): RowInsert {
  return { kind: 'row', table: 'relationship', row };
}

/** Convenience constructor for a character-knowledge insert. */
export function characterKnowledgeInsert(row: CharacterKnowledge): RowInsert {
  return { kind: 'row', table: 'character_knowledge', row };
}

/**
 * Normalize an `entry_state`/`exit_state` block into the same update list the writer emits.
 *
 * `resolveTable` maps an entity id to the table holding it — the World Model supplies this, so
 * the conversion never has to guess a table from an id prefix.
 */
export function stateToUpdates(
  state: SceneState,
  resolveTable: (entityId: string) => TableName | null,
): StateUpdate[] {
  const updates: StateUpdate[] = [];

  for (const [entityId, columns] of entityAssertions(state)) {
    const table = resolveTable(entityId);
    if (table === null) continue;
    for (const [column, value] of Object.entries(columns)) {
      updates.push(columnUpdate(table, entityId, column, value));
    }
  }

  for (const row of newRelationships(state)) {
    updates.push(relationshipInsert(row));
  }
  for (const row of newCharacterKnowledge(state)) {
    updates.push(characterKnowledgeInsert(row));
  }

  return updates;
}
