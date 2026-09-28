import { NextResponse } from 'next/server';
import { bearerToken, isAuthorizedAuthorRequest } from '@/admin/authorize';
import { storyRepository } from '@/persistence';
import { buildEditionDiscourseView } from '@/edition/discourse-view';

export const dynamic = 'force-dynamic';

/**
 * One telling's Discourse Record — the told-ledger, the digest hierarchy and its rollups, and
 * every scene's Scene Digest beside the Scene Card fields it was compiled against (#183).
 *
 * A debugging surface for the author: it answers "what did the writer report it told the reader,
 * scene by scene" when a finished telling reads wrong. Author-gated with the same bearer token as
 * every other author surface, because each row quotes the card's `reader_must_learn` /
 * `must_stay_hidden` / `pays_off` — Story Package content ADR 0015 §5 keeps off a shared edition.
 * `/api/tellings/{runId}` and its `?include=scenes` stay what a reader gets: progress and prose.
 */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { runId } = await params;
  const repository = storyRepository();
  const manifest = await repository.getEditionManifest(runId);
  if (manifest === null) {
    return NextResponse.json({ error: `No telling with run id "${runId}"` }, { status: 404 });
  }

  const [discourse, scenes, pkg] = await Promise.all([
    repository.getEditionDiscourse(runId),
    repository.getEditionScenes(runId),
    repository.getPackageVersion(manifest.story_id, manifest.package_version),
  ]);

  return NextResponse.json(buildEditionDiscourseView(manifest, discourse, scenes, pkg));
}
