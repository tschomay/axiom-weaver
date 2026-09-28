/**
 * The Voice Card and its style presets (ADR 0007).
 *
 * Nine fields, six presets, and one rendering template. The card is always **fully
 * materialized** — selecting a preset copies every field in, and editing one edits that
 * field in place (ADR 0007 decision 4). A sparse diff was rejected because resolving unset fields
 * against a shared preset at render time would let a later edit to that preset silently change
 * the voice of every story already using it, mid-telling.
 *
 * `based_on` exists only so a UI can label the card and offer a reset. It plays no part in
 * rendering, which only ever reads the materialized fields.
 */

import { z } from 'zod';

export const VoiceCardSchema = z.object({
  // Blank (not `.min(1)`) on purpose: a story with no Voice Card at all — the state every new
  // Manuscript starts in (`envelope()` in `authoring/manuscript.ts` writes `voice_card: {}`) — is
  // a legitimate, publishable package (the editor's own copy says so: "A story publishes fine
  // without a Voice Card ... every scene will be written in whatever voice the model reaches
  // for"). Rejecting a blank field here would make that promise false everywhere this schema
  // gates a real write — the read-time run loop, an author-time compile, and the stand-in writer
  // all parse the *whole* package's card unconditionally, not only at publish.
  person: z.string().default(''),
  tense: z.string().default(''),
  narrative_distance: z.string().default(''),
  register: z.string().default(''),
  sentence_rhythm: z.string().default(''),
  imagery_palette: z.array(z.string().min(1)).default([]),
  dialogue_density: z.string().default(''),
  /** Empty by default. Rendered only when set; calibration only, never content to reuse. */
  style_exemplar: z.string().default(''),
  /**
   * Who the reader is and what they already know — how to handle specialist vocabulary (#182,
   * ADR 0007's 2026-09-28 amendment). Rendered only when set, so a card written before the field
   * existed renders exactly as it did.
   */
  reader_familiarity: z.string().default(''),
  /** The preset this card started from, for labelling and reset. Never read when rendering. */
  based_on: z.string().nullable().default(null),
});

export type VoiceCard = z.infer<typeof VoiceCardSchema>;

/** The text fields whose blankness (with no preset and no imagery) makes a card blank. */
const VOICE_CARD_TEXT_FIELDS = [
  'person',
  'tense',
  'narrative_distance',
  'register',
  'sentence_rhythm',
  'dialogue_density',
  'style_exemplar',
  'reader_familiarity',
] as const satisfies ReadonlyArray<keyof VoiceCard>;

/** Whether the card is still untouched — the state a new story's `{}` block starts in. */
export function voiceCardIsBlank(card: VoiceCard): boolean {
  return (
    card.based_on === null &&
    card.imagery_palette.length === 0 &&
    VOICE_CARD_TEXT_FIELDS.every((field) => card[field] === '')
  );
}

export interface StylePreset {
  readonly id: string;
  readonly display_name: string;
  readonly card: Omit<VoiceCard, 'based_on'>;
}

/**
 * The default `reader_familiarity` every preset carries (#182): a reader who knows nothing about
 * the story's specialist world gets a light guidepost the first time a deep term appears.
 */
export const DEFAULT_READER_FAMILIARITY =
  'The first time a deep term appears (domain-specific jargon), let dialogue or narration make ' +
  'its meaning clear within a clause. Never lecture.';

/**
 * The five presets validated in ADR 0007 decision 2, plus Suspense / Taut — added for generated
 * mysteries (#182) and not yet put through that decision's side-by-side prototype.
 */
