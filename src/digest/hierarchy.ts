/**
 * The zoom-level digest hierarchy (ADR 0008 decisions 1 and 7).
 *
 * Every level holds at most `W` items. Pushing a Scene Digest onto level 0 cascades upward
 * exactly like carrying a digit in base-`W` counting: the instant a level reaches `W` items they
 * all roll up into one item appended to the next level, and the level is cleared. This is what
 * makes the prompt's digest band grow logarithmically with book length rather than linearly —
 * the fixed two-level scheme `CONTEXT.md` originally described does not.
 *
 * Levels are compiler-internal resolution windows sized by scene count, deliberately *not* the
 * authored book's chapter breaks (ADR 0008 decision 2).
 */

import { z } from 'zod';
import {
  TWO_SENTENCE_CHARS,
  levelName,
  rollUp,
  type LeveledDigest,
  type RollupSummary,
  type SceneDigest,
  sceneDigestEntry,
} from './scene-digest';
import { FALLBACK_MODEL, type ModelClient } from '../writer/model-client';

/** ADR 0008's prototyped window. A constant in code, per the ADR's own framing. */
export const DEFAULT_WINDOW = 4;

export type Summarizer = (window: LeveledDigest[]) => RollupSummary | Promise<RollupSummary>;

/**
 * A rollup summarizer that needs no model call.
 *
 * ADR 0003 decision 6 requires a *freshly synthesized* `event_summary`; `modelSummarizer` below is
 * that. This one concatenates and truncates instead, which keeps the hierarchy's shape and growth
 * characteristics honest without pretending to be synthesis. It is the default so a hierarchy can
 * be exercised offline, and the fallback when a synthesis call fails — never what a run with a
 * client uses by omission, which is what it had quietly become.
 */
export const concatenatingSummarizer: Summarizer = (window) => ({
  event_summary: window
    .map((item) => item.digest.event_summary)
    .join(' ')
    .slice(0, 400),
});

/**
 * The rollup summarizer ADR 0003 decision 6 actually specifies: a fresh synthesis of the window,
 * on the cheap model (`gemini-3.5-flash-lite`, the research's §7 split), never a concatenation.
 *
 * Worth spelling out why this is not an optimisation. The digest hierarchy is the compiler's whole
 * long-range memory, and a concatenation that is then truncated to `TWO_SENTENCE_CHARS` keeps only
 * the beginning of the earliest scene in its window. Roll that up again and the level above keeps
 * the beginning of *that* — so past the first window a telling's account of its own earlier
 * chapters is a truncated prefix rather than a summary. Which is precisely what ADR 0003 decision 6
 * means by "or growth stops being logarithmic".
 *
 * The cost is bounded by construction (ADR 0008 §7): one call per `W` scenes at level 0→1, one per
 * `W²` at 1→2, so rollups get exponentially rarer as the book lengthens. And it never touches the
 * writer models' quota, which is the scarce one.
 *
 * A failed call falls back to the concatenation rather than failing the scene — a rollup is not
 * load-bearing enough to stop a telling, and the run report records the call either way.
 */
export function modelSummarizer(
  client: ModelClient,
  options: { model?: string; onCall?: (call: RollupCall) => void } = {},
): Summarizer {
  const model = options.model ?? FALLBACK_MODEL;
  return async (window) => {
    try {
      const response = await client.generate({
        model,
        systemInstruction: '',
        contents: rollupPrompt(window),
        responseJsonSchema: ROLLUP_RESPONSE_SCHEMA,
        maxOutputTokens: ROLLUP_MAX_OUTPUT_TOKENS,
        thinkingLevel: 'LOW',
      });
      options.onCall?.({
        model: response.model,
        finish_reason: response.finish_reason,
        prompt_tokens: response.usage.prompt_tokens,
        output_tokens: response.usage.output_tokens,
        cached_tokens: response.usage.cached_tokens,
        thoughts_tokens: response.usage.thoughts_tokens,
      });
      const parsed = RollupResponseSchema.safeParse(JSON.parse(response.text));
      if (parsed.success && parsed.data.event_summary.trim() !== '') {
        return { event_summary: parsed.data.event_summary };
      }
    } catch {
      // Fall through to the concatenation.
    }
    return concatenatingSummarizer(window);
  };
}

/** What a rollup call cost, in the shape the run report's per-scene call list already uses. */
export interface RollupCall {
  readonly model: string;
  readonly finish_reason: string;
  readonly prompt_tokens: number;
  readonly output_tokens: number;
  readonly cached_tokens: number;
  readonly thoughts_tokens: number;
}

const ROLLUP_MAX_OUTPUT_TOKENS = 512;

const RollupResponseSchema = z.object({ event_summary: z.string() });

