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

/**
 * The attribute names the writer is shown (#215). Not a closed set — any snake_case attribute is
 * accepted — but these are the properties that drifted in the #204 re-run, and naming them is what
 * makes two scenes report the same key.
 */
export const CANONICAL_DETAIL_ATTRIBUTES = [
  'where_kept',
  'amount',
  'age',
  'years',
  'date',
  'time',
  'title',
  'name',
  'material',
  'color',
  'size',
  'count',
  'origin',
] as const;

/** Ways a writer names the same property, folded to one canonical attribute (#215). */
const ATTRIBUTE_SYNONYMS: Record<string, string> = {
  location: 'where_kept',
  kept_in: 'where_kept',
  kept: 'where_kept',
  stored: 'where_kept',
  stored_in: 'where_kept',
  storage: 'where_kept',
  hiding_place: 'where_kept',
  hidden_in: 'where_kept',
  place: 'where_kept',
  whereabouts: 'where_kept',
  colour: 'color',
  sum: 'amount',
  total: 'amount',
  current_total: 'amount',
  price: 'amount',
  cost: 'amount',
  amount_of_money: 'amount',
  play_title: 'title',
  name_of_play: 'title',
  book_title: 'title',
  years_away: 'years',
  duration: 'years',
  tenure: 'years',
  years_in_role: 'years',
  time_of_day: 'time',
  hour: 'time',
  day: 'date',
  deadline: 'date',
  deadline_date: 'date',
  made_of: 'material',
  quantity: 'count',
  hometown: 'origin',
  came_from: 'origin',
};

/** snake_case, then folded through the synonym table. */
export function canonicalAttribute(attribute: string): string {
  const snake = attribute
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ATTRIBUTE_SYNONYMS[snake] ?? snake;
}

function key(entityId: string, attribute: string): string {
  return `${entityId.trim()}\u0000${canonicalAttribute(attribute)}`;
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
      this.details.set(at, {
        ...detail,
        attribute: canonicalAttribute(detail.attribute),
        scene_order: sceneOrder,
      });
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
