/**
 * The judged half of the rubric.
 *
 * Protocol, from `docs/agents/story-authoring-eval.md` §4.2 (stated there for generated arcs, but
 * it is the project's one judge protocol and §3 needs judgments too): use `WRITER_MODEL`, never
 * `gemini-3.5-flash-lite`, and record the judge model in the result. Every function here takes
 * its own `ExtractionModel`, so the judge is configured separately from the extractor and the two
 * are never silently the same call budget.
 *
 * **What the judge is and is not shown.** Every judgment below is made against a *bounded
 * excerpt* — the span the pipeline grounded a claim in, plus surrounding context, or the story's
 * opening window — never against the whole novel. That is not a shortcut, it is the same §5
 * constraint the extractor lives under: a judge asked to rule on a claim against 28,000 words is
 * subject to the identical lost-in-the-middle degradation, and NoCha puts whole-book true/false
 * claim verification over fiction at 55.8% for the best model measured. A judgment made against
 * a named 1,500-character window is one a human can re-check in seconds; a judgment made against
 * a novel is one nobody can audit. The cost is real and is stated in the result: the judge can
 * say a claim is unsupported *here* when the support is elsewhere, so "unsupported" is reported
 * separately from "contradicted" and never merged into it.
 */

import { z } from 'zod';

import type { ExtractionModel } from '../call';
import { ExtractionCallError } from '../call';
import type { SourceSpan } from '../spans';

/** How much prose either side of a span the judge sees. */
export const JUDGE_CONTEXT_CHARS = 800;

export function contextAround(source: string, span: SourceSpan): string {
  const start = Math.max(0, span.start - JUDGE_CONTEXT_CHARS);
  const end = Math.min(source.length, span.end + JUDGE_CONTEXT_CHARS);
  return source.slice(start, end);
}

// --- Span support -----------------------------------------------------------------------

export const SUPPORT_VERDICTS = ['supports', 'insufficient', 'contradicts'] as const;
export type SupportVerdict = (typeof SUPPORT_VERDICTS)[number];

const SupportResponseSchema = z.object({
  verdicts: z
    .array(
      z.object({
        subject: z.string(),
        verdict: z.enum(SUPPORT_VERDICTS),
        why: z.string().default(''),
      }),
    )
    .default([]),
});

const SUPPORT_SYSTEM = `For each item you are given a CLAIM, the QUOTE an extractor said supports
it, and the SURROUNDING PROSE that quote sits in.

Answer, per item:
- "supports" — the quote, read in its surrounding prose, states or plainly entails the claim.
- "insufficient" — the prose neither establishes nor denies the claim. Use this when the claim
  might well be true elsewhere in the story; you are only judging this excerpt.
- "contradicts" — the prose says something incompatible with the claim.

Be strict about "supports". A claim that merely sounds consistent with the excerpt is
"insufficient". Judge only the excerpt in front of you; never your own knowledge of the story.`;

function supportJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'Copied from the item, verbatim.' },
            verdict: { type: 'string', enum: [...SUPPORT_VERDICTS] },
            why: { type: 'string', description: 'One short clause.' },
          },
          required: ['subject', 'verdict', 'why'],
          propertyOrdering: ['subject', 'verdict', 'why'],
        },
      },
    },
    required: ['verdicts'],
  };
}

export interface SupportItem {
  readonly subject: string;
  readonly claim: string;
  readonly quote: string;
  readonly context: string;
}

export interface SupportJudgment {
  readonly subject: string;
  readonly verdict: SupportVerdict;
  readonly why: string;
}

export async function judgeSpanSupport(
  judge: ExtractionModel,
  items: readonly SupportItem[],
  options: { batchSize?: number } = {},
): Promise<{ verdicts: SupportJudgment[]; unjudged: string[] }> {
  const batchSize = options.batchSize ?? 8;
  const verdicts: SupportJudgment[] = [];
  const unjudged: string[] = [];

  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    const contents = batch
      .map(
        (item, index) =>
          [
            `ITEM ${index + 1}`,
            `subject: ${item.subject}`,
            `CLAIM: ${item.claim}`,
            `QUOTE: ${item.quote}`,
            'SURROUNDING PROSE:',
            '"""',
            item.context,
            '"""',
          ].join('\n'),
      )
      .join('\n\n---\n\n');

    try {
      const response = await judge.json(SupportResponseSchema, {
        pass: 'judge.span_support',
        label: `items ${start}–${start + batch.length - 1}`,
        systemInstruction: SUPPORT_SYSTEM,
        contents,
        responseJsonSchema: supportJsonSchema(),
        maxOutputTokens: 2048,
      });
      const bySubject = new Map(response.verdicts.map((entry) => [entry.subject, entry]));
      for (const item of batch) {
        const verdict = bySubject.get(item.subject);
        if (verdict === undefined) {
          unjudged.push(item.subject);
          continue;
        }
        verdicts.push({ subject: item.subject, verdict: verdict.verdict, why: verdict.why });
      }
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      unjudged.push(...batch.map((item) => item.subject));
    }
  }

  return { verdicts, unjudged };
}

