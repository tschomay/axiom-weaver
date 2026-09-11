import { NextResponse } from 'next/server';
import { bearerToken, isAuthorizedAuthorRequest } from '@/admin/authorize';
import { storyRepository } from '@/persistence';
import { LibraryError } from '@/persistence/story-repository';

export const dynamic = 'force-dynamic';

/**
 * The library (ADR 0015 §5) — the author's shortlist of tellings a reader can return to.
 *
 * `POST` saves or renames an entry, `DELETE` removes one. Both are author-gated by the same token
 * every other write surface uses, because ADR 0015 §5 is explicit that the library is
 * author-gated: "only the author can save/name/delete entries in it."
 *
 * Removing an entry takes a telling off the list and never off the shelf. ADR 0014 §3 and ADR
 * 0015 §5 both say a completed run is never auto-deleted and stays addressable by its own run
 * ID/URL indefinitely — which is what lets a reader share a telling, or rejoin their own, without
 * needing library-write access at all.
 */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  if (typeof body?.name !== 'string') {
    return NextResponse.json({ error: 'name must be a string' }, { status: 400 });
  }

  try {
    const index = await storyRepository().saveToLibrary(runId, body.name);
    return NextResponse.json({ library: index.runs.filter((run) => run.saved) });
  } catch (error) {
    if (error instanceof LibraryError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { runId } = await params;
  const manifest = await storyRepository().getEditionManifest(runId);
  if (manifest === null) {
    return NextResponse.json({ error: `No telling with run id "${runId}"` }, { status: 404 });
  }

  try {
    const index = await storyRepository().removeFromLibrary(manifest.story_id, runId);
    return NextResponse.json({ library: index.runs.filter((run) => run.saved) });
  } catch (error) {
    if (error instanceof LibraryError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
