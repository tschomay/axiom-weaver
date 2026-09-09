/**
 * The told-ledger: what the *reader* has been told, and how recently.
 *
 * One table, ADR 0003 decision 4: `{fact_ref, first_learned_scene, last_touched_scene,
 * centrality}`. Entity introduction is not a parallel structure — "has the reader met Marcus?"
 * rides the same mechanism via an auto-generated `met:<entity_id>` fact per entity. Current state
 * only is tracked, never a full touch history.
 *
 * This is the reader's memory, and it is a different table from `character_knowledge`, which is
 * what a *character* knows in-world (`CONTEXT.md`, The two memories). A fact can be established
 * for the reader while a character remains ignorant of it, and vice versa.
 */

import type { SceneCard, StoryPackage } from '../schema/story-package';
import { entityAssertions, newRelationships, scenesInOrder } from '../schema/story-package';
import type { SceneDigest } from './scene-digest';

/** ADR 0009 decision 2: a 3-level ordinal, not a continuous score. */
export const CENTRALITIES = ['low', 'medium', 'high'] as const;
export type Centrality = (typeof CENTRALITIES)[number];

export interface ToldLedgerRow {
  readonly fact_ref: string;
  readonly first_learned_scene: number;
  /** Load-bearing for ADR 0009's decay: recency, not just first-learned, decides the band. */
  readonly last_touched_scene: number;
  readonly centrality: Centrality;
}

/** The `met:` prefix ADR 0003 decision 4 names. Kept in one place so nobody re-spells it. */
export const MET_PREFIX = 'met:';

export function metFact(entityId: string): string {
  return `${MET_PREFIX}${entityId}`;
}

/** The entity a `met:` fact is about, or `null` for an ordinary plot fact. */
export function entityOfMetFact(factRef: string): string | null {
  return factRef.startsWith(MET_PREFIX) ? factRef.slice(MET_PREFIX.length) : null;
}

/**
 * Centrality per entity, derived from the Story Package.
 *
 * ADR 0009 decision 2 fixes the *scale* but never says who assigns a value, and neither fixture
 * carries one — so this derives a default and lets an author override it with a `centrality` key
 * in the entity's `bag`. The derivation is scene-presence share, which is deterministic, needs no
 * new authored field, and matches how ADR 0009 describes the axis ("major characters, minor
 * characters, locations, objects"): an entity on stage for most of the book is high, one that
 * turns up once or twice is low.
 *
 * Presence counts three declared surfaces, because no single one covers every entity kind:
 * `characters_present` (characters), `location_id` (locations), and any entity a Scene Card names
 * in its `entry_state`/`exit_state` (objects, which never appear in `characters_present` and
 * would otherwise all derive as `low`).
 *
 * The cutoffs are calibrated against the two fixtures so the derived bands match what ADR 0012's
 * prototype worked by hand for Cinderella's scene 13 — Cinderella `high`, both stepsisters
 * `medium`, the gentleman-in-waiting `low`. That is a sanity check on two short stories, not
 * proof at novel scale.
 *
 * This is a documented default, not a decision ADR 0009 made. If it proves miscalibrated against
 * a real telling, the fix is an authored `centrality` column on the entity tables — a schema
 * change, and so a decision for whoever owns the schema, not something to sneak in here.
 */
export const CENTRALITY_CUTOFFS = { high: 0.7, medium: 0.15 } as const;

export function deriveCentralities(pkg: StoryPackage): Map<string, Centrality> {
  const scenes = scenesInOrder(pkg);
  const total = scenes.length;
  const appearances = new Map<string, number>();

  for (const scene of scenes) {
    const inScene = new Set<string>(scene.characters_present);
    inScene.add(scene.location_id);
    for (const state of [scene.entry_state, scene.exit_state]) {
      for (const [entityId] of entityAssertions(state)) inScene.add(entityId);
      for (const row of newRelationships(state)) {
        inScene.add(row.from_id);
        inScene.add(row.to_id);
      }
    }
    for (const id of inScene) appearances.set(id, (appearances.get(id) ?? 0) + 1);
  }

  const authored = new Map<string, Centrality>();
  const seed = pkg.world_model_seed;
  for (const row of [...seed.characters, ...seed.locations, ...seed.objects]) {
    const declared = row.bag['centrality'];
    if (typeof declared === 'string' && (CENTRALITIES as readonly string[]).includes(declared)) {
      authored.set(row.id, declared as Centrality);
    }
  }

  const centralities = new Map<string, Centrality>();
  const ids = new Set<string>([
    ...appearances.keys(),
    ...seed.characters.map((row) => row.id),
    ...seed.locations.map((row) => row.id),
    ...seed.objects.map((row) => row.id),
  ]);
  for (const id of ids) {
    const override = authored.get(id);
    if (override !== undefined) {
      centralities.set(id, override);
      continue;
    }
    const share = total === 0 ? 0 : (appearances.get(id) ?? 0) / total;
    centralities.set(
      id,
      share >= CENTRALITY_CUTOFFS.high
        ? 'high'
        : share >= CENTRALITY_CUTOFFS.medium
          ? 'medium'
          : 'low',
    );
  }
  return centralities;
}

