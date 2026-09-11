/**
 * What the authoring screen knows, minus the screen.
 *
 * [ADR 0017](../../docs/adr/0017-the-manuscript-and-publishing.md) §6 is the rule the module
 * exists to hold: structured fields get structured controls, the author never types an id, and
 * Principle 4 (no nested objects in a `bag`) is enforced *by the control* rather than documented
 * at the author. A rule enforced by a control is only as trustworthy as the control, so the
 * control's logic lives here where it can be checked, and the components stay thin — the same
 * split the four surfaces of ADR 0016 already use.
 *
 * Nothing here reaches a store or a network. It is shapes, choices and coercions.
 */

import { BagSchema, type BagValue, type WorldModelSeed } from '../schema/story-package';
import type { DraftStoryPackage } from '../schema/manuscript';
import { columnAuthority, type TableName, type Tier } from '../schema/tiers';
import { STYLE_PRESETS, cardFromPreset, type VoiceCard } from '../voice/voice-card';

// --- Sections -----------------------------------------------------------------------------

/**
 * The five field groups the screen drills into (ADR 0017 §7).
 *
 * They are a property of the package's shape rather than of the layout: the same five are the
 * sidebar on a desktop and the drill-down list on a phone, which is what keeps the two from
 * becoming two designs to hold in sync.
 */
export const EDITOR_SECTIONS = ['story', 'voice', 'world', 'scenes', 'publish'] as const;

export type EditorSection = (typeof EDITOR_SECTIONS)[number];

export const SECTION_LABELS: Record<EditorSection, string> = {
  story: 'Story',
  voice: 'Voice Card',
  world: 'World Model seed',
  scenes: 'Scene Cards',
  publish: 'Publish',
};

export function isEditorSection(value: string | null | undefined): value is EditorSection {
  return typeof value === 'string' && (EDITOR_SECTIONS as readonly string[]).includes(value);
}

/**
 * Which section owns a lint problem's path.
 *
 * This is what makes the lint panel navigable rather than merely informative: every problem the
 * linter reports carries the path of the field that caused it, and the panel turns that path into
 * the one tap that gets the author to the control.
 */
export function sectionForPath(path: string): EditorSection {
  const head = path.split('.')[0] ?? '';
  if (head === 'world_model_seed') return 'world';
  if (head === 'scene_cards') return 'scenes';
  if (head === 'voice_card') return 'voice';
  if (head === 'package_version' || head === 'schema_version') return 'publish';
  return 'story';
}

// --- The World Model seed's five tables ---------------------------------------------------

export interface SeedTable {
  readonly table: TableName;
  /** The array that holds it in the envelope — the segment lint paths use. */
  readonly array: keyof WorldModelSeed;
  readonly label: string;
  /** The singular noun a button says: "Add a character". */
  readonly noun: string;
  /** The id prefix both fixtures use, so a minted id looks like a hand-authored one. */
  readonly prefix: string;
}

export const SEED_TABLES: readonly SeedTable[] = [
  { table: 'character', array: 'characters', label: 'Characters', noun: 'character', prefix: 'char' },
  { table: 'location', array: 'locations', label: 'Locations', noun: 'location', prefix: 'loc' },
  { table: 'object', array: 'objects', label: 'Objects', noun: 'object', prefix: 'obj' },
  {
    table: 'relationship',
    array: 'relationships',
    label: 'Relationships',
    noun: 'relationship',
    prefix: 'rel',
  },
  {
    table: 'character_knowledge',
    array: 'character_knowledge',
    label: 'Seeded knowledge',
    noun: 'known fact',
    prefix: 'know',
  },
];

export function seedTable(array: string): SeedTable | null {
  return SEED_TABLES.find((entry) => entry.array === array) ?? null;
}

/** The path the linter would use for a seed row, or one column of it. */
export function seedRowPath(array: string, id: string, column?: string): string {
  return ['world_model_seed', array, id, column].filter((part) => part !== undefined).join('.');
}

