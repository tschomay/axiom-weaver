/**
 * What the Scene Card editor decides.
 *
 * [ADR 0017](../../docs/adr/0017-the-manuscript-and-publishing.md) §6 and §10, and the hard half
 * of the authoring surface: a Scene Card is eight required fields and seven optional ones, two of
 * which — `entry_state` and `exit_state` — are open JSON with reserved keys. Issues #18 and #16
 * both measured that this is exactly where hand-authoring goes wrong, so this module turns that
 * JSON into rows and turns every id into a choice.
 *
 * As with `./editor-model`, nothing here touches a store or a network, and the components that
 * use it are thin.
 */

import {
  NEW_CHARACTER_KNOWLEDGE_KEY,
  NEW_RELATIONSHIPS_KEY,
  entityAssertions,
  newCharacterKnowledge,
  newRelationships,
  type SceneState,
  type StateValue,
} from '../schema/story-package';
import type { DraftSceneCard, DraftStoryPackage } from '../schema/manuscript';
import { ROW_COLUMN, columnAuthority, tieredColumns, type TableName, type Tier } from '../schema/tiers';
import { SEED_TABLES, slugify, type SeedLike } from './editor-model';

// --- The scene list -----------------------------------------------------------------------

/** Scene Cards in Syuzhet order. `order` is the author's field; array position is incidental. */
export function inOrder(scenes: readonly DraftSceneCard[]): DraftSceneCard[] {
  return [...scenes].sort((a, b) => a.order - b.order);
}

/**
 * Rewrite `order` as 1..n **by array position**, taking the array as the intended sequence.
 *
 * This is the one a reorder needs: after a move, the array says where the cards should go and
 * `order` still says where they were, so anything that consults `order` first would put the moved
 * card straight back.
 */
export function resequence(scenes: readonly DraftSceneCard[]): DraftSceneCard[] {
  return scenes.map((scene, index) => ({ ...scene, order: index + 1 }));
}

/**
 * Rewrite `order` as 1..n over the sequence `order` currently describes.
 *
 * What an add or a delete needs, and called after every structural change rather than only after
 * a reorder: `order` is what the whole system reads as the Syuzhet, and a list with a gap or a
 * duplicate in it is a list where "comes before" stops being answerable — which is the question
 * ADR 0004's plant walk is made of.
 */
export function renumber(scenes: readonly DraftSceneCard[]): DraftSceneCard[] {
  return resequence(inOrder(scenes));
}

/** Move one card one step earlier or later, and renumber. */
export function moveScene(
  scenes: readonly DraftSceneCard[],
  sceneId: string,
  direction: -1 | 1,
): DraftSceneCard[] {
  const sequence = inOrder(scenes);
  const at = sequence.findIndex((scene) => scene.id === sceneId);
  const to = at + direction;
  if (at === -1 || to < 0 || to >= sequence.length) return [...scenes];
  const moved = [...sequence];
  const [card] = moved.splice(at, 1);
  if (card === undefined) return [...scenes];
  moved.splice(to, 0, card);
  return resequence(moved);
}

/**
 * A fresh scene id, in the shape both fixtures use: `scene_04_the_lamp`.
 *
 * The number is the position, so an id read on its own still says where in the story it sits —
 * and it is minted once, at creation, never rewritten by a later reorder. Renaming ids on a
 * reorder would silently break every `pays_off` that names one.
 */