export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: 'fairy_tale_fable',
    display_name: 'Fairy-Tale / Fable',
    card: {
      person: 'third',
      tense: 'past',
      narrative_distance: 'omniscient, close-focused on the protagonist',
      register: 'plain, warmly ironic, folk-narrator; understates cruelty and wonder alike',
      sentence_rhythm: 'short declarative sentences; occasional triads (rule-of-three lists)',
      imagery_palette: ['hearth and ash', 'finery and brocade', 'glass and candlelight'],
      dialogue_density: 'low to moderate; the narrator reports more than it stages',
      style_exemplar: '',
      reader_familiarity: DEFAULT_READER_FAMILIARITY,
    },
  },
  {
    id: 'gothic_brooding',
    display_name: 'Gothic / Brooding',
    card: {
      person: 'third',
      tense: 'past',
      narrative_distance: 'close third, pressed against the protagonist',
      register: 'grave, ornate, foreboding; dwells where a plainer voice would move on',
      sentence_rhythm: 'long accreting sentences broken by a short one that lands like a door',
      imagery_palette: ['damp stone and rot', 'guttering light', 'cold weight and enclosure'],
      dialogue_density: 'low; speech arrives rarely and carries weight when it does',
      style_exemplar: '',
      reader_familiarity: DEFAULT_READER_FAMILIARITY,
    },
  },
  {
    id: 'whimsical_playful',
    display_name: 'Whimsical / Playful',
    card: {
      person: 'third',
      tense: 'past',
      narrative_distance: 'omniscient and openly amused, willing to address the reader',
      register: 'light, digressive, fond of its own asides',
      sentence_rhythm: 'springy sentences with parenthetical swerves; frequent dashes',
      imagery_palette: ['kitchen clutter', 'weather with opinions', 'animals behaving as people'],
      dialogue_density: 'high; characters talk over each other and the narrator enjoys it',
      style_exemplar: '',
      reader_familiarity: DEFAULT_READER_FAMILIARITY,
    },
  },
  {
    id: 'hardboiled_terse',
    display_name: 'Hardboiled / Terse',
    card: {
      person: 'first',
      tense: 'past',
      narrative_distance: 'first person, tight, withholding',
      register: 'flat, wry, unsentimental; never names a feeling it can imply',
      sentence_rhythm: 'short. clipped. verbs before adjectives, and few adjectives',
      imagery_palette: ['cheap rooms and worse coffee', 'rain on asphalt', 'money and its smell'],
      dialogue_density: 'high; the scene is mostly what people say and refuse to say',
      style_exemplar: '',
      reader_familiarity: DEFAULT_READER_FAMILIARITY,
    },
  },
  {
    id: 'lyrical_literary',
    display_name: 'Lyrical / Literary',
    card: {
      person: 'third',
      tense: 'present',
      narrative_distance: 'close third, drifting into free indirect style',
      register: 'attentive, unhurried, alert to small physical detail',
      sentence_rhythm: 'clauses that turn and qualify; commas doing the work of pauses',
      imagery_palette: ['light on water', 'hands and their small work', 'weather as mood'],
      dialogue_density: 'moderate; speech is embedded in narration rather than set apart',
      style_exemplar: '',
      reader_familiarity: DEFAULT_READER_FAMILIARITY,
    },
  },
  {
    id: 'suspense_taut',
    display_name: 'Suspense / Taut',
    card: {
      person: 'third',
      tense: 'past',
      narrative_distance: 'close third, locked to the viewpoint character; knows only what they know',
      register: 'alert, concrete, quietly tense; lets a detail sit wrong before explaining it',
      sentence_rhythm:
        'lean sentences that tighten as pressure builds; a short line to land each discovery',
      imagery_palette: ['cold water and weather', 'worn machinery under strain', 'small wrong details'],
      dialogue_density: 'moderate to high; people talk around what they are hiding',
      style_exemplar: '',
      reader_familiarity: DEFAULT_READER_FAMILIARITY,
    },
  },
];

/**
 * The preset Generate starts a story's Voice Card from, by plot shape (#182).
 *
 * A generated package used to ship `voice_card: {}`, so the writer got no voice guidance at all.
 * The mapping only picks a starting point — the card is materialized in full (decision 4) and is
 * the author's to edit like any other. First-person Hardboiled is never picked: segmentation
 * chooses POV per scene, and a first-person narrator who changes from scene to scene reads wrong.
 */
const PRESET_BY_PLOT_SHAPE: Readonly<Record<string, string>> = {
  mystery: 'suspense_taut',
  reckoning: 'gothic_brooding',
  transformation: 'lyrical_literary',
  quest: 'fairy_tale_fable',
  courtship: 'whimsical_playful',
};

export function defaultVoiceCardForPlotShape(plotShapeId: string | null | undefined): VoiceCard {
  return cardFromPreset(PRESET_BY_PLOT_SHAPE[plotShapeId ?? ''] ?? 'suspense_taut');
}

