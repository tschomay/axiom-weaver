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

import {
  rollUp,
  type LeveledDigest,
  type RollupSummary,
  type SceneDigest,
  sceneDigestEntry,
} from './scene-digest';

/** ADR 0008's prototyped window. A constant in code, per the ADR's own framing. */
export const DEFAULT_WINDOW = 4;

export type Summarizer = (window: LeveledDigest[]) => RollupSummary;

/**
 * A rollup summarizer that needs no model call.
 *
 * ADR 0003 decision 6 requires a *freshly synthesized* `event_summary`, which in production is a
 * `gemini-3.5-flash-lite` call. This stand-in concatenates and truncates instead: it keeps the
 * hierarchy's shape and growth characteristics honest without pretending to be synthesis. It is
 * the default only so a hierarchy can be exercised offline — a real run injects the model call.
 */
export const concatenatingSummarizer: Summarizer = (window) => ({
  event_summary: window
    .map((item) => item.digest.event_summary)
    .join(' ')
    .slice(0, 400),
});

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
  push(digest: SceneDigest, sceneId: string, sceneOrder: number): RollupEvent[] {
    const fired: RollupEvent[] = [];
    let carry: LeveledDigest | null = sceneDigestEntry(digest, sceneId, sceneOrder);
    let level = 0;

    while (carry !== null) {
      const band = this.bandAt(level);
      band.push(carry);
      carry = null;

      if (band.length >= this.window) {
        const rolled = rollUp(band, this.summarize);
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
