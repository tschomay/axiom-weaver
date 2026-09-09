/**
 * Write-authority tiers.
 *
 * ADR 0001 decision 2: a property's tier is declared **once per column in the schema**, never
 * per row. That is what lets the state-update authority validator (ADR 0005) reason about what
 * the engine may commit statically, without consulting data.
 *
 * Tier legend, from `docs/schema/story-package.md`:
 *   P — physical   (engine writes freely, auto-committed)
 *   E — epistemic  (engine writes freely, auto-committed)
 *   V — volitional (engine may only *propose*)
 *   null — untiered: identity or author-only, never engine-written (ids, foreign keys, `bag`)
 */

export type Tier = 'P' | 'E' | 'V';

export const TABLE_NAMES = [
  'character',
  'location',
  'object',
  'relationship',
  'character_knowledge',
] as const;

export type TableName = (typeof TABLE_NAMES)[number];

/**
 * The reserved pseudo-column standing for a whole row's existence.
 *
 * `character_knowledge` has no tiered column of its own — per the schema doc, "the *row's
 * existence* is the epistemic fact". A `relationship` row's existence is likewise the structural
 * (physical) fact `kind` names. Modelling both as a write to `_row` keeps every state update,
 * insert or column change, in a single shape the commit log (ADR 0016 §2) can record.
 *
 * The leading underscore follows the fixtures' own reserved-key convention
 * (`_new_relationships` / `_new_character_knowledge`, see `fixtures/authoring-notes.md`).
 */
export const ROW_COLUMN = '_row';

const COLUMN_TIERS: Record<TableName, Record<string, Tier | null>> = {
  character: {
    id: null,
    story_id: null,
    name: 'P',
    location_id: 'P',
    status: 'P',
    goal: 'V',
    bag: null,
    [ROW_COLUMN]: null,
  },
  location: {
    id: null,
    story_id: null,
    name: 'P',
    bag: null,
    [ROW_COLUMN]: null,
  },
  object: {
    id: null,
    story_id: null,
    name: 'P',
    location_id: 'P',
    status: 'P',
    bag: null,
    [ROW_COLUMN]: null,
  },
  relationship: {
    id: null,
    story_id: null,
    from_id: null,
    to_id: null,
    kind: 'P',
    sentiment: 'V',
    bag: null,
    [ROW_COLUMN]: 'P',
  },
  character_knowledge: {
    id: null,
    story_id: null,
    character_id: null,
    fact_ref: null,
    learned_at_scene: null,
    bag: null,
    [ROW_COLUMN]: 'E',
  },
};

export interface ColumnAuthority {
  /** Whether the column exists on the table at all. */
  readonly known: boolean;
  /** The declared tier, or `null` for an untiered (never engine-written) column. */
  readonly tier: Tier | null;
}

/** Look up a column's declared write authority. Unknown columns are reported, not guessed at. */
export function columnAuthority(table: TableName, column: string): ColumnAuthority {
  const columns = COLUMN_TIERS[table];
  if (!Object.prototype.hasOwnProperty.call(columns, column)) {
    return { known: false, tier: null };
  }
  return { known: true, tier: columns[column] ?? null };
}

/** Every column of a table that carries a tier, i.e. every column the engine may write. */
export function tieredColumns(table: TableName): string[] {
  return Object.entries(COLUMN_TIERS[table])
    .filter(([, tier]) => tier !== null)
    .map(([column]) => column);
}

/** True for the tiers ADR 0005 §1's pre-generation entry check compares (P/E only). */
export function isAutoCommittedTier(tier: Tier | null): tier is 'P' | 'E' {
  return tier === 'P' || tier === 'E';
}