export function mintSceneId(scenes: readonly DraftSceneCard[], name: string): string {
  const taken = new Set(scenes.map((scene) => scene.id));
  const position = String(scenes.length + 1).padStart(2, '0');
  const stem = slugify(name);
  const base = stem === '' ? `scene_${position}` : `scene_${position}_${stem}`;
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Where a new card's content comes from (ADR 0017 §10).
 *
 * Exactly two, and this is the seam: a model-proposed source would be a third `kind` handled in
 * `newSceneCard` and nowhere else. It is **not built** — the map rules procedural Syuzhet out of
 * scope for v1, and that exclusion stands. What is recorded here is only that the editor's shape
 * does not foreclose it.
 */
export const CARD_SOURCES = ['blank', 'duplicated-from'] as const;

export type CardSourceKind = (typeof CARD_SOURCES)[number];

export type CardSource =
  | { readonly kind: 'blank'; readonly name?: string }
  | { readonly kind: 'duplicated-from'; readonly scene: DraftSceneCard };

export function blankSceneCard(id: string, order: number): DraftSceneCard {
  return {
    id,
    order,
    pov: '',
    location_id: '',
    characters_present: [],
    dramatic_function: '',
    entry_state: {},
    exit_state: {},
    required_beats: [],
    reader_must_learn: [],
    must_stay_hidden: [],
    force_reintroduce: [],
    invariants: [],
    pays_off: [],
  };
}

/**
 * Add a card from one of the two sources, appended at the end and renumbered.
 *
 * A duplicate keeps everything except its id and its `pays_off`: a copied payoff would name the
 * original's plant scene and be either wrong or a silent duplicate obligation, and neither is
 * something an author asked for by pressing "duplicate".
 */
export function addSceneCard(
  scenes: readonly DraftSceneCard[],
  source: CardSource,
): { scenes: DraftSceneCard[]; id: string } {
  const order = scenes.length + 1;
  if (source.kind === 'blank') {
    const id = mintSceneId(scenes, source.name ?? '');
    return { scenes: renumber([...scenes, blankSceneCard(id, order)]), id };
  }
  // The source's own id already carries its creation position, so feeding it back in whole
  // produces `scene_05_scene_04_copy`. Only the name half travels.
  const id = mintSceneId(scenes, `${sceneName(source.scene.id)} copy`);
  const copy: DraftSceneCard = { ...source.scene, id, order, pays_off: [] };
  return { scenes: renumber([...scenes, copy]), id };
}

/** The name half of a scene id: `scene_04_the_lamp` → `the_lamp`, `scene_04` → ``. */
export function sceneName(sceneId: string): string {
  return sceneId.replace(/^scene_\d+_?/, '');
}

export function deleteSceneCard(
  scenes: readonly DraftSceneCard[],
  sceneId: string,
): DraftSceneCard[] {
  return renumber(scenes.filter((scene) => scene.id !== sceneId));
}

export interface PlantDependency {
  /** The scene whose `pays_off` names the card about to be deleted. */
  readonly payoff_scene_id: string;
  readonly fact_ref: string;
}

/**
 * Every payoff that would be orphaned by deleting a card.
 *
 * Said before the delete, not reported by the linter afterwards: the author can still change
 * their mind while the card is on screen, and a `plant_scene_unknown` error two screens later is
 * the same information at a worse moment.
 */
export function plantDependents(
  scenes: readonly DraftSceneCard[],
  sceneId: string,
): PlantDependency[] {
  const found: PlantDependency[] = [];
  for (const scene of inOrder(scenes)) {
    for (const payoff of scene.pays_off ?? []) {
      if (payoff.plant === sceneId) {
        found.push({ payoff_scene_id: scene.id, fact_ref: payoff.fact_ref });
      }
    }
  }
  return found;
}

// --- Fact refs ----------------------------------------------------------------------------

/** Facts known from the seed: `character_knowledge` rows with no learning scene. */
export function draftSeedFacts(pkg: DraftStoryPackage): Set<string> {
  const facts = new Set<string>();
  for (const row of pkg.world_model_seed.character_knowledge ?? []) {
    if ((row.learned_at_scene ?? null) === null && row.fact_ref !== '') facts.add(row.fact_ref);
  }
  return facts;
}

/**
 * Every `fact_ref` the package already uses, anywhere.
 *
 * Offered as suggestions wherever a fact ref is typed. A fact ref is a free slug — there is no
 * table of them to pick from — so a typo is not an error the schema can catch; it is a plant
 * chain that silently never closes. Suggesting what is already in use is the cheapest thing that
 * makes the common case a choice rather than a retype.
 */
export function factRefsInUse(pkg: DraftStoryPackage): string[] {
  const refs = new Set<string>();
  const add = (value: string | undefined) => {
    if (value !== undefined && value !== '') refs.add(value);
  };
  for (const row of pkg.world_model_seed.character_knowledge ?? []) add(row.fact_ref);
  for (const scene of pkg.scene_cards) {
    for (const ref of scene.reader_must_learn ?? []) add(ref);
    for (const ref of scene.must_stay_hidden ?? []) add(ref);
    for (const ref of scene.force_reintroduce ?? []) add(ref);
    for (const payoff of scene.pays_off ?? []) add(payoff.fact_ref);
    for (const row of newCharacterKnowledge(scene.exit_state ?? {})) add(row.fact_ref);
  }
  return [...refs].sort();
}

// --- `pays_off` ---------------------------------------------------------------------------

export interface PlantChoice {
  readonly id: string;
  readonly label: string;
  /** Whether that scene's own `reader_must_learn` declares the fact (ADR 0004 decision 2). */
  readonly declares: boolean;
}

/**
 * The scenes a payoff may name as its plant: strictly earlier ones, and only those.
 *
 * A picker that could offer a later scene would be a picker that can produce ADR 0004's
 * `plant_after_payoff` — the same reasoning as every other id control here.
 */
export function plantChoices(
  scenes: readonly DraftSceneCard[],
  payoffSceneId: string,
  factRef: string,
): PlantChoice[] {
  const sequence = inOrder(scenes);
  const payoff = sequence.find((scene) => scene.id === payoffSceneId);
  if (payoff === undefined) return [];
  return sequence
    .filter((scene) => scene.order < payoff.order)
    .map((scene) => ({
      id: scene.id,
      label: scene.id,
      declares: (scene.reader_must_learn ?? []).includes(factRef),
    }));
}

export type PayoffStatus =
  | 'ok'
  | 'plant_not_declared'
  | 'plant_after_payoff'
  | 'plant_scene_unknown'
  | 'unfounded_seed_payoff'
  | 'no_fact';

/**
 * What ADR 0004's walk would say about one `pays_off` entry, said next to the control instead.
 *
 * The codes are the walk's own, so the editor and the linter cannot drift into two opinions about
 * the same pair.
 */
export function payoffStatus(
  pkg: DraftStoryPackage,
  payoffSceneId: string,
  entry: { fact_ref: string; plant?: string | null },
): PayoffStatus {
  if (entry.fact_ref === '') return 'no_fact';
  const plant = entry.plant ?? null;
  if (plant === null) {
    return draftSeedFacts(pkg).has(entry.fact_ref) ? 'ok' : 'unfounded_seed_payoff';
  }
  const sequence = inOrder(pkg.scene_cards);
  const plantScene = sequence.find((scene) => scene.id === plant);
  if (plantScene === undefined) return 'plant_scene_unknown';
  const payoffScene = sequence.find((scene) => scene.id === payoffSceneId);
  if (payoffScene === undefined) return 'plant_scene_unknown';
  if (plantScene.order >= payoffScene.order) return 'plant_after_payoff';
  return (plantScene.reader_must_learn ?? []).includes(entry.fact_ref) ? 'ok' : 'plant_not_declared';
}

export const PAYOFF_STATUS_MESSAGES: Record<PayoffStatus, string> = {
  ok: '',
  no_fact: 'name the fact this scene resolves',
  plant_not_declared:
    'that scene never lists this fact in its own reader_must_learn, so nothing plants it',
  plant_after_payoff: 'that scene does not come before this one',
  plant_scene_unknown: 'no Scene Card carries that id any more',
  unfounded_seed_payoff:
    'nothing in the World Model seed establishes this fact before the story opens',
};

// --- The state-row builder ----------------------------------------------------------------

export type StateRow =
  | {
      readonly kind: 'column';
      readonly entity_id: string;
      readonly column: string;
      readonly value: StateValue;
    }
  | { readonly kind: 'relationship'; readonly row: Record<string, unknown> }
  | { readonly kind: 'knowledge'; readonly row: Record<string, unknown> };

/**
 * A state block as rows: entity → column → value, plus the rows the scene creates.
 *
 * The reserved `_new_relationships` / `_new_character_knowledge` keys become their own row kinds
 * rather than keys an author has to know to type (ADR 0017 §6).
 */
export function stateRows(state: SceneState | undefined): StateRow[] {
  const block = state ?? {};
  const rows: StateRow[] = [];
  for (const [entityId, columns] of entityAssertions(block)) {
    for (const [column, value] of Object.entries(columns)) {
      rows.push({ kind: 'column', entity_id: entityId, column, value });
    }
  }
  for (const row of newRelationships(block)) {
    rows.push({ kind: 'relationship', row: row as unknown as Record<string, unknown> });
  }
  for (const row of newCharacterKnowledge(block)) {
    rows.push({ kind: 'knowledge', row: row as unknown as Record<string, unknown> });
  }
  return rows;
}

/**
 * Rows back into a state block.
 *
 * Grouped by first appearance so a block that came out of `stateRows` goes back in unchanged —
 * the editor must never be the reason a package's bytes moved.
 */
export function stateFromRows(rows: readonly StateRow[]): SceneState {
  const block: Record<string, unknown> = {};
  const relationships: unknown[] = [];
  const knowledge: unknown[] = [];

  for (const row of rows) {
    if (row.kind === 'relationship') {
      relationships.push(row.row);
      continue;
    }
    if (row.kind === 'knowledge') {
      knowledge.push(row.row);
      continue;
    }
    if (row.entity_id === '' || row.column === '') continue;
    const columns = (block[row.entity_id] ?? {}) as Record<string, StateValue>;
    columns[row.column] = row.value;
    block[row.entity_id] = columns;
  }

  if (relationships.length > 0) block[NEW_RELATIONSHIPS_KEY] = relationships;
  if (knowledge.length > 0) block[NEW_CHARACTER_KNOWLEDGE_KEY] = knowledge;
  return block as SceneState;
}

/** A state block's content as a comparable string, for the reconciliation below. */
export function stateSignature(state: SceneState | undefined): string {
  return JSON.stringify(state ?? {});
}

export interface StateDraft {
  /** The signature of the block these rows produce. */
  readonly produced: string;
  readonly rows: StateRow[];
}

/**
 * Which rows the state editor should show.
 *
 * An assertion with no entity or no column yet exists on screen and not in the package — the same
 * arrangement a bag's unnamed key needs, and for the same reason: persisting a half-made row
 * would write an empty column into the Story Package on the next autosave, a second later. So the
 * editor keeps its own rows, and they stand for exactly as long as the package still holds what
 * they produce. The moment the block changes from anywhere else the rows are rebuilt from it.
 */
export function reconcileStateRows(
  state: SceneState | undefined,
  draft: StateDraft | null,
): StateRow[] {
  if (draft !== null && draft.produced === stateSignature(state)) return draft.rows;
  return stateRows(state);
}

/** Which table a seed entity lives in, so its columns and their tiers can be looked up. */
export function tableForEntity(seed: SeedLike, entityId: string): TableName | null {
  for (const entry of SEED_TABLES) {
    if ((seed[entry.array] ?? []).some((row) => row.id === entityId)) return entry.table;
  }
  return null;
}

export interface ColumnChoice {
  readonly column: string;
  readonly tier: Tier | null;
}

/**
 * The columns a state row may assert on an entity, with the tier each one carries.
 *
 * Read from `src/schema/tiers.ts` rather than restated here: a tier is declared once per column
 * at the schema level (ADR 0001, Principle 2), and a UI that kept its own copy would be a second
 * declaration to keep in sync. `_row` is excluded — a row's existence is created by the "this
 * scene creates a row" affordance, not asserted as a column.
 */
export function columnChoices(table: TableName | null, current: string): ColumnChoice[] {
  if (table === null) {
    return current === '' ? [] : [{ column: current, tier: null }];
  }
  const choices = tieredColumns(table)
    .filter((column) => column !== ROW_COLUMN)
    .map((column) => ({ column, tier: columnAuthority(table, column).tier }));
  // A column already in the package that the table does not declare stays visible and stays
  // selected: snapping it to a valid one would edit the story to make a problem disappear.
  if (current !== '' && !choices.some((choice) => choice.column === current)) {
    return [{ column: current, tier: null }, ...choices];
  }
  return choices;
}

/** A blank row of each kind, in the shape the fixtures' reserved keys carry. */
export function blankRelationshipRow(index: number): Record<string, unknown> {
  return { id: `rel_scene_${index}`, from_id: '', to_id: '', kind: '', sentiment: null, bag: {} };
}

export function blankKnowledgeRow(index: number, sceneId: string): Record<string, unknown> {
  return {
    id: `know_scene_${index}`,
    character_id: '',
    fact_ref: '',
    learned_at_scene: sceneId,
    bag: {},
  };
}

// --- Per-scene lint -----------------------------------------------------------------------

/** The path prefix the linter uses for one card, so a scene row can count its own problems. */
export function scenePath(sceneId: string, field?: string): string {
  return ['scene_cards', sceneId, field].filter((part) => part !== undefined).join('.');
}
