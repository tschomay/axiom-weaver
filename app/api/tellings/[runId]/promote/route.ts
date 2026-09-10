import { NextResponse } from 'next/server';
import { bearerToken, isAuthorizedAuthorRequest } from '@/admin/authorize';
import { storyRepository } from '@/persistence';
import { BakedPromotionError } from '@/persistence/story-repository';

export const dynamic = 'force-dynamic';

/**
 * Promote a run to Baked (ADR 0014 §9).
 *
 * Manual, author-initiated, and never available for a `degraded` run — the repository enforces
 * both. Author-gated by the same token every other write surface uses (ADR 0015 §5: only the
 * author saves, names or deletes; a reader can still share a run by its own URL).
 *
 * The button that calls this lives on the run report screen (`/stories/{storyId}/runs`).
 */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { runId } = await params;
  try {
    return NextResponse.json({ baked: await storyRepository().promoteToBaked(runId) });
  } catch (error) {
    if (error instanceof BakedPromotionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