/**
 * The tier badge a column wears in the editor (ADR 0001 Principle 2).
 *
 * Shown beside the control rather than in a legend, so that asserting `goal` reads as the
 * volitional assertion it is *at the moment it is asserted* — not in documentation the author
 * consults afterwards, if ever.
 */
export function columnTier(table: TableName, column: string): Tier | null {
  return columnAuthority(table, column).tier;
}

export const TIER_TITLES: Record<Tier, string> = {
  P: 'physical — the engine writes this freely and auto-commits it',
  E: 'epistemic — the engine writes this freely and auto-commits it',
  V: 'volitional — the engine may only propose a change here; you decide',
};

// --- Minting ids the author never types ---------------------------------------------------

/** The slug shape every fixture id has, and the one `storyIdAvailable` accepts for a story. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/**
 * A fresh, unused entity id.
 *
 * Derived from the name where there is one, because `char_fairy_godmother` is the id both
 * fixtures would have used and an author reading a state row should recognize what they are
 * looking at. A bare counter is the fallback, never the first choice.
 */
export function mintEntityId(prefix: string, name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem = slugify(name);
  const base = stem === '' ? prefix : `${prefix}_${stem}`;
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * A seed as the editor holds it: draft rows, where every column but `id` may still be missing.
 *
 * Typed structurally rather than as `WorldModelSeed` because the relaxed schema is what a
 * half-written story parses as (ADR 0017 §2), and these readers only ever want an id and a name.
 */
export type SeedLike = Partial<
  Record<keyof WorldModelSeed, ReadonlyArray<{ id?: string; name?: string }>>
>;

/** Every entity id the seed defines, across all five tables. */
export function seedIds(seed: SeedLike): string[] {
  return SEED_TABLES.flatMap((table) => (seed[table.array] ?? []).map((row) => row.id ?? '')).filter(
    (id) => id !== '',
  );
}

// --- Pickers ------------------------------------------------------------------------------

export interface EntityChoice {
  readonly id: string;
  readonly label: string;
  readonly table: TableName;
}

/**
 * The options behind every id control on the screen.
 *
 * #18 measured that the errors hand-authoring produces are cross-reference errors, and a picker
 * over the seed cannot produce one. An id that is already in the package but names nothing — the
 * case a picker cannot prevent, because the row was deleted afterwards — is still in the list, so
 * the author sees what the reference points at rather than an empty select that looks broken.
 */
export function entityChoices(seed: SeedLike, tables: readonly TableName[]): EntityChoice[] {
  const choices: EntityChoice[] = [];
  for (const entry of SEED_TABLES) {
    if (!tables.includes(entry.table)) continue;
    for (const row of seed[entry.array] ?? []) {
      if (row.id === undefined || row.id === '') continue;
      choices.push({
        id: row.id,
        label: row.name === undefined || row.name === '' ? row.id : `${row.name} — ${row.id}`,
        table: entry.table,
      });
    }
  }
  return choices;
}

/**
 * A picker's options, plus the value it is currently holding when that value is not among them.
 *
 * A dangling reference must stay visible and stay selected: silently snapping it to the first
 * valid option would edit the story to make a lint error disappear.
 */
export function choicesIncluding(
  choices: readonly EntityChoice[],
  current: string | null | undefined,
): EntityChoice[] {
  if (current === null || current === undefined || current === '') return [...choices];
  if (choices.some((choice) => choice.id === current)) return [...choices];
  return [{ id: current, label: `${current} — not in the seed`, table: 'character' }, ...choices];
}

/** Scene choices for `learned_at_scene`, in Syuzhet order. */
export function sceneChoices(
  scenes: ReadonlyArray<{ id?: string; order?: number }>,
): EntityChoice[] {
  return [...scenes]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((scene) => scene.id !== undefined && scene.id !== '')
    .map((scene) => ({ id: scene.id as string, label: scene.id as string, table: 'character' }));
}

// --- Bags: flat key/value, enforced by the control ----------------------------------------

/**
 * The five shapes a bag value may take — `BagValueSchema` with a name per branch.
 *
 * There is no sixth for "object", and that absence *is* Principle 4's enforcement: a nested value
 * is not something the control can be persuaded to produce, so it is not something the author can
 * be warned about later.
 */
export const BAG_ROW_TYPES = ['text', 'number', 'boolean', 'list', 'empty'] as const;

export type BagRowType = (typeof BAG_ROW_TYPES)[number];

export const BAG_TYPE_LABELS: Record<BagRowType, string> = {
  text: 'text',
  number: 'number',
  boolean: 'true / false',
  list: 'list of text',
  empty: 'empty',
};

export interface BagRow {
  readonly key: string;
  readonly type: BagRowType;
  readonly value: BagValue;
}

export function bagRowType(value: BagValue): BagRowType {
  if (value === null) return 'empty';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'text';
}

export function bagRows(bag: Record<string, BagValue> | undefined): BagRow[] {
  return Object.entries(bag ?? {}).map(([key, value]) => ({
    key,
    type: bagRowType(value),
    value,
  }));
}

/** Re-type a value in place, keeping as much of what the author typed as the new type allows. */
export function coerceBagValue(value: BagValue, to: BagRowType): BagValue {
  switch (to) {
    case 'empty':
      return null;
    case 'text':
      return Array.isArray(value) ? value.join(', ') : value === null ? '' : String(value);
    case 'number': {
      const parsed = Number(Array.isArray(value) ? value[0] : value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return value.trim() !== '' && value.trim() !== 'false';
      if (typeof value === 'number') return value !== 0;
      return false;
    case 'list':
      if (Array.isArray(value)) return value;
      if (value === null) return [];
      return String(value)
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '');
  }
}

/**
 * Collapse the editor's rows back into a bag.
 *
 * Blank keys are dropped rather than written as `""`: a row the author added and has not named
 * yet is a row in progress, and persisting it would put an empty column into the package on the
 * next autosave, two seconds later.
 */
export function bagFromRows(rows: readonly BagRow[]): Record<string, BagValue> {
  const bag: Record<string, BagValue> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key === '') continue;
    bag[key] = row.value;
  }
  return BagSchema.parse(bag);
}

