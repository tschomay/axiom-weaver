/**
 * Load both fixture Story Packages into the schema end to end and retain their
 * `package_version` snapshots.
 *
 * With no `BLOB_READ_WRITE_TOKEN` set this writes to the local filesystem store under `.data/`,
 * so it runs offline. With a token it writes to Vercel Blob at exactly the same pathnames.
 *
 *     npm run load-fixtures
 */

import { FIXTURE_STORY_IDS, loadFixtureIntoRepository } from '../src/fixtures/load';
import { StoryRepository, createBlobStore } from '../src/persistence';

async function main(): Promise<void> {
  const repository = new StoryRepository(createBlobStore());

  for (const fixture of FIXTURE_STORY_IDS) {
    const loaded = await loadFixtureIntoRepository(fixture, repository);
    const model = loaded.worldModel;
    const versions = await repository.listPackageVersions(loaded.pkg.story_id);

    console.log(`${loaded.pkg.metadata.title} (${loaded.pkg.story_id})`);
    console.log(`  package_version ${loaded.pkg.package_version}; retained: ${versions.join(', ')}`);
    console.log(
      `  world model: ${model.rows('character').length} characters, ` +
        `${model.rows('location').length} locations, ` +
        `${model.rows('object').length} objects, ` +
        `${model.rows('relationship').length} relationships, ` +
        `${model.rows('character_knowledge').length} knowledge rows`,
    );
    console.log(`  scene cards: ${loaded.scenes.length}`);
  }

  console.log(`\nStories in the store: ${(await repository.listStoryIds()).join(', ')}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
