/**
 * A Compiled edition's Discourse Record, laid out for the author who is diagnosing it (#183).
 *
 * The writer's own account of what it told the reader is already persisted — the told-ledger and
 * the digest hierarchy in `edition/{runId}/discourse.json`, each scene's Scene Digest in its scene
 * document — but until now nothing read it back. This joins the two with the Scene Card each
 * scene was compiled from, so "the card asked for X, the writer reported Y" is one row rather than
 * three files.
 *
 * Author-only by construction: the per-scene `card` block quotes the Story Package's
 * `reader_must_learn` / `must_stay_hidden` / `pays_off`, which ADR 0015 §5 keeps off every shared
 * surface. The route serving this is gated with the same token as the other author surfaces; the
 * reader-facing telling route still returns prose only.
 */

import type { SceneDigest } from '../digest/scene-digest';
import type { StoryPackage } from '../schema/story-package';
import type { EditionDiscourse, EditionManifest, EditionScene } from './edition';

export interface DiscourseSceneView {
  readonly scene_id: string;
  readonly scene_index: number;
  readonly degraded: boolean;
  readonly digest: SceneDigest;
  /** The card this scene was compiled from, at the edition's pinned `package_version`. */
  readonly card: {
    readonly reader_must_learn: readonly string[];
    readonly must_stay_hidden: readonly string[];
    readonly pays_off: readonly { fact_ref: string; plant: string | null }[];
  } | null;
  /** `reader_must_learn` the digest's `facts_revealed` does not report. */
  readonly unreported: readonly string[];
  /** `must_stay_hidden` the digest's `facts_revealed` does report — a self-reported leak. */
  readonly leaked: readonly string[];
}

export interface EditionDiscourseView {
  readonly run_id: string;
  readonly story_id: string;
  readonly package_version: number;
  readonly status: EditionManifest['status'];
  readonly told_ledger: EditionDiscourse['told_ledger'];
  readonly digest_hierarchy: EditionDiscourse['digest_hierarchy'];
  readonly rollup_events: EditionDiscourse['rollup_events'];
  readonly scenes: readonly DiscourseSceneView[];
}

/**
 * `discourse` is `null` for a run that died before its first scene boundary flushed one; the
 * scenes it did compile are still worth showing. `pkg` is `null` when the pinned version is no
 * longer retained — the digests stand on their own, without the card column.
 */
export function buildEditionDiscourseView(
  manifest: EditionManifest,
  discourse: EditionDiscourse | null,
  scenes: readonly EditionScene[],
  pkg: StoryPackage | null,
): EditionDiscourseView {
  const cards = new Map((pkg?.scene_cards ?? []).map((card) => [card.id, card]));

  return {
    run_id: manifest.run_id,
    story_id: manifest.story_id,
    package_version: manifest.package_version,
    status: manifest.status,
    told_ledger: discourse?.told_ledger ?? [],
    digest_hierarchy: discourse?.digest_hierarchy ?? [],
    rollup_events: discourse?.rollup_events ?? [],
    scenes: scenes.map((scene) => {
      const card = cards.get(scene.scene_id) ?? null;
      const revealed = new Set(scene.digest.facts_revealed);
      return {
        scene_id: scene.scene_id,
        scene_index: scene.scene_index,
        degraded: scene.degraded,
        digest: scene.digest,
        card:
          card === null
            ? null
            : {
                reader_must_learn: card.reader_must_learn,
                must_stay_hidden: card.must_stay_hidden,
                pays_off: card.pays_off,
              },
        unreported: card?.reader_must_learn.filter((fact) => !revealed.has(fact)) ?? [],
        leaked: card?.must_stay_hidden.filter((fact) => revealed.has(fact)) ?? [],
      };
    }),
  };
}
