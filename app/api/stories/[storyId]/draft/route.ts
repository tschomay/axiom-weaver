import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { buildDraftView } from '@/draft/draft-view';

export const dynamic = 'force-dynamic';

/**
 * The Working Draft's scene list (ADR 0015 §1) — the list ADR 0016 §1 hangs stale badges on,
 * and what the Working Draft screen re-reads after every compile.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;
  const repository = storyRepository();

  const pkg = await repository.getCurrentPackage(storyId);
  if (pkg === null) {
    return NextResponse.json({ error: `No package retained for "${storyId}"` }, { status: 404 });
  }

  return NextResponse.json(await buildDraftView(repository, pkg));
}
