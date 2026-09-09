import { NextResponse } from 'next/server';
import { bearerToken, isAuthorizedAdminRequest } from '@/admin/authorize';
import { FIXTURE_STORY_IDS, loadFixtureIntoRepository } from '@/fixtures/load';
import { storyRepository } from '@/persistence';

export const dynamic = 'force-dynamic';

/**
 * Reseeds both fixture Story Packages into the Blob store this deployment is configured
 * against. Idempotent per fixture: an unchanged package_version is a no-op
 * (`StoryRepository.putPackage`); an edited fixture without a version bump fails loudly
 * (`PackageVersionConflictError`) rather than silently overwriting a retained snapshot.
 *
 * Exists for a phone-only workflow: `npm run load-fixtures` needs a terminal.
 * `/admin/load-fixtures` calls this over HTTPS instead, authorized by the same
 * `BLOB_READ_WRITE_TOKEN` a terminal run would need anyway.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAdminRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const repository = storyRepository();
  const results: Array<
    | { story_id: string; ok: true; package_version: number; scenes: number; entities: number }
    | { story_id: string; ok: false; error: string }
  > = [];

  for (const fixture of FIXTURE_STORY_IDS) {
    try {
      const loaded = await loadFixtureIntoRepository(fixture, repository);
      const model = loaded.worldModel;
      results.push({
        story_id: loaded.pkg.story_id,
        ok: true,
        package_version: loaded.pkg.package_version,
        scenes: loaded.scenes.length,
        entities:
          model.rows('character').length +
          model.rows('location').length +
          model.rows('object').length,
      });
    } catch (error) {
      results.push({
        story_id: fixture,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const allOk = results.every((result) => result.ok);
  return NextResponse.json({ results }, { status: allOk ? 200 : 500 });
}
