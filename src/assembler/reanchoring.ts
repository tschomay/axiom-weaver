/**
 * Re-anchoring policy — introduce, assume, or remind (ADR 0009).
 *
 * Without a decision function the writer either re-explains everything every time it appears
 * ("Marcus, the getaway driver", told for the fourth time) or assumes too much and loses the
 * reader. The function is `scenes_since_last_touch` modulated by `centrality`, both of which the
 * told-ledger already keys on — no new state, no words-elapsed counter, no entity-kind taxonomy
 * duplicating what `centrality` encodes.
 *
 * Scope boundary, deliberate and not a gap: **plot facts are not covered here.** They stay owned
 * by `reader_must_learn` / `must_stay_hidden` (ADR 0006), which already give the writer an
 * explicit per-scene instruction; overlaying a decay band would produce two instructions that
 * could disagree. Only entities present in the scene get a band.
 */

import type { ReanchorBand } from '../digest/scene-digest';
import type { Centrality, ToldLedger } from '../digest/told-ledger';
import { metFact } from '../digest/told-ledger';

/**
 * ADR 0009 decision 3's cutoffs. Tunable constants living in code, not the schema — the ADR is
 * explicit that the shape is the decision and the numbers are a starting point.
 */
export const BAND_CUTOFFS: Record<Centrality, { assume: number; reanchor: number }> = {
  high: { assume: 5, reanchor: 40 },
  medium: { assume: 3, reanchor: 15 },
  low: { assume: 1, reanchor: 6 },
};

export interface BandDecision {
  readonly entity_id: string;
  /** Display name, so the instruction reads as prose rather than as slugs. */
  readonly name: string;
  readonly centrality: Centrality;
  /** `null` when the entity has never been touched — an infinite gap. */
  readonly scenes_since_last_touch: number | null;
  readonly band: ReanchorBand;
  /** True when a Scene Card's `force_reintroduce` overrode the computed band. */
  readonly forced: boolean;
}

/**
 * The band for one entity at one scene.
 *
 * `reintroduce` covers both a first-ever mention and an entity that has decayed past the
 * `reanchor` band — ADR 0009 gives them the same instruction rather than two. This module still
 * reports `introduce` for the never-touched case in the *decision*, because the two are
 * distinguishable facts and the digest's `reanchor_used` can carry the difference; both render
 * with the same instruction text below.
 */
export function bandFor(
  centrality: Centrality,
  scenesSinceLastTouch: number | null,
): ReanchorBand {
  if (scenesSinceLastTouch === null) return 'introduce';
  const cutoffs = BAND_CUTOFFS[centrality];
  if (scenesSinceLastTouch <= cutoffs.assume) return 'assume';
  if (scenesSinceLastTouch <= cutoffs.reanchor) return 'reanchor';
  return 'reintroduce';
}

export interface ReanchorInput {
  /** Entities present in the scene, by ADR 0008 §4's deterministic join. */
  readonly entityIds: readonly string[];
  readonly sceneOrder: number;
  readonly ledger: ToldLedger;
  /** Scene Card `force_reintroduce` (ADR 0009 decision 7). */
  readonly forceReintroduce: readonly string[];
  readonly nameOf: (entityId: string) => string | null;
}

export function reanchorDecisions(input: ReanchorInput): BandDecision[] {
  const forced = new Set(input.forceReintroduce);
  // The override is authored against fact_refs, so it may name either the entity or its met: fact.
  const isForced = (entityId: string) => forced.has(entityId) || forced.has(metFact(entityId));

  return input.entityIds.map((entityId) => {
    const row = input.ledger.row(metFact(entityId));
    const centrality = input.ledger.centralityOf(metFact(entityId));
    const gap = row === null ? null : input.sceneOrder - row.last_touched_scene;
    const computed = bandFor(centrality, gap);
    return {
      entity_id: entityId,
      name: input.nameOf(entityId) ?? entityId,
      centrality,
      scenes_since_last_touch: gap,
      band: isForced(entityId) ? 'reintroduce' : computed,
      forced: isForced(entityId),
    };
  });
}

/**
 * The craft rule for each band (ADR 0009 decision 6).
 *
 * A light re-anchor is a *distinguishing clause*, not a re-explanation — "her brother's ring, the
 * one from the pawnshop", not a restated sentence explaining what the ring is and why it matters.
 * ADR 0009 owns the rule; this is where it gets embedded in the actual prompt.
 */
export function bandInstruction(band: ReanchorBand): string {
  switch (band) {
    case 'assume':
      return 'established — assume the reader knows them, no re-explanation';
    case 'reanchor':
      return 'reanchor lightly — one distinguishing clause, not a restated explanation';
    case 'reintroduce':
      return 'reintroduce — the reader needs to be placed again, as if newly met';
    case 'introduce':
      return 'introduce — first appearance on the page';
  }
}

/** The annotated per-entity list (ADR 0009 decision 4), rendered into the volatile tail. */
export function renderReanchoring(decisions: readonly BandDecision[]): string {
  if (decisions.length === 0) return '';
  const lines = ['RE-ANCHORING (scenes since last touch, then what to do; centrality in parens):'];
  for (const decision of decisions) {
    const gap =
      decision.scenes_since_last_touch === null
        ? 'never yet on the page'
        : `${decision.scenes_since_last_touch} scene${decision.scenes_since_last_touch === 1 ? '' : 's'} since last touch`;
    const forced = decision.forced ? ' [author-forced]' : '';
    lines.push(
      `  - ${decision.name} (${decision.centrality}): ${gap} — ${bandInstruction(decision.band)}${forced}`,
    );
  }
  return lines.join('\n');
}

/**
 * Told-ledger miscalibration: the writer reported a band other than the one the ledger implies.
 *
 * ADR 0009 decision 8 — the continuity pass computes the expected band from told-ledger state at
 * scene entry and compares it against `reanchor_used`. This is the comparison, exposed here
 * because the expectation is this module's to compute; whether it warns or blocks is the
 * continuity pass's call (ADR 0011), not this one's.
 */
export function bandMismatches(
  expected: readonly BandDecision[],
  reported: readonly { entity_id: string; band: ReanchorBand }[],
): Array<{ entity_id: string; expected: ReanchorBand; used: ReanchorBand }> {
  const used = new Map(reported.map((entry) => [entry.entity_id, entry.band]));
  const mismatches: Array<{ entity_id: string; expected: ReanchorBand; used: ReanchorBand }> = [];
  for (const decision of expected) {
    const actual = used.get(decision.entity_id);
    if (actual === undefined) continue;
    // `introduce` and `reintroduce` share one instruction, so either satisfies the other.
    const equivalent =
      actual === decision.band ||
      (isFirstPlacement(actual) && isFirstPlacement(decision.band));
    if (!equivalent) {
      mismatches.push({ entity_id: decision.entity_id, expected: decision.band, used: actual });
    }
  }
  return mismatches;
}

function isFirstPlacement(band: ReanchorBand): boolean {
  return band === 'introduce' || band === 'reintroduce';
}
