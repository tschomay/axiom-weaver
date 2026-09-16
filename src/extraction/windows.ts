/**
 * Bounded reading windows over the source prose.
 *
 * `docs/research/narrative-extraction-prior-art.md` §5 is the whole argument for this file:
 * NoCha puts whole-book global reasoning over fiction at or below chance, *Same Task, More
 * Tokens* measures accuracy falling 0.92 → 0.68 well before the context limit, and
 * Lost-in-the-Middle plus ConStory-Bench both put the damage in the *middle* of a long input. So
 * no pass in this pipeline ever sees the whole novel at once: prose is read in windows, and
 * every global step (§10's reconcile, chronology) runs over the extracted *structures* instead.
 *
 * Windows are paragraph-aligned because a span that starts mid-sentence is useless to a human
 * checking it, and they overlap by one paragraph because a beat that straddles a boundary is
 * otherwise seen by neither call — the cheapest possible insurance against a window edge
 * swallowing an event.
 */

export interface Paragraph {
  readonly index: number;
  /** Character offsets into the whole source text. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface ReadingWindow {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly first_paragraph: number;
  readonly last_paragraph: number;
  readonly words: number;
}

/** Split on blank lines, keeping every paragraph's absolute offsets into the source. */
export function paragraphsOf(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  // Tolerant of a stray `\r` even though `sliceLines` normalizes them: this function is exported
  // and a caller with its own text should not get a one-paragraph document for it.
  const pattern = /\n[ \t\r]*\n/g;
  let cursor = 0;
  let index = 0;

  const push = (start: number, end: number): void => {
    const raw = text.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed === '') return;
    paragraphs.push({
      index: index++,
      start: start + leading,
      end: start + leading + trimmed.length,
      text: trimmed,
    });
  };

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    push(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  push(cursor, text.length);

  return paragraphs;
}

export interface WindowOptions {
  /** Soft target; a window closes at the first paragraph boundary past it. */
  readonly target_words: number;
  /** Paragraphs of overlap with the previous window. */
  readonly overlap_paragraphs: number;
}

/**
 * 800 words, measured rather than guessed.
 *
 * The constraint that actually sets this is not context length — it is event *granularity*. A
 * 2,500-word window asked for an event list comes back with a dozen headline events and drops
 * the beats between them; the same prose in three windows comes back at roughly the grain the
 * fixture packages' `required_beats` are authored at, because each call has less to compress.
 * At 800 the two fixtures land at 4 and 38 windows respectively, which keeps every response
 * schema small (`gemini-capabilities.md` §1) and every call's prose well inside the range where
 * *Same Task, More Tokens* measures no length-driven degradation at all.
 */
export const DEFAULT_WINDOW_OPTIONS: WindowOptions = {
  target_words: 800,
  overlap_paragraphs: 1,
};

function wordsIn(text: string): number {
  const matched = text.match(/\S+/g);
  return matched === null ? 0 : matched.length;
}

export function windowsOf(
  text: string,
  options: WindowOptions = DEFAULT_WINDOW_OPTIONS,
): ReadingWindow[] {
  const paragraphs = paragraphsOf(text);
  if (paragraphs.length === 0) return [];

  const windows: ReadingWindow[] = [];
  let first = 0;

  while (first < paragraphs.length) {
    let words = 0;
    let last = first;
    while (last < paragraphs.length) {
      words += wordsIn(paragraphs[last]!.text);
      if (words >= options.target_words) break;
      last += 1;
    }
    if (last >= paragraphs.length) last = paragraphs.length - 1;

    const start = paragraphs[first]!.start;
    const end = paragraphs[last]!.end;
    windows.push({
      index: windows.length,
      start,
      end,
      text: text.slice(start, end),
      first_paragraph: first,
      last_paragraph: last,
      words,
    });

    if (last >= paragraphs.length - 1) break;
    // Step forward, then back up by the overlap — never past where this window began, or a
    // window that is a single long paragraph would loop forever.
    first = Math.max(first + 1, last + 1 - options.overlap_paragraphs);
  }

  return windows;
}