/**
 * The told-ledger as it stands at some point in a telling.
 *
 * Rows are added and touched by scene digests as the run advances, which is the only way a fact
 * enters: the ledger records what the reader was *actually told*, not what a Scene Card intended
 * to tell them.
 */
export class ToldLedger {
  private readonly rows = new Map<string, ToldLedgerRow>();
  private readonly centralities: Map<string, Centrality>;

  constructor(centralities: Map<string, Centrality> = new Map()) {
    this.centralities = centralities;
  }

  static forPackage(pkg: StoryPackage): ToldLedger {
    return new ToldLedger(deriveCentralities(pkg));
  }

  /** The centrality of whatever a fact is about: the entity for `met:`, else the fact itself. */
  centralityOf(factRef: string): Centrality {
    const entity = entityOfMetFact(factRef);
    if (entity !== null) return this.centralities.get(entity) ?? 'low';
    return this.centralities.get(factRef) ?? 'medium';
  }

  row(factRef: string): ToldLedgerRow | null {
    return this.rows.get(factRef) ?? null;
  }

  all(): ToldLedgerRow[] {
    return [...this.rows.values()].sort((a, b) => a.fact_ref.localeCompare(b.fact_ref));
  }

  /** Record that a fact was told (or re-touched) at a scene. First touch sets first_learned. */
  touch(factRef: string, sceneOrder: number): void {
    const existing = this.rows.get(factRef);
    if (existing === undefined) {
      this.rows.set(factRef, {
        fact_ref: factRef,
        first_learned_scene: sceneOrder,
        last_touched_scene: sceneOrder,
        centrality: this.centralityOf(factRef),
      });
      return;
    }
    this.rows.set(factRef, { ...existing, last_touched_scene: sceneOrder });
  }

  /**
   * Apply a scene's digest.
   *
   * `facts_revealed` are plot facts; `entities_on_stage` touch their own `met:` facts — an entity
   * the reader just watched on the page has been re-touched whether or not the scene revealed
   * anything new about it.
   */
  applyDigest(digest: SceneDigest, sceneOrder: number): void {
    for (const fact of digest.facts_revealed) this.touch(fact, sceneOrder);
    for (const entity of digest.entities_on_stage) this.touch(metFact(entity), sceneOrder);
  }

  /**
   * The ADR 0009 §5 slice: told-ledger rows for the `met:` facts of every entity present.
   *
   * This is also ADR 0008's deferred group-6 payload — the lowest-priority, widest slice in the
   * volatile-tail eviction order. There is deliberately no wider one: reaching arbitrary
   * non-required plot facts would mean inferring relevance from prose, which ADR 0008 §4 rules
   * out.
   */
  metSlice(entityIds: readonly string[]): ToldLedgerRow[] {
    const slice: ToldLedgerRow[] = [];
    for (const id of entityIds) {
      const row = this.rows.get(metFact(id));
      if (row !== null && row !== undefined) slice.push(row);
    }
    return slice;
  }

  /** Rows for a scene's own fact-refs — ADR 0008 §6's highest-priority told-ledger group. */
  sliceForScene(scene: SceneCard): ToldLedgerRow[] {
    const wanted = new Set<string>([
      ...scene.reader_must_learn,
      ...scene.must_stay_hidden,
      ...scene.pays_off.map((payoff) => payoff.fact_ref),
    ]);
    return [...wanted]
      .map((fact) => this.rows.get(fact))
      .filter((row): row is ToldLedgerRow => row !== undefined);
  }

  copy(): ToldLedger {
    const clone = new ToldLedger(this.centralities);
    for (const [key, row] of this.rows) clone.rows.set(key, row);
    return clone;
  }
}
