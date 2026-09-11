/**
 * Recovering `prose` from a truncated response (ADR 0012 decision 5).
 *
 * `MAX_TOKENS` under a schema returns truncated, unparseable JSON with no partial-object recovery
 * from the API itself (Gemini research finding #5). Because `propertyOrdering` puts `prose` first,
 * the common failure shape is that prose completes and the digest/state_updates/diagnostics tail
 * gets cut — and the reader may already have streamed and read that prose. It cannot be un-shown,
 * so the recovery has to salvage the digest, not discard the scene.
 *
 * This is the same incremental JSON-string parse the streaming reader already needs, run once
 * more against the buffered final state: scan for the `prose` key, then read forward applying
 * string unescaping until the matching unescaped closing quote.
 */

export interface ProseSalvage {
  readonly prose: string;
  /** True when the closing quote was found — prose is complete, only the tail was cut. */
  readonly complete: boolean;
}

/**
 * Pull `prose` out of a possibly-truncated JSON buffer.
 *
 * Returns `null` only when the key itself never appeared, which means the cut landed before the
 * model wrote anything at all.
 */
export function salvageProse(buffer: string): ProseSalvage | null {
  const key = '"prose"';
  const keyAt = buffer.indexOf(key);
  if (keyAt === -1) return null;

  // Step past the key, its colon, and any whitespace, to the opening quote of the value.
  let index = keyAt + key.length;
  while (index < buffer.length && buffer[index] !== '"') {
    const char = buffer[index]!;
    if (char !== ':' && char.trim() !== '') return null;
    index += 1;
  }
  if (index >= buffer.length) return null;
  index += 1;

  const out: string[] = [];
  while (index < buffer.length) {
    const char = buffer[index]!;

    if (char === '\\') {
      const escape = buffer[index + 1];
      if (escape === undefined) break; // cut mid-escape; keep what we have
      index += 2;
      switch (escape) {
        case 'n':
          out.push('\n');
          break;
        case 't':
          out.push('\t');
          break;
        case 'r':
          out.push('\r');
          break;
        case 'b':
          out.push('\b');
          break;
        case 'f':
          out.push('\f');
          break;
        case 'u': {
          const hex = buffer.slice(index, index + 4);
          if (hex.length < 4) return { prose: out.join(''), complete: false };
          out.push(String.fromCharCode(Number.parseInt(hex, 16)));
          index += 4;
          break;
        }
        default:
          out.push(escape);
      }
      continue;
    }

    if (char === '"') {
      return { prose: out.join(''), complete: true };
    }

    out.push(char);
    index += 1;
  }

  return { prose: out.join(''), complete: false };
}

/**
 * Repair prose whose paragraph breaks arrived as the two characters `\` `n` rather than newlines.
 *
 * A writer call can escape its own output once too often, and the result is a scene the reader
 * sees as one wall of text with visible `\n\n` between every line of dialogue. It is worse than
 * cosmetic: `finalParagraph` and the continuity pass's `openingParagraph` both split on `\n\n`,
 * so on such prose they return the *whole scene* — which would let an opening-rewrite repair
 * replace an entire scene with one paragraph, the thing ADR 0011 §5 explicitly forbids.
 *
 * Normalizing once, where prose enters the compiler, is cheaper than defending in every consumer.
 * The guard is deliberate: only prose containing no real newline at all is touched, so a scene
 * that legitimately writes a backslash is left exactly as the writer wrote it.
 */
export function normalizeProse(prose: string): string {
  if (prose.includes('\n')) return prose;
  if (!/\\[nrt]/.test(prose)) return prose;
  return prose
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t');
}

/**
 * The final paragraph of a scene's prose — the verbatim tail the next scene opens against
 * (ADR 0008 decision 3).
 *
 * A paragraph, not a fixed word count, and deliberately not the digest's `closing_situation`,
 * which is a summary rather than the words the reader actually read.
 */
export function finalParagraph(prose: string): string | null {
  const paragraphs = prose
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const last = paragraphs[paragraphs.length - 1] ?? null;
  if (last === null) return null;
  if (paragraphs.length > 1) return last;
  // A scene that came back as one unbroken block (issue #73) has no final paragraph to speak of,
  // and handing the whole scene forward would make the verbatim tail the most expensive thing in
  // the volatile payload — then trim it from the front at the length backstop, so the next scene
  // opens against a fragment starting mid-sentence. Its closing sentences are the honest answer.
  return lastSentences(last);
}

/** The closing sentences of an unbroken block, up to a paragraph's worth. */
const UNBROKEN_TAIL_SENTENCES = 3;

function lastSentences(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+["'\u201d\u2019]?\s*/g);
  if (sentences === null || sentences.length <= UNBROKEN_TAIL_SENTENCES) return text;
  return sentences.slice(-UNBROKEN_TAIL_SENTENCES).join('').trim();
}

/** Word count against `length_budget`. ADR 0012 decision 4's band is 0.8x-1.3x, asymmetric. */
export function wordCount(prose: string): number {
  const words = prose.trim().match(/\S+/g);
  return words === null ? 0 : words.length;
}

export const LENGTH_BAND = { low: 0.8, high: 1.3 } as const;

/**
 * Whether a scene landed inside the tolerance band.
 *
 * Asymmetric on purpose: undershoot usually means a dropped beat, which is a variance-contract
 * miss, while overshoot only costs output budget.
 */
export function lengthVerdict(
  prose: string,
  budget: number | undefined,
): { words: number; ratio: number | null; verdict: 'ok' | 'under' | 'over' | 'unbudgeted' } {
  const words = wordCount(prose);
  if (budget === undefined || budget <= 0) {
    return { words, ratio: null, verdict: 'unbudgeted' };
  }
  const ratio = words / budget;
  if (ratio < LENGTH_BAND.low) return { words, ratio, verdict: 'under' };
  if (ratio > LENGTH_BAND.high) return { words, ratio, verdict: 'over' };
  return { words, ratio, verdict: 'ok' };
}