// --- Entity alignment -------------------------------------------------------------------

const AlignResponseSchema = z.object({
  pairs: z
    .array(
      z.object({
        fixture_id: z.string(),
        candidate_id: z.string().nullable(),
        why: z.string().default(''),
      }),
    )
    .default([]),
});

const ALIGN_SYSTEM = `You align two lists of World Model rows extracted from the same story by two
different authors. Slugs will not match ("fairy_godmother" vs "godmother"); names may differ in
wording ("the King's son" vs "the Prince").

For each FIXTURE row, name the ONE candidate row that denotes the same person, place or thing, or
null if no candidate row does.

- Align on identity, not on wording. "the gentleman-in-waiting" and "the Prince's messenger" are
  the same role in the same story.
- A candidate row covering a GROUP the fixture also models as one row aligns. A candidate row
  covering one member of a group the fixture merged does NOT align to it unless nothing better
  does — say so in why.
- Never use one candidate id for two fixture rows. If two fixture rows compete for one candidate,
  give it to the better match and null the other.
- Do not align a location to a character, or an object to a location.`;

function alignJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      pairs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fixture_id: { type: 'string' },
            candidate_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            why: { type: 'string', description: 'One short clause.' },
          },
          required: ['fixture_id', 'candidate_id', 'why'],
          propertyOrdering: ['fixture_id', 'candidate_id', 'why'],
        },
      },
    },
    required: ['pairs'],
  };
}

export interface AlignRow {
  readonly id: string;
  readonly name: string;
  readonly note: string;
}

export async function judgeAlignment(
  judge: ExtractionModel,
  table: string,
  fixtureRows: readonly AlignRow[],
  candidateRows: readonly AlignRow[],
): Promise<Array<{ fixture_id: string; candidate_id: string | null; why: string }>> {
  if (fixtureRows.length === 0 || candidateRows.length === 0) {
    return fixtureRows.map((row) => ({ fixture_id: row.id, candidate_id: null, why: 'no candidates' }));
  }

  const render = (rows: readonly AlignRow[]): string =>
    rows.map((row) => `${row.id} = ${row.name}${row.note === '' ? '' : ` — ${row.note}`}`).join('\n');

  try {
    const response = await judge.json(AlignResponseSchema, {
      pass: 'judge.alignment',
      label: table,
      systemInstruction: ALIGN_SYSTEM,
      contents: `TABLE: ${table}\n\nFIXTURE ROWS:\n${render(fixtureRows)}\n\nCANDIDATE ROWS:\n${render(candidateRows)}`,
      responseJsonSchema: alignJsonSchema(),
      maxOutputTokens: 4096,
      thinkingLevel: 'MEDIUM',
    });

    const candidateIds = new Set(candidateRows.map((row) => row.id));
    const used = new Set<string>();
    const byFixture = new Map(response.pairs.map((pair) => [pair.fixture_id, pair]));
    return fixtureRows.map((row) => {
      const pair = byFixture.get(row.id);
      const candidate = pair?.candidate_id ?? null;
      if (candidate === null || !candidateIds.has(candidate) || used.has(candidate)) {
        return { fixture_id: row.id, candidate_id: null, why: pair?.why ?? 'unaligned' };
      }
      used.add(candidate);
      return { fixture_id: row.id, candidate_id: candidate, why: pair?.why ?? '' };
    });
  } catch (error) {
    if (!(error instanceof ExtractionCallError)) throw error;
    return fixtureRows.map((row) => ({
      fixture_id: row.id,
      candidate_id: null,
      why: 'alignment call failed',
    }));
  }
}

// --- Event entailment -------------------------------------------------------------------

const EntailResponseSchema = z.object({
  matches: z
    .array(
      z.object({
        truth_id: z.string(),
        candidate_id: z.string().nullable(),
      }),
    )
    .default([]),
});

