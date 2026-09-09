/**
 * The Voice Card and its style presets (ADR 0007).
 *
 * Eight fields, five presets, and one rendering template. The card is always **fully
 * materialized** — selecting a preset copies all eight fields in, and editing one edits that
 * field in place (ADR 0007 decision 4). A sparse diff was rejected because resolving unset fields
 * against a shared preset at render time would let a later edit to that preset silently change
 * the voice of every story already using it, mid-telling.
 *
 * `based_on` exists only so a UI can label the card and offer a reset. It plays no part in
 * rendering, which only ever reads the materialized fields.
 */

import { z } from 'zod';

export const VoiceCardSchema = z.object({
  person: z.string().min(1),
  tense: z.string().min(1),
  narrative_distance: z.string().min(1),
  register: z.string().min(1),
  sentence_rhythm: z.string().min(1),
  imagery_palette: z.array(z.string().min(1)).default([]),
  dialogue_density: z.string().min(1),
  /** Empty by default. Rendered only when set; calibration only, never content to reuse. */
  style_exemplar: z.string().default(''),
  /** The preset this card started from, for labelling and reset. Never read when rendering. */
  based_on: z.string().nullable().default(null),
});

export type VoiceCard = z.infer<typeof VoiceCardSchema>;

export interface StylePreset {
  readonly id: string;
  readonly display_name: string;
  readonly card: Omit<VoiceCard, 'based_on'>;
}

/** The five presets validated in ADR 0007 decision 2. */
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
    },
  },
];

export function presetById(id: string): StylePreset | null {
  return STYLE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** Materialize a preset into a full card — decision 4's copy-all-eight-fields rule. */
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
 */
export function renderVoiceCard(card: VoiceCard): string {
  const lines = [
    'VOICE (story-level, stable across the whole telling):',
    `- Point of view: ${card.person}, ${card.tense} tense. Narrative distance: ${card.narrative_distance}.`,
    `- Register: ${card.register}`,
    `- Sentence rhythm: ${card.sentence_rhythm}`,
    `- Preferred imagery (draw from these before inventing new ones): ${card.imagery_palette.join('; ')}`,
    `- Dialogue: ${card.dialogue_density}`,
  ];
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
