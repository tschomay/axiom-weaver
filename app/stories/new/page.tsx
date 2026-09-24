import type { Metadata } from 'next';
import { storyRepository } from '@/persistence';
import { SOURCE_MANIFESTS } from '@/extraction/sources';
import { NewStoryView, type DuplicableStory, type ExtractableFixture } from './new-story-view';

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

  // The Extract tab's known-good sources (#173) — read here because `sources.ts` is server-only.
  const fixtures: ExtractableFixture[] = SOURCE_MANIFESTS.map((manifest) => ({
    id: manifest.id,
    title: manifest.title,
    words: manifest.expected_words,
  }));

  return <NewStoryView stories={stories} fixtures={fixtures} />;
}
