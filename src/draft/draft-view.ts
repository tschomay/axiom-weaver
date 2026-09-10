/**
 * The Working Draft's scene list, as a surface reads it (ADR 0016 §1, surface 3).
 *
 * Stale badges are not a screen — they are inline decoration on the list the author is already
 * scrolling to pick the next card to compile. So this is that list: every Scene Card in the
 * package, whether or not it has been compiled, each carrying whatever the draft knows about it.
 *
 * One builder, read by both the server-rendered page and the JSON route behind it, so the screen
 * and the API can never drift into describing the draft differently.
 */

import type { StoryPackage } from '../schema/story-package';
import { scenesInOrder } from '../schema/story-package';
import type { StoryRepository } from '../persistence/story-repository';
import type { DiffSummary } from './working-draft';

export interface DraftSceneView {
  readonly scene_id: string;
  readonly scene_index: number;
  readonly dramatic_function: string;
  readonly compiled: boolean;
  readonly compiled_against_package_version: number | null;
  readonly compiled_at: string | null;
  readonly stale: boolean;
  /** ADR 0015 §6's field-scoped diff, reused as the badge's popover content. */
  readonly stale_reason: DiffSummary | null;
  /**
   * Whether this card can be compiled right now. A scene is compiled against the digests of the
   * scenes before it, so one whose predecessors are missing cannot be compiled at all — `replayTo`
   * refuses rather than compiling against an empty history, and a button that only fails is worse
   * than one that is visibly not yet available.
   */
  readonly compilable: boolean;
  readonly pending_proposals: number;
}

export interface DraftView {
  readonly story_id: string;
  readonly title: string;
  readonly package_version: number;
  readonly updated_at: string | null;
  readonly scenes: DraftSceneView[];
  readonly pending_proposals: number;
}

export async function buildDraftView(
  repository: StoryRepository,
  pkg: StoryPackage,
): Promise<DraftView> {
  const manifest = await repository.getDraftManifest(pkg.story_id);
  const log = await repository.getDraftStateLog(pkg.story_id);
  const pending = log.pendingProposals();
  const compiled = new Map(manifest.scenes.map((scene) => [scene.scene_id, scene]));

  let predecessorsCompiled = true;
  const scenes = scenesInOrder(pkg).map((card) => {
    const entry = compiled.get(card.id) ?? null;
    const view: DraftSceneView = {
      scene_id: card.id,
      scene_index: card.order,
      dramatic_function: card.dramatic_function,
      compiled: entry !== null,
      compiled_against_package_version: entry?.compiled_against_package_version ?? null,
      compiled_at: entry?.compiled_at ?? null,
      stale: entry?.stale ?? false,
      stale_reason: entry?.stale_reason ?? null,
      compilable: predecessorsCompiled,
      pending_proposals: pending.filter((proposal) => proposal.scene_index === card.order).length,
    };
    predecessorsCompiled = predecessorsCompiled && entry !== null;
    return view;
  });

  return {
    story_id: pkg.story_id,
    title: pkg.metadata.title,
    package_version: pkg.package_version,
    updated_at: manifest.updated_at,
    scenes,
    pending_proposals: pending.length,
  };
}
