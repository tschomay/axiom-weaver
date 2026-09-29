/**
 * The details ledger: every concrete specific the prose has committed the reader to (#198, ADR
 * 0003's 2026-09-29 amendment).
 *
 * Each scene's digest reports its `established_details` — `obj_ash_urn / material / brass`. The
 * ledger keeps the first value per `(entity_id, attribute)`, because that is what the reader read
 * first; a later scene reporting a different value is drift. Later scenes are shown the details
 * that bear on them, so they have something to stay consistent with: without it, panel batch
 * 2026-09-29's urn was brass and then tin, and an escrow of £5,000 became £20,000.
 *
 * Flat and run-scoped, like the told-ledger: no rollup shape, read at assembly time.
 */

import type { EstablishedDetail } from './scene-digest';

export interface LedgerDetail extends EstablishedDetail {
  /** Scene `order` that first established it. */
  readonly scene_order: number;
}

export interface DetailDrift {
  readonly established: LedgerDetail;
  readonly reported: EstablishedDetail;
}

/** Lines of `ESTABLISHED DETAILS` a scene is shown, at most. */
export const ESTABLISHED_DETAILS_SHOWN = 24;

function key(entityId: string, attribute: string): string {
  return `${entityId}\u0000${attribute.trim().toLowerCase()}`;
}

/** Case, punctuation and spacing do not make a value different. */
export function normalizeDetailValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export class DetailsLedger {
  private readonly details = new Map<string, LedgerDetail>();

  get size(): number {
    return this.details.size;
  }

  all(): LedgerDetail[] {
    return [...this.details.values()];
  }

  /** Reported details that contradict what the ledger holds. Reads only; records nothing. */
  driftIn(reported: readonly EstablishedDetail[]): DetailDrift[] {
    const drifts: DetailDrift[] = [];
    for (const detail of reported) {
      const established = this.details.get(key(detail.entity_id, detail.attribute));
      if (established === undefined) continue;
      if (normalizeDetailValue(established.value) === normalizeDetailValue(detail.value)) continue;
      drifts.push({ established, reported: detail });
    }
    return drifts;
  }

  /** Record a scene's details. The first value for a key stands; later ones never replace it. */
  record(reported: readonly EstablishedDetail[], sceneOrder: number): void {
    for (const detail of reported) {
      const at = key(detail.entity_id, detail.attribute);
      if (this.details.has(at)) continue;
      this.details.set(at, { ...detail, scene_order: sceneOrder });
    }
  }

  /**
   * What a scene is shown: details about entities on stage, then details about entities the World
   * Model does not track (a prop, a backstory) — the join cannot place those on or off stage, so
   * they are always candidates. Most recently established first within each, capped.
   */
  forScene(
    onStage: ReadonlySet<string>,
    isTracked: (entityId: string) => boolean,
    cap = ESTABLISHED_DETAILS_SHOWN,
  ): LedgerDetail[] {
    const recent = [...this.details.values()].sort((a, b) => b.scene_order - a.scene_order);
    const present = recent.filter((detail) => onStage.has(detail.entity_id));
    const untracked = recent.filter(
      (detail) => !onStage.has(detail.entity_id) && !isTracked(detail.entity_id),
    );
    return [...present, ...untracked].slice(0, cap);
  }
}