const ENTAIL_SYSTEM = `You are given a list of GROUND-TRUTH beats from a story and, under each
beat, the CANDIDATE events most likely to correspond to it — extracted from the same story by a
machine.

For each ground-truth beat, name the ONE candidate event that reports the same happening, or null
if none does.

- Judge entailment, not wording. A candidate reporting the same happening in different words
  matches. A candidate reporting a different happening in the same vocabulary does not.
- The candidates are usually at FINER grain than the beat: a beat may describe three things
  happening and a candidate only one of them. That still matches, as long as the candidate covers
  part of what the beat describes. Do not require a candidate to cover the whole beat.
- One candidate may match at most one beat. If two beats compete, give it to the better match.`;

function entailJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            truth_id: { type: 'string' },
            candidate_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          required: ['truth_id', 'candidate_id'],
          propertyOrdering: ['truth_id', 'candidate_id'],
        },
      },
    },
    required: ['matches'],
  };
}

/**
 * How many candidate events a beat is shown, after the lexical shortlist.
 *
 * This number exists because of a measured harness failure, not a guess. Scored against the
 * whole candidate list, *A Christmas Carol* returned 9.6% event recall over 394 candidates while
 * Cinderella returned 58.5% over 54 — from the same extractor, on the same day. That gap is the
 * judge losing the match in a long list, which is `narrative-extraction-prior-art.md` §5's
 * lost-in-the-middle showing up inside the *evaluation* rather than the extraction, and a
 * measurement that degrades with the size of what it measures is not a measurement.
 *
 * The shortlist has its own ceiling and it is stated rather than hidden: if the true match is not
 * in a beat's top `ENTAIL_SHORTLIST` by content-word overlap, the beat is scored as missed even
 * though the extractor found it. `shortlist_ceiling` in the result is that bound.
 */
export const ENTAIL_SHORTLIST = 25;

const ENTAIL_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'is', 'it', 'his', 'her', 'their',
  'he', 'she', 'they', 'him', 'them', 'that', 'this', 'with', 'for', 'as', 'by', 'from', 'but',
  'not', 'no', 'who', 'what', 'has', 'have', 'had', 'been', 'was', 'were', 'are', 'be', 'one',
]);

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 2 && !ENTAIL_STOP_WORDS.has(token));
}

/**
 * Rank candidates for one beat by shared content words, weighted towards rarer words.
 *
 * Deliberately a dumb lexical scorer rather than an embedding: it is auditable, deterministic,
 * free, and its job is only to cut 394 down to 25 so the judge is making a judgment instead of a
 * search. The judge still decides every match.
 */
