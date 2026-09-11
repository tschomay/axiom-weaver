import { NextResponse } from 'next/server';
import { bearerToken, isAuthorizedAuthorRequest } from '@/admin/authorize';
import { storyRepository } from '@/persistence';
import { mapAuthoringError } from '@/authoring/http';
import { publishManuscript } from '@/authoring/manuscript';

export const dynamic = 'force-dynamic';

/**
 * Publish (ADR 0017 §3): strict-parse → lint → `max(retained) + 1` → retain → repoint.
 *
 * A rejection returns the lint result rather than a message, because the caller's next move is to
 * put the author on the field that caused it. A rejected publish writes nothing at all — not a
 * partial snapshot, not a moved pointer.
 *
 * This is the only route in the system that advances a `package_version`, which makes it the only
 * moment staleness propagates through the Working Draft (ADR 0015 §3).
 */
export async function POST(request: Request, { params }: { params: Promise<{ storyId: string }> }) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { storyId } = await params;
  try {
    const result = await publishManuscript(storyRepository(), storyId);
    return NextResponse.json({
      story_id: storyId,
      package_version: result.published.package_version,
      pointer: result.pointer,
      manuscript: result.manuscript,
      lint: result.lint,
    });
  } catch (error) {
    const mapped = mapAuthoringError(error);
    if (mapped !== null) return NextResponse.json(mapped.body, { status: mapped.status });
    throw error;
  }
}
