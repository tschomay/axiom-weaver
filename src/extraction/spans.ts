/**
 * Span grounding: every extracted claim has to point at the prose that licenses it.
 *
 * This is the first thing the pipeline was built around, and the reason is
 * `docs/research/narrative-extraction-prior-art.md` §8: *"an ungroundable claim is a hallucination
 * by construction"*, with ConStory-Checker's "grounds each judgment in explicit textual evidence"
 * as the precedent. It needs no ground truth and no judge, and until it holds, every other number
 * is scoring how plausible the output looks rather than whether anything read the source.
 *
 * **The model is never asked for character offsets.** It is asked for a short verbatim quote, and
 * this module finds that quote in the source and computes the offsets itself. Two reasons, and
 * the second is the important one:
 *
 * 1. Offsets into a 170KB text are an arithmetic task nobody should hand a language model; a
 *    wrong number would then be scored as a grounding failure when the *claim* may be fine.
 * 2. A quote that cannot be found in the source is a strictly stronger failure signal than an
 *    offset that happens to land in range. Verbatim recall of the window it was just shown is the
 *    cheapest available proof that a claim came from reading rather than from world knowledge —
 *    and both fixtures are famous enough (the *Carol* especially, `fixture-stories.md`'s
 *    "regurgitation probe") that world knowledge alone would produce confident, plausible,
 *    ungrounded rows.
 *
 * Resolution is deliberately graded rather than boolean. An exact hit and a
 * whitespace-normalized hit are both honest groundings — Project Gutenberg plain text is
 * hard-wrapped, so a quote spanning a line break differs from the source only in a `\n`. Anything
 * looser than that is reported as its own outcome and never silently counted as grounded.
 */

export interface SourceSpan {
  readonly start: number;
  readonly end: number;
  /** The source's own text at `[start, end)` — not the model's rendering of it. */
  readonly text: string;
  readonly resolution: SpanResolution;
}

export const SPAN_RESOLUTIONS = ['exact', 'normalized', 'unresolved'] as const;
export type SpanResolution = (typeof SPAN_RESOLUTIONS)[number];

export interface SpanClaim {
  /** What is being asserted, in one line, for a judge or a human to check against the span. */
  readonly claim: string;
  /** `character:char_scrooge.status`, `event:ev_0007`, `relationship:rel_003` … */
  readonly subject: string;
  readonly quote: string;
  readonly span: SourceSpan | null;
}

/** Collapse runs of whitespace so a hard-wrapped quote matches the prose it was copied from. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Locate a quote in the source and return its span, preferring a hit inside the window the quote
 * came from.
 *
 * `within` is the window's `[start, end)`. A quote is searched there first because a common
 * phrase ("Merry Christmas") occurs dozens of times in the *Carol*, and the occurrence that
 * grounds the claim is the one the extracting call was looking at. Falling back to a whole-text
 * search keeps a quote that straddled the window edge groundable, at the cost of possibly
 * naming the wrong occurrence — which is why the fallback is recorded in the result.
 */
export function resolveQuote(
  source: string,
  quote: string,
  within?: { start: number; end: number },
): SourceSpan | null {
  const trimmed = quote.trim();
  if (trimmed === '') return null;

  const ranges: Array<{ start: number; end: number }> = [];
  if (within !== undefined) ranges.push(within);
  ranges.push({ start: 0, end: source.length });

  for (const range of ranges) {
    const haystack = source.slice(range.start, range.end);

    const exact = haystack.indexOf(trimmed);
    if (exact !== -1) {
      return {
        start: range.start + exact,
        end: range.start + exact + trimmed.length,
        text: trimmed,
        resolution: 'exact',
      };
    }

    const normalized = findNormalized(haystack, trimmed);
    if (normalized !== null) {
      return {
        start: range.start + normalized.start,
        end: range.start + normalized.end,
        text: haystack.slice(normalized.start, normalized.end),
        resolution: 'normalized',
      };
    }
  }

  return null;
}

/**
 * Find `needle` in `haystack` ignoring differences in whitespace runs, and map the hit back to
 * offsets in the original (un-normalized) haystack.
 */
function findNormalized(haystack: string, needle: string): { start: number; end: number } | null {
  const wantedText = normalizeWhitespace(needle);
  if (wantedText === '') return null;

  // Build the normalized haystack alongside a map from each normalized index to a source index.
  let normalized = '';
  const sourceIndex: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < haystack.length; i += 1) {
    const char = haystack[i]!;
    if (/\s/.test(char)) {
      pendingSpace = normalized.length > 0;
      continue;
    }
    if (pendingSpace) {
      normalized += ' ';
      sourceIndex.push(i);
      pendingSpace = false;
    }
    normalized += char;
    sourceIndex.push(i);
  }

  const at = normalized.indexOf(wantedText);
  if (at === -1) return null;

  const start = sourceIndex[at]!;
  const lastIndex = sourceIndex[at + wantedText.length - 1]!;
  return { start, end: lastIndex + 1 };
}

export interface GroundingReport {
  readonly total: number;
  readonly exact: number;
  readonly normalized: number;
  readonly unresolved: number;
  /** `(exact + normalized) / total` — the §3.2-first number the ticket asks for. */
  readonly grounded_rate: number;
  readonly ungrounded: ReadonlyArray<{ subject: string; claim: string; quote: string }>;
}

export function groundingReport(claims: readonly SpanClaim[]): GroundingReport {
  let exact = 0;
  let normalized = 0;
  const ungrounded: Array<{ subject: string; claim: string; quote: string }> = [];

  for (const claim of claims) {
    if (claim.span === null) {
      ungrounded.push({ subject: claim.subject, claim: claim.claim, quote: claim.quote });
      continue;
    }
    if (claim.span.resolution === 'exact') exact += 1;
    else normalized += 1;
  }

  const total = claims.length;
  return {
    total,
    exact,
    normalized,
    unresolved: ungrounded.length,
    grounded_rate: total === 0 ? 0 : (exact + normalized) / total,
    ungrounded,
  };
}