export function presetById(id: string): StylePreset | null {
  return STYLE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** Materialize a preset into a full card — decision 4's copy-every-field rule. */
export function cardFromPreset(id: string): VoiceCard {
  const preset = presetById(id);
  if (preset === null) throw new Error(`Unknown style preset "${id}"`);
  return { ...preset.card, based_on: preset.id };
}

/** How a UI names a card: the preset's name, marked when any field has been edited. */
export function cardLabel(card: VoiceCard): string {
  if (card.based_on === null) return 'Custom';
  const preset = presetById(card.based_on);
  if (preset === null) return 'Custom';
  const modified = (Object.keys(preset.card) as Array<keyof StylePreset['card']>).some((field) => {
    // A card materialized before `reader_familiarity` existed has it blank; that is not an edit.
    if (field === 'reader_familiarity' && card[field] === '') return false;
    const mine = card[field];
    const theirs = preset.card[field];
    return Array.isArray(mine) || Array.isArray(theirs)
      ? JSON.stringify(mine) !== JSON.stringify(theirs)
      : mine !== theirs;
  });
  return modified ? `${preset.display_name} (modified)` : preset.display_name;
}

/**
 * Parse a Story Package's opaque `voice_card` block into a card.
 *
 * The envelope carries the block loosely (its field shape was issue #11's to settle, after the
 * schema was written), and the fixtures spell `style_preset` where this module says `based_on`.
 * Both are accepted here rather than editing the fixtures, which are not this ticket's to change.
 */
export function parseVoiceCard(raw: Record<string, unknown>): VoiceCard {
  const preset = raw['based_on'] ?? raw['style_preset'] ?? null;
  return VoiceCardSchema.parse({
    ...raw,
    based_on: typeof preset === 'string' ? preset : null,
  });
}

/**
 * The Voice Card block, rendered per ADR 0007 decision 3.
 *
 * A flat attribute list reads as description, not instruction; pairing each field with concrete
 * texture is what produced the differentiation the prototype measured. The scene's own tone is
 * deliberately *not* rendered here — ADR 0007 decision 5 keeps tone textually separate so it
 * modulates within the voice instead of editing it, and ADR 0012 decision 2 puts the tone line in
 * the volatile tail, on the far side of a cache boundary from this block.
 *
 * A blank card (`voiceCardIsBlank`) renders as `''` rather than a block full of empty sentences
 * ("Point of view: , tense.") — the assembler's header already drops empty segments
 * (`context-assembler.ts`'s `.filter((block) => block !== '')`), so an unfilled Voice Card simply
 * leaves no voice instruction in the prompt, matching what the editor tells an author to expect.
 */
export function renderVoiceCard(card: VoiceCard): string {
  if (voiceCardIsBlank(card)) return '';

  const lines = [
    'VOICE (story-level, stable across the whole telling):',
    `- Point of view: ${card.person}, ${card.tense} tense. Narrative distance: ${card.narrative_distance}.`,
    `- Register: ${card.register}`,
    `- Sentence rhythm: ${card.sentence_rhythm}`,
    `- Imagery domains (draw fresh images from within these before inventing new ones; they are` +
      ` domains to draw from, never phrases to reuse verbatim): ${card.imagery_palette.join('; ')}`,
    `- Dialogue: ${card.dialogue_density}`,
  ];
  if (card.reader_familiarity.trim() !== '') {
    lines.push(`- Reader: ${card.reader_familiarity}`);
  }
  if (card.style_exemplar.trim() !== '') {
    lines.push(
      `- Exemplar, for calibration only — do not reuse its content: "${card.style_exemplar}"`,
    );
  }
  return lines.join('\n');
}

/**
 * The scene's tone block (ADR 0007 decision 3's second half).
 *
 * Rendered in the volatile tail, immediately after the imagery ledger, per ADR 0012 decision 2.
 */
export function renderSceneTone(tone: string | undefined): string {
  if (tone === undefined || tone.trim() === '') return '';
  return [
    'SCENE TONE (this scene only — shapes emphasis and imagery selection, never overrides the voice above):',
    tone,
  ].join('\n');
}