export function shortlistCandidates(
  beat: string,
  candidates: ReadonlyArray<{ id: string; summary: string }>,
  documentFrequency: ReadonlyMap<string, number>,
  limit: number = ENTAIL_SHORTLIST,
): Array<{ id: string; summary: string }> {
  const wanted = new Set(contentTokens(beat));
  const total = candidates.length || 1;
  const scored = candidates.map((candidate) => {
    let score = 0;
    for (const token of new Set(contentTokens(candidate.summary))) {
      if (!wanted.has(token)) continue;
      const frequency = documentFrequency.get(token) ?? 1;
      score += Math.log(1 + total / frequency);
    }
    return { candidate, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

export function documentFrequencies(
  candidates: ReadonlyArray<{ summary: string }>,
): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const candidate of candidates) {
    for (const token of new Set(contentTokens(candidate.summary))) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  return frequency;
}

export async function judgeEventEntailment(
  judge: ExtractionModel,
  truth: ReadonlyArray<{ id: string; text: string }>,
  candidates: ReadonlyArray<{ id: string; summary: string }>,
  options: { batchSize?: number; shortlist?: number } = {},
): Promise<Map<string, string | null>> {
  const batchSize = options.batchSize ?? 6;
  const limit = options.shortlist ?? ENTAIL_SHORTLIST;
  const matches = new Map<string, string | null>();
  const candidateIds = new Set(candidates.map((event) => event.id));
  const used = new Set<string>();
  const frequency = documentFrequencies(candidates);

  for (let start = 0; start < truth.length; start += batchSize) {
    const batch = truth.slice(start, start + batchSize);
    const listing = batch
      .map((beat) => {
        const shortlist = shortlistCandidates(beat.text, candidates, frequency, limit);
        const options = shortlist
          .map((candidate) => `    ${candidate.id}: ${candidate.summary}`)
          .join('\n');
        return `${beat.id}: ${beat.text}\n  candidates:\n${options}`;
      })
      .join('\n\n');
    try {
      const response = await judge.json(EntailResponseSchema, {
        pass: 'judge.event_entailment',
        label: `beats ${start}–${start + batch.length - 1}`,
        systemInstruction: ENTAIL_SYSTEM,
        contents: `GROUND-TRUTH BEATS, each with its candidate shortlist:\n\n${listing}`,
        responseJsonSchema: entailJsonSchema(),
        maxOutputTokens: 2048,
        thinkingLevel: 'MEDIUM',
      });
      const byTruth = new Map(response.matches.map((match) => [match.truth_id, match.candidate_id]));
      for (const beat of batch) {
        const candidate = byTruth.get(beat.id) ?? null;
        if (candidate === null || !candidateIds.has(candidate) || used.has(candidate)) {
          matches.set(beat.id, null);
          continue;
        }
        used.add(candidate);
        matches.set(beat.id, candidate);
      }
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      for (const beat of batch) matches.set(beat.id, null);
    }
  }

  return matches;
}

// --- Seed attribute verdicts ------------------------------------------------------------

export const ATTRIBUTE_VERDICTS = [
  'supported_at_start',
  'true_later_not_at_start',
  'contradicted',
  'insufficient',
] as const;
export type AttributeVerdict = (typeof ATTRIBUTE_VERDICTS)[number];

const AttributeResponseSchema = z.object({
  verdicts: z
    .array(
      z.object({
        subject: z.string(),
        verdict: z.enum(ATTRIBUTE_VERDICTS),
        why: z.string().default(''),
      }),
    )
    .default([]),
});

const ATTRIBUTE_SYSTEM = `You check World Model seed values against a story's own text.

The seed states what is true AT THE MOMENT THE STORY OPENS, before its first event. You are given
the story's OPENING, and — where the extractor cited one — the passage it drew the value from.

Per item, answer:
- "supported_at_start" — the opening establishes this value as true when the story opens.
- "true_later_not_at_start" — the value is true of this entity somewhere in the story, but NOT at
  the opening. This is the specific error being counted; use it whenever the cited passage is
  plainly from later in the story than the opening.
- "contradicted" — the text says something incompatible with this value at the opening.
- "insufficient" — the excerpts do not settle it either way.

"insufficient" is a real answer and is expected often. Do not reach for "contradicted" when you
merely cannot confirm something.`;

function attributeJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'Copied from the item, verbatim.' },
            verdict: { type: 'string', enum: [...ATTRIBUTE_VERDICTS] },
            why: { type: 'string' },
          },
          required: ['subject', 'verdict', 'why'],
          propertyOrdering: ['subject', 'verdict', 'why'],
        },
      },
    },
    required: ['verdicts'],
  };
}

export interface AttributeItem {
  readonly subject: string;
  readonly entity: string;
  readonly column: string;
  readonly value: string;
  readonly cited: string;
}

export interface AttributeJudgment {
  readonly subject: string;
  readonly verdict: AttributeVerdict;
  readonly why: string;
}

export async function judgeSeedAttributes(
  judge: ExtractionModel,
  opening: string,
  items: readonly AttributeItem[],
  options: { batchSize?: number } = {},
): Promise<{ verdicts: AttributeJudgment[]; unjudged: string[] }> {
  const batchSize = options.batchSize ?? 10;
  const verdicts: AttributeJudgment[] = [];
  const unjudged: string[] = [];

  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    const listing = batch
      .map(
        (item, index) =>
          [
            `ITEM ${index + 1}`,
            `subject: ${item.subject}`,
            `entity: ${item.entity}`,
            `seed value: ${item.column} = ${item.value}`,
            `passage the extractor cited: ${item.cited === '' ? '(none)' : item.cited}`,
          ].join('\n'),
      )
      .join('\n\n');

    try {
      const response = await judge.json(AttributeResponseSchema, {
        pass: 'judge.seed_attributes',
        label: `items ${start}–${start + batch.length - 1}`,
        systemInstruction: ATTRIBUTE_SYSTEM,
        contents: `THE STORY'S OPENING:\n"""\n${opening}\n"""\n\nITEMS:\n${listing}`,
        responseJsonSchema: attributeJsonSchema(),
        maxOutputTokens: 3072,
        thinkingLevel: 'MEDIUM',
      });
      const bySubject = new Map(response.verdicts.map((entry) => [entry.subject, entry]));
      for (const item of batch) {
        const verdict = bySubject.get(item.subject);
        if (verdict === undefined) {
          unjudged.push(item.subject);
          continue;
        }
        verdicts.push({ subject: item.subject, verdict: verdict.verdict, why: verdict.why });
      }
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      unjudged.push(...batch.map((item) => item.subject));
    }
  }

  return { verdicts, unjudged };
}