const ROLLUP_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    event_summary: {
      type: 'string',
      maxLength: TWO_SENTENCE_CHARS,
      description:
        'One or two sentences covering the whole window as a single movement of the story — ' +
        'freshly written, never the scene summaries pasted together.',
    },
  },
  required: ['event_summary'],
  propertyOrdering: ['event_summary'],
};

/**
 * What the synthesis call is shown: the window's own summaries and where it sits.
 *
 * Nothing else. A rollup is a compression of digests, and feeding it prose would defeat the point
 * of having digests at all (ADR 0011's "working on abstractions is what lets it scale").
 */
export function rollupPrompt(window: readonly LeveledDigest[]): string {
  const orders = window.flatMap((item) => item.scene_orders);
  const first = orders[0] ?? 0;
  const last = orders[orders.length - 1] ?? 0;
  const level = (window[0]?.level ?? 0) + 1;

  const lines = [
    `You are compressing scenes ${first}-${last} of a novel into one ${levelName(level)} Digest.`,
    'Write a single freshly-composed summary of the whole stretch as one movement of the story —',
    'what changed across it, not a list of what each part contained. Do not paste the summaries',
    'below together; they are your source, not your output. One or two sentences.',
    '',
  ];
  for (const item of window) {
    const span =
      item.scene_orders.length === 1
        ? `scene ${item.scene_orders[0]}`
        : `scenes ${item.scene_orders[0]}-${item.scene_orders[item.scene_orders.length - 1]}`;
    lines.push(`- ${span}: ${item.digest.event_summary}`);
  }
  lines.push('', `It ends: ${window[window.length - 1]?.digest.closing_situation ?? ''}`);
  return lines.join('\n');
}

export interface RollupEvent {
  /** The level whose window filled and was cleared. */
  readonly from_level: number;
  readonly to_level: number;
  readonly scene_orders: number[];
}

/**
 * The digest bands, level 0 upward.
 *
 * `bands[0]` holds open Scene Digests, `bands[1]` open Chapter Digests, and so on. A band is
 * append-only until it fills; it resets to empty exactly when it rolls up, which is the point at
 * which the implicit prefix cache is spliced at that band's position.
 */
export class DigestHierarchy {
  readonly window: number;
  private readonly summarize: Summarizer;
  private readonly bands: LeveledDigest[][] = [[]];
  private readonly events: RollupEvent[] = [];

  constructor(window: number = DEFAULT_WINDOW, summarize: Summarizer = concatenatingSummarizer) {
    if (window < 2) throw new Error(`Digest window must be at least 2, got ${window}`);
    this.window = window;
    this.summarize = summarize;
  }

  /** Push one Scene Digest and cascade every rollup it triggers. Returns those rollups. */
  async push(digest: SceneDigest, sceneId: string, sceneOrder: number): Promise<RollupEvent[]> {
    const fired: RollupEvent[] = [];
    let carry: LeveledDigest | null = sceneDigestEntry(digest, sceneId, sceneOrder);
    let level = 0;

    while (carry !== null) {
      const band = this.bandAt(level);
      band.push(carry);
      carry = null;

      if (band.length >= this.window) {
        const rolled = await rollUp(band, this.summarize);
        const event: RollupEvent = {
          from_level: level,
          to_level: level + 1,
          scene_orders: [...rolled.scene_orders],
        };
        fired.push(event);
        this.events.push(event);
        band.length = 0;
        carry = rolled;
        level += 1;
      }
    }

    return fired;
  }

  private bandAt(level: number): LeveledDigest[] {
    while (this.bands.length <= level) this.bands.push([]);
    return this.bands[level]!;
  }

  /** The deepest level currently holding anything, or 0 for an empty hierarchy. */
  deepestOpenLevel(): number {
    for (let level = this.bands.length - 1; level >= 0; level -= 1) {
      if (this.bands[level]!.length > 0) return level;
    }
    return 0;
  }

  rollupEvents(): RollupEvent[] {
    return [...this.events];
  }

  /**
   * Every open digest in payload order: coarsest first, oldest first within a level.
   *
   * ADR 0008 decision 3 — Book Digests, then Part, then Chapter, then open Scene Digests. This
   * order is the whole cache mechanism: the band is append-only in exactly this sequence, so a
   * later scene's prompt shares a byte-identical prefix with the previous one's.
   */
  inPayloadOrder(): LeveledDigest[] {
    const ordered: LeveledDigest[] = [];
    for (let level = this.bands.length - 1; level >= 0; level -= 1) {
      ordered.push(...this.bands[level]!);
    }
    return ordered;
  }

  /** Total digests currently held across all levels — the size the prompt actually pays for. */
  size(): number {
    return this.bands.reduce((total, band) => total + band.length, 0);
  }
}
