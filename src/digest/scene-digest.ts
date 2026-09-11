/**
 * The Scene Digest — the only thing that circulates in long-range context.
 *
 * Field set is ADR 0003 decision 2, extended by ADR 0009 decision 8 (`reanchor_used`) and
 * reshaped by ADR 0010 decision 2 (`imagery_signature` entries carry a domain tag). Every field
 * ties to a seam-failure rubric mode (ADR 0002) or a named consumer — a field earns its place by
 * making some failure detectable, so nothing here is added speculatively.
 *
 * The caps in ADR 0003 decision 5 are enforced by the schema itself rather than by prompt
 * wording, because the schema is what the model is decoded against.
 */

import { z } from 'zod';

/** ADR 0003 decision 5: "≤ ~2 sentences". A character cap is the mechanical proxy for that. */
export const TWO_SENTENCE_CHARS = 400;

/**
 * A two-sentence field, capped by trimming rather than by rejection.
 *
 * The cap is enforced on the wire too (`writerResponseJsonSchema` carries the same `maxLength`),
 * which is where it belongs: there it constrains decoding instead of judging the result. This
 * side is the backstop, and a backstop that *rejected* would throw away a whole scene of good
 * prose over a summary four hundred and ten characters long — the response would fail to parse,
 * spend a digest-only fallback call, and if that summary ran long too the scene would land on
 * `scene_generation_failed` and mark the run degraded. ADR 0003 decision 5's cap is a token
 * budget, not a correctness invariant: no field is ever dropped wholesale, but trimming one back
 * to its stated size loses nothing a reader sees.
 */
const cappedSentences = z
  .string()
  .transform((text) => (text.length <= TWO_SENTENCE_CHARS ? text : trimToCap(text)));

/** Cut at the cap, then back off to the last sentence end, or failing that the last word. */
function trimToCap(text: string): string {
  const cut = text.slice(0, TWO_SENTENCE_CHARS);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > TWO_SENTENCE_CHARS / 2) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(' ');
  return `${(word > TWO_SENTENCE_CHARS / 2 ? cut.slice(0, word) : cut).trimEnd()}…`;
}

export const IMAGERY_SIGNATURE_CAP = 3;

/**
 * ADR 0009 decision 3's three bands, plus `introduce` for a first-ever appearance.
 *
 * ADR 0009 folds never-touched into `reintroduce` for *instruction* purposes ("the same
 * instruction in both cases"), but the writer still self-reports what it did, and a first
 * introduction is a distinguishable thing to have done. Keeping the fourth value lets the
 * continuity pass tell "met them for the first time" from "re-met them after 40 scenes" without
 * re-deriving it from the told-ledger.
 */
export const REANCHOR_BANDS = ['introduce', 'assume', 'reanchor', 'reintroduce'] as const;
export type ReanchorBand = (typeof REANCHOR_BANDS)[number];

/**
 * One recorded image and the Voice Card `imagery_palette` domain it was drawn from.
 *
 * ADR 0010 decisions 2/3: the writer self-tags at emission time, so the ledger can tell a
 * licensed motif (same domain, new phrasing) from lazy repetition (same phrasing) with a
 * tag-equality check — no fuzzy matching, no extra call. `domain: null` marks an ad hoc image
 * outside the palette.
 */
export const ImagerySignatureSchema = z.object({
  image: z.string().min(1),
  domain: z.string().min(1).nullable(),
});

export const ReanchorUsedSchema = z.object({
  entity_id: z.string().min(1),
  band: z.enum(REANCHOR_BANDS),
});

export const SceneDigestSchema = z.object({
  event_summary: cappedSentences,
  entities_on_stage: z.array(z.string().min(1)).default([]),
  facts_revealed: z.array(z.string().min(1)).default([]),
  plants_opened: z.array(z.string().min(1)).default([]),
  payoffs_closed: z.array(z.string().min(1)).default([]),
  imagery_signature: z.array(ImagerySignatureSchema).max(IMAGERY_SIGNATURE_CAP).default([]),
  /** Where the scene leaves things, physically *and emotionally*. */
  closing_situation: cappedSentences,
  /** ADR 0009 decision 8 — self-reported, never independently re-verified against the prose. */
  reanchor_used: z.array(ReanchorUsedSchema).default([]),
});

