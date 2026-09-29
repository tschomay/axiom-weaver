/**
 * The phrase ledger: repetition the imagery ledger cannot see (#220, ADR 0010's second 2026-09-29
 * amendment).
 *
 * #195 rested over-used palette *domains*, and the palette stopped being any story's top prose
 * finding. What replaced it in the #204 re-run was repetition below the level of imagery: 11 of
 * Understudy's 19 scenes opened on a list of what the place smells of; "grease-burn scars along her
 * jaw" tagged Teresa in six scenes; a chisel sat "against her ribs" about ten times. A per-scene
 * writer cannot see any of that.
 *
 * Two records, both cheap and both built from each scene's *own* prose as the run advances — the
 * same in-memory prose `RunState.advance` already reads for the verbatim tail, never re-read later:
 *
 * - **Openings**: each scene's first sentence, shown so the next scene opens differently.
 * - **Worn phrases**: word trigrams with at least two content words that have now appeared in
 *   `WORN_PHRASE_SCENES` or more scenes — a character tag, a recycled gesture.
 */

/** Scenes a trigram must appear in before it is called worn. */
export const WORN_PHRASE_SCENES = 3;
/** Openings shown to the next scene. */
export const OPENINGS_SHOWN = 3;
/** Worn phrases shown, most widespread first. */
export const WORN_PHRASES_SHOWN = 8;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from',
  'into', 'onto', 'upon', 'as', 'that', 'this', 'it', 'its', 'was', 'were', 'is', 'are', 'be', 'been',
  'had', 'has', 'have', 'he', 'she', 'his', 'her', 'him', 'they', 'their', 'them', 'i', 'you', 'we',
  'not', 'no', 'so', 'then', 'than', 'there', 'what', 'who', 'which', 'if', 'all', 'one', 'said',
]);

export interface RecordedPhrases {
  readonly scene_order: number;
  /** The scene's first sentence, trimmed. */
  readonly opening: string;
  /** Distinct trigrams in the scene's narration, lower-cased. */
  readonly trigrams: ReadonlySet<string>;
}

export interface PhraseLedger {
  readonly recent_openings: string[];
  /** Worn trigrams with the number of scenes they appear in, most widespread first. */
  readonly worn: Array<{ phrase: string; scenes: number }>;
}

function firstSentence(prose: string): string {
  const text = prose.trim().replace(/\s+/g, ' ');
  const match = /^.*?[.!?]["'”’)]*(?=\s|$)/.exec(text);
  const sentence = (match?.[0] ?? text).trim();
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}

/** Narration only; dialogue repeats for reasons of its own. */
function narration(prose: string): string {
  return prose.replace(/"[^"]*"|“[^”]*”/g, ' ');
}

const NUMBER_WORDS = new Set([
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred',
  'thousand',
]);

/**
 * Distinct trigrams of the narration. A capitalised word (a name, a place) or a number word keeps a
 * trigram out: "St Jude's" and "seven hundred and" recur because the story is about them, not as a
 * tic.
 */
export function trigramsOf(prose: string): Set<string> {
  const words = (narration(prose).match(/[A-Za-z']+/g) ?? []).map((word) => word.replace(/^'+|'+$/g, ''));
  const grams = new Set<string>();
  for (let at = 0; at + 3 <= words.length; at += 1) {
    const raw = words.slice(at, at + 3);
    if (raw.some((word) => word === '' || /^[A-Z]/.test(word))) continue;
    const gram = raw.map((word) => word.toLowerCase());
    if (gram.some((word) => NUMBER_WORDS.has(word))) continue;
    if (gram.filter((word) => !STOPWORDS.has(word)).length < 2) continue;
    grams.add(gram.join(' '));
  }
  return grams;
}

/** The content words of the World Model's names, so a named object's name is never "worn". */
export function nameWords(names: readonly string[]): Set<string> {
  return new Set(
    names.flatMap((name) => (name.toLowerCase().match(/[a-z']+/g) ?? []).filter((word) => !STOPWORDS.has(word))),
  );
}

export function recordPhrases(prose: string, sceneOrder: number): RecordedPhrases {
  return { scene_order: sceneOrder, opening: firstSentence(prose), trigrams: trigramsOf(prose) };
}

export function buildPhraseLedger(
  history: readonly RecordedPhrases[],
  options: { readonly namedWords?: ReadonlySet<string> } = {},
): PhraseLedger {
  const named = options.namedWords ?? new Set<string>();
  // Two named content words is a name in context ("the blue notebook", "blue notebook slowly").
  const isName = (gram: string): boolean =>
    gram.split(' ').filter((word) => !STOPWORDS.has(word) && named.has(word)).length >= 2;
  const counts = new Map<string, number>();
  for (const entry of history) {
    for (const gram of entry.trigrams) {
      if (isName(gram)) continue;
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  const worn = [...counts]
    .filter(([, scenes]) => scenes >= WORN_PHRASE_SCENES)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([phrase, scenes]) => ({ phrase, scenes }));
  // A worn four-word phrase shows up as two overlapping trigrams; keep the first of each overlap.
  const kept: Array<{ phrase: string; scenes: number }> = [];
  for (const entry of worn) {
    const [a, b] = entry.phrase.split(' ');
    if (kept.some((other) => other.phrase.endsWith(`${a} ${b}`) || other.phrase.startsWith(`${a} ${b}`))) continue;
    kept.push(entry);
    if (kept.length >= WORN_PHRASES_SHOWN) break;
  }
  const ordered = [...history].sort((a, b) => a.scene_order - b.scene_order);
  return {
    recent_openings: ordered.slice(-OPENINGS_SHOWN).map((entry) => entry.opening).filter((text) => text !== ''),
    worn: kept,
  };
}

export function renderPhraseLedger(ledger: PhraseLedger): string {
  const lines: string[] = [];
  if (ledger.recent_openings.length > 0) {
    lines.push('RECENT SCENE OPENINGS (open this scene with a different kind of sentence — not the same move again):');
    for (const opening of ledger.recent_openings) lines.push(`  - "${opening}"`);
  }
  if (ledger.worn.length > 0) {
    lines.push(
      'WORN PHRASES (already used in several scenes — find another way to say it, or leave it out): ' +
        ledger.worn.map((entry) => `"${entry.phrase}" (${entry.scenes} scenes)`).join('; '),
    );
  }
  return lines.join('\n');
}

/** Every name the package's World Model seed gives a character, place or object. */
export function seedNames(pkg: {
  readonly world_model_seed: {
    readonly characters: ReadonlyArray<{ name: string }>;
    readonly locations: ReadonlyArray<{ name: string }>;
    readonly objects: ReadonlyArray<{ name: string }>;
  };
}): string[] {
  const seed = pkg.world_model_seed;
  return [...seed.characters, ...seed.locations, ...seed.objects].map((row) => row.name);
}
