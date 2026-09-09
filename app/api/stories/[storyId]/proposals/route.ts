import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';

export const dynamic = 'force-dynamic';

/**
 * The proposals queue (ADR 0016 §3): volitional proposals recorded against the Working Draft
 * and not yet accepted or rejected by the author. A proposal is a state-log entry not yet
 * resolved — there is no second store.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;
  const log = await storyRepository().getDraftStateLog(storyId);
  return NextResponse.json({ story_id: storyId, proposals: log.pendingProposals() });
}
