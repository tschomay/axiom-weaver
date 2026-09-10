import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { buildInspectorPayload } from '@/draft/inspector';

export const dynamic = 'force-dynamic';

/**
 * The World & Discourse inspector (ADR 0016 §1, surface 2): both tabs at one scrubber position.
 *
 * One request, not two, because the two tabs are one question asked of `CONTEXT.md`'s two
 * memories — the World Model replayed from the state-update commit log, and the told-ledger
 * replayed from the Working Draft's Scene Digests.
 *
 * `?scene=` defaults to the whole draft; `?scene=0` is the seed and an untold story.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;
  const repository = storyRepository();

  const pkg = await repository.getCurrentPackage(storyId);
  if (pkg === null) {
    return NextResponse.json({ error: `No package retained for "${storyId}"` }, { status: 404 });
  }

  const raw = new URL(request.url).searchParams.get('scene');
  const sceneIndex = raw === null ? Number.POSITIVE_INFINITY : Number.parseInt(raw, 10);
  if (Number.isNaN(sceneIndex) || sceneIndex < 0) {
    return NextResponse.json({ error: `Invalid scene index "${raw}"` }, { status: 400 });
  }

  return NextResponse.json(await buildInspectorPayload(repository, pkg, sceneIndex));
}
