/**
 * Two cheap post-checks on a written scene (#201). Heuristics, not verdicts: each raises a
 * diagnostic for the run report and never triggers a retry.
 *
 * - **Tail echo.** The writer is shown the last paragraph the reader read so it can open without a
 *   seam. Panel batch 2026-09-29 caught it restating it instead: scene 2 of `01` ends "The great
 *   hand had failed." and scene 3 opens "The great hand had failed, rattling like dry lath…".
 * - **Tense.** The Voice Card's tense is stated once, in the stable header. `05`'s card said
 *   present, and three of its eighteen scenes came back in the past.
 */

/** Sentences of a prose passage, in order. Good enough for English narration; not a parser. */
export function sentencesOf(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+["'”’)]*|[^.!?]+$/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
}

function contentWords(sentence: string): string[] {
  return (sentence.toLowerCase().match(/[a-z’']+/g) ?? [])
    .map((word) => word.replace(/[’']/g, ''))
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

const STOPWORDS = new Set([
  'the', 'and', 'but', 'for', 'nor', 'yet', 'with', 'from', 'into', 'onto', 'upon', 'that',
  'this', 'these', 'those', 'then', 'than', 'had', 'has', 'have', 'was', 'were', 'are', 'his',
  'her', 'hers', 'its', 'their', 'them', 'they', 'she', 'him', 'you', 'your', 'not', 'all',
]);

/** Share of the tail sentence's content words a scene's opening sentence reuses, above which it echoes. */
export const TAIL_ECHO_THRESHOLD = 0.6;

/**
 * Whether the scene's first sentence restates the previous scene's last sentence: it reuses at
 * least `TAIL_ECHO_THRESHOLD` of that sentence's content words. `null` when there is nothing to
 * compare (no tail, or a tail sentence too short to judge).
 */
export function tailEcho(
  previousParagraph: string | null,
  prose: string,
): { overlap: number; tail: string; opening: string } | null {
  if (previousParagraph === null) return null;
  const tail = sentencesOf(previousParagraph).at(-1);
  const opening = sentencesOf(prose.trim().split(/\n\s*\n/)[0] ?? '')[0];
  if (tail === undefined || opening === undefined) return null;
  const tailWords = new Set(contentWords(tail));
  if (tailWords.size < 2) return null;
  const openingWords = new Set(contentWords(opening));
  const shared = [...tailWords].filter((word) => openingWords.has(word)).length;
  const overlap = shared / tailWords.size;
  return overlap >= TAIL_ECHO_THRESHOLD ? { overlap, tail, opening } : null;
}

/**
 * Finite-verb markers by tense. Deliberately a closed list of unambiguous forms — auxiliaries and
 * the commonest irregular verbs — plus regular `-ed` past forms; a bare `-s` form is as often a
 * plural noun as a present verb, so it is not counted.
 */
const PAST_MARKERS = new Set([
  'was', 'were', 'had', 'did', 'said', 'went', 'came', 'saw', 'took', 'made', 'knew', 'thought',
  'felt', 'stood', 'sat', 'told', 'found', 'gave', 'left', 'held', 'kept', 'began', 'brought',
  'heard', 'ran', 'turned', 'looked', 'seemed', 'asked', 'wanted', 'pulled', 'reached', 'stepped',
  'watched', 'waited', 'moved', 'opened', 'closed', 'nodded', 'smiled', 'lifted', 'pressed',
]);
const PRESENT_MARKERS = new Set([
  'is', 'are', 'am', 'has', 'does', 'says', 'goes', 'comes', 'sees', 'takes', 'makes', 'knows',
  'thinks', 'feels', 'stands', 'sits', 'tells', 'finds', 'gives', 'leaves', 'holds', 'keeps',
  'begins', 'brings', 'hears', 'runs', 'turns', 'looks', 'seems', 'asks', 'wants', 'pulls',
  'reaches', 'steps', 'watches', 'waits', 'moves', 'opens', 'closes', 'nods', 'smiles', 'lifts',
  'presses',
]);

/** Narration only: quoted dialogue is in whatever tense the speaker uses. */
export function narrationOf(prose: string): string {
  return prose.replace(/"[^"]*"|“[^”]*”/g, ' ');
}

export interface TenseProfile {
  readonly past: number;
  readonly present: number;
}

export function tenseProfile(prose: string): TenseProfile {
  let past = 0;
  let present = 0;
  for (const word of narrationOf(prose).toLowerCase().match(/[a-z]+/g) ?? []) {
    if (PAST_MARKERS.has(word)) past += 1;
    else if (PRESENT_MARKERS.has(word)) present += 1;
  }
  return { past, present };
}

/** Markers below which a scene is too short or too dialogue-heavy to judge. */
export const TENSE_MIN_MARKERS = 8;
/** Share of markers in the other tense above which the scene contradicts the Voice Card. */
export const TENSE_MISMATCH_SHARE = 0.6;

/**
 * The tense the narration mostly uses, when it contradicts the Voice Card's: `'past'` for a
 * present-tense card whose scene reads past, and the reverse. `null` when it agrees, when the card
 * names neither tense, or when there is too little narration to tell.
 */
export function tenseMismatch(
  prose: string,
  cardTense: string,
): { found: 'past' | 'present'; profile: TenseProfile } | null {
  const expected = cardTense.trim().toLowerCase();
  if (expected !== 'past' && expected !== 'present') return null;
  const profile = tenseProfile(prose);
  const total = profile.past + profile.present;
  if (total < TENSE_MIN_MARKERS) return null;
  const other = expected === 'past' ? profile.present : profile.past;
  if (other / total <= TENSE_MISMATCH_SHARE) return null;
  return { found: expected === 'past' ? 'present' : 'past', profile };
}
