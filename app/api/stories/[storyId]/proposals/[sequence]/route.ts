import { NextResponse } from 'next/server';
import { bearerToken, isAuthorizedAuthorRequest } from '@/admin/authorize';
import { storyRepository } from '@/persistence';
import { NoSuchStoryError, resolveDraftProposal } from '@/draft/proposals';

export const dynamic = 'force-dynamic';

/**
 * Accept or reject one volitional proposal (ADR 0016 §3).
 *
 * The author-time half of ADR 0005's authority: at read-time a proposal is applied or dropped
 * unattended, at author-time it waits here for a person. Accepting commits the log entry as
 * `proposed_applied` — which *is* the World Model change, since the model an author reads is the
 * seed replayed through the log — and rejecting commits it as `proposed_dropped`. Neither
 * deletes the entry.
 *
 * The response carries the field's value before and after, so the surface that asked can show
 * what the decision did rather than asserting that something happened.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storyId: string; sequence: string }> },
) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { storyId, sequence: rawSequence } = await params;
  const sequence = Number.parseInt(rawSequence, 10);
  if (Number.isNaN(sequence) || sequence < 0) {
    return NextResponse.json({ error: `Invalid sequence "${rawSequence}"` }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { decision?: unknown } | null;
  const decision = body?.decision;
  if (decision !== 'accept' && decision !== 'reject') {
    return NextResponse.json(
      { error: 'Expected a JSON body with decision "accept" or "reject"' },
      { status: 400 },
    );
  }

  try {
    const resolution = await resolveDraftProposal({
      repository: storyRepository(),
      storyId,
      sequence,
      decision,
    });
    return NextResponse.json({ story_id: storyId, ...resolution });
  } catch (error) {
    if (error instanceof NoSuchStoryError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    // `StateLog.resolveProposal` throws on an unknown sequence and on one already resolved —
    // both are the caller deciding something that is not theirs to decide any more.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 409 },
    );
  }
}