export type ImagerySignature = z.infer<typeof ImagerySignatureSchema>;
export type ReanchorUsed = z.infer<typeof ReanchorUsedSchema>;
export type SceneDigest = z.infer<typeof SceneDigestSchema>;

/**
 * A digest plus where it sits in the telling.
 *
 * Level 0 is a Scene Digest; a rollup at level L covers the window its children span (ADR 0008
 * decision 1). `scene_orders` is what lets a rollup name its window when it renders.
 */
export interface LeveledDigest {
  readonly level: number;
  readonly digest: SceneDigest;
  /** Scene `order` values covered, ascending. A Scene Digest covers exactly one. */
  readonly scene_orders: number[];
  readonly scene_ids: string[];
}

export function sceneDigestEntry(
  digest: SceneDigest,
  sceneId: string,
  sceneOrder: number,
): LeveledDigest {
  return { level: 0, digest, scene_orders: [sceneOrder], scene_ids: [sceneId] };
}

/** `CONTEXT.md`'s names for levels 0-2; ADR 0008 decision 1 introduces Book `L3+`. */
export function levelName(level: number): string {
  if (level === 0) return 'Scene';
  if (level === 1) return 'Chapter';
  if (level === 2) return 'Part';
  return `Book L${level}`;
}

/** What a rollup call has to produce. Kept separate so the synthesis step can be injected. */
export interface RollupSummary {
  readonly event_summary: string;
}

/**
 * Roll a full window up into one digest of the next level (ADR 0003 decision 6).
 *
 * `event_summary` is *freshly synthesized*, never concatenated — concatenation is exactly what
 * stops growth being logarithmic. Synthesis is a cheap model call in production
 * (`gemini-3.5-flash-lite`, per the research's §7 split); `summarize` is that call, injected so
 * the shape of a rollup stays testable without one.
 *
 * Asynchronous because that call is: a rollup is the one place in the hierarchy that reaches the
 * model, and pretending otherwise is what left the synthesis unwired for as long as it was.
 */
export async function rollUp(
  window: LeveledDigest[],
  summarize: (window: LeveledDigest[]) => RollupSummary | Promise<RollupSummary>,
): Promise<LeveledDigest> {
  const last = window[window.length - 1];
  if (last === undefined) {
    throw new Error('Cannot roll up an empty window');
  }

  const union = (pick: (digest: SceneDigest) => string[]): string[] => {
    const seen = new Set<string>();
    for (const item of window) for (const value of pick(item.digest)) seen.add(value);
    return [...seen];
  };

  const summary = await summarize(window);

  return {
    level: last.level + 1,
    scene_orders: window.flatMap((item) => item.scene_orders),
    scene_ids: window.flatMap((item) => item.scene_ids),
    digest: {
      event_summary: summary.event_summary,
      entities_on_stage: union((digest) => digest.entities_on_stage),
      facts_revealed: union((digest) => digest.facts_revealed),
      plants_opened: union((digest) => digest.plants_opened),
      payoffs_closed: union((digest) => digest.payoffs_closed),
      imagery_signature: recapImagery(window),
      // Not aggregated: a point-in-time fact, so it inherits the window's last scene.
      closing_situation: last.digest.closing_situation,
      // A band is a per-scene decision about one moment; a window has no single band to report.
      reanchor_used: [],
    },
  };
}

/** Union then re-cap to 3 by recency — ADR 0003 decision 6, over `{image, domain}` pairs. */
function recapImagery(window: LeveledDigest[]): ImagerySignature[] {
  const kept: ImagerySignature[] = [];
  const seen = new Set<string>();
  for (let i = window.length - 1; i >= 0 && kept.length < IMAGERY_SIGNATURE_CAP; i -= 1) {
    const entries = window[i]!.digest.imagery_signature;
    for (let j = entries.length - 1; j >= 0 && kept.length < IMAGERY_SIGNATURE_CAP; j -= 1) {
      const entry = entries[j]!;
      const key = `${entry.image}\u0000${entry.domain ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.unshift(entry);
    }
  }
  return kept;
}
