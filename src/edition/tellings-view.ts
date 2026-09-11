/**
 * What a reader is offered when they open a story (ADR 0014 §3): the Baked edition, the tellings
 * this story has already produced, and what a fresh one would cost in wall-clock time.
 *
 * One builder behind both the screen and `GET /api/stories/{storyId}/tellings`, so the two cannot
 * describe the same choice differently. Cost is deliberately absent — ADR 0014 §5 estimates
 * wall-clock and never money.
 */

import type { StoryPackage } from '../schema/story-package';
import { scenesInOrder } from '../schema/story-package';
import type { StoryRepository } from '../persistence/story-repository';
import { estimateCompile, type CompileEstimate } from './run-report';
import type { BakedPointer, RunIndex } from './edition';

export interface TellingsView {
  readonly story_id: string;
  readonly title: string;
  readonly scene_count: number;
  readonly baked: BakedPointer | null;
  readonly runs: RunIndex['runs'];
  readonly estimate: CompileEstimate;
}

export async function buildTellingsView(
  repository: StoryRepository,
  pkg: StoryPackage,
): Promise<TellingsView> {
  const index = await repository.getRunIndex(pkg.story_id);
  const sceneCount = scenesInOrder(pkg).length;

  return {
    story_id: pkg.story_id,
    title: pkg.metadata.title,
    scene_count: sceneCount,
    baked: await repository.getBakedPointer(pkg.story_id),
    // Newest first: the run a reader wants is almost always the one that just finished.
    runs: [...index.runs].reverse(),
    estimate: estimateCompile(sceneCount, await repository.getRunReports(pkg.story_id)),
  };
}
