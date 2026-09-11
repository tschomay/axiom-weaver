import type { Metadata } from 'next';
import { storyRepository } from '@/persistence';
import { NewStoryView, type DuplicableStory } from './new-story-view';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Start a story — Axiom Weaver' };

/** New and Duplicate, the two entry points that begin from nothing the author already owns. */
export default async function NewStoryPage() {
  const repository = storyRepository();
  const stories: DuplicableStory[] = [];

  for (const storyId of await repository.listStoryIds()) {
    const pkg = await repository.getCurrentPackage(storyId);
    if (pkg === null) continue;
    stories.push({
      storyId,
      title: pkg.metadata.title,
      currentVersion: pkg.package_version,
      retainedVersions: await repository.listPackageVersions(storyId),
      scenes: pkg.scene_cards.length,
    });
  }

  return <NewStoryView stories={stories} />;
}