/** A bag's content as a comparable string, for the reconciliation below. */
export function bagSignature(bag: Record<string, BagValue> | undefined): string {
  const entries = Object.entries(bag ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

export interface BagDraft {
  /** The signature of the bag these rows produce. */
  readonly produced: string;
  readonly rows: BagRow[];
}

/**
 * Which rows a bag editor should show.
 *
 * A row the author has added but not named yet exists on screen and not in the package — that is
 * the whole point of dropping blank keys, since otherwise the autosave a second later writes an
 * empty column. So the editor keeps its own rows, and they win for exactly as long as the package
 * still holds what they produce. The moment the bag changes from anywhere else — a discard, a
 * reloaded draft, a different entity — the rows are rebuilt from it and the in-progress blank is
 * correctly lost with the edit it belonged to.
 */
export function reconcileBagRows(
  bag: Record<string, BagValue> | undefined,
  draft: BagDraft | null,
): BagRow[] {
  if (draft !== null && draft.produced === bagSignature(bag)) return draft.rows;
  return bagRows(bag);
}

// --- The Voice Card -----------------------------------------------------------------------

/** The seven single-line fields, in the order ADR 0007's rendering template reads them. */
export const VOICE_TEXT_FIELDS = [
  { field: 'person', label: 'Person', hint: 'third, first…' },
  { field: 'tense', label: 'Tense', hint: 'past, present…' },
  { field: 'narrative_distance', label: 'Narrative distance', hint: '' },
  { field: 'register', label: 'Register', hint: '' },
  { field: 'sentence_rhythm', label: 'Sentence rhythm', hint: '' },
  { field: 'dialogue_density', label: 'Dialogue density', hint: '' },
  {
    field: 'style_exemplar',
    label: 'Style exemplar',
    hint: 'calibration only — never content to reuse; leave blank if unsure',
  },
] as const satisfies ReadonlyArray<{ field: keyof VoiceCard; label: string; hint: string }>;

/**
 * Read a package's opaque `voice_card` block into a card the forms can hold.
 *
 * Deliberately more forgiving than `parseVoiceCard`: that one rejects an empty string where this
 * one has to render a brand-new story whose block is `{}` and a half-filled one nobody has
 * finished. The strict parse still happens — at publish, like every other strict parse (§2).
 */
export function draftVoiceCard(raw: Record<string, unknown> | undefined): VoiceCard {
  const block = raw ?? {};
  const text = (key: string): string => (typeof block[key] === 'string' ? block[key] : '');
  const preset = block['based_on'] ?? block['style_preset'];
  const palette = block['imagery_palette'];
  return {
    person: text('person'),
    tense: text('tense'),
    narrative_distance: text('narrative_distance'),
    register: text('register'),
    sentence_rhythm: text('sentence_rhythm'),
    imagery_palette: Array.isArray(palette)
      ? palette.filter((entry): entry is string => typeof entry === 'string')
      : [],
    dialogue_density: text('dialogue_density'),
    style_exemplar: text('style_exemplar'),
    based_on: typeof preset === 'string' ? preset : null,
  };
}

/**
 * The card, written back as the package's block — **all nine fields, always**.
 *
 * ADR 0007 decision 4: an override is fully materialized on the card, never a diff against the
 * preset. A later edit to a preset must not be able to change the voice of a story already using
 * it, mid-telling, and writing the whole card out is what makes that impossible rather than
 * merely unlikely.
 */
export function voiceCardBlock(card: VoiceCard): Record<string, unknown> {
  return {
    person: card.person,
    tense: card.tense,
    narrative_distance: card.narrative_distance,
    register: card.register,
    sentence_rhythm: card.sentence_rhythm,
    imagery_palette: [...card.imagery_palette],
    dialogue_density: card.dialogue_density,
    style_exemplar: card.style_exemplar,
    based_on: card.based_on,
  };
}

/** Applying a preset materializes all eight fields and records what it started from. */
export function applyPreset(id: string): VoiceCard {
  return cardFromPreset(id);
}

export function presetChoices(): Array<{ id: string; label: string }> {
  return STYLE_PRESETS.map((preset) => ({ id: preset.id, label: preset.display_name }));
}

/** Whether the card is still untouched — the state a new story's `{}` block starts in. */
export function voiceCardIsBlank(card: VoiceCard): boolean {
  return (
    card.based_on === null &&
    card.imagery_palette.length === 0 &&
    VOICE_TEXT_FIELDS.every((entry) => card[entry.field] === '')
  );
}

// --- Publishing, said before the author commits -------------------------------------------

export interface PublishReadiness {
  readonly ready: boolean;
  /** The version publishing would write — `max(retained) + 1`, never the author's arithmetic. */
  readonly nextVersion: number;
  readonly errors: number;
  readonly warnings: number;
  /**
   * Whether publishing will flag Working Draft scenes stale.
   *
   * True whenever the story has published before: a `package_version` bump propagates bluntly to
   * every compiled scene (ADR 0015 §3), and publish is the only write that bumps it (§3). A story
   * publishing for the first time has no draft to invalidate.
   */
  readonly willFlagStale: boolean;
}

export function publishReadiness(input: {
  nextVersion: number;
  errors: number;
  warnings: number;
  basedOnVersion: number | null;
}): PublishReadiness {
  return {
    ready: input.errors === 0,
    nextVersion: input.nextVersion,
    errors: input.errors,
    warnings: input.warnings,
    willFlagStale: input.basedOnVersion !== null,
  };
}

// --- Counting what the author has, for the section list -----------------------------------

export interface SectionCounts {
  readonly entities: number;
  readonly relationships: number;
  readonly scenes: number;
}

export function sectionCounts(pkg: DraftStoryPackage): SectionCounts {
  const seed = pkg.world_model_seed;
  return {
    entities:
      (seed.characters?.length ?? 0) + (seed.locations?.length ?? 0) + (seed.objects?.length ?? 0),
    relationships: (seed.relationships?.length ?? 0) + (seed.character_knowledge?.length ?? 0),
    scenes: pkg.scene_cards.length,
  };
}
