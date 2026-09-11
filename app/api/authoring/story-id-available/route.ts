import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { RESERVED_STORY_IDS, STORY_ID_PATTERN, storyIdAvailable } from '@/authoring/manuscript';

export const dynamic = 'force-dynamic';

/**
 * Whether a `story_id` is free (ADR 0017 §5).
 *
 * A story is taken once it has a published package *or* an open Manuscript — the second half
 * matters because a Manuscript that has never published is exactly the story whose id is still
 * being chosen, and two of them under one id would fight over one blob path.
 *
 * The authoritative check is on the write path; this one exists so a screen can say so while the
 * author is still typing, rather than after they press the button.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (id === null || id === '') {
    return NextResponse.json({ error: 'Expected ?id=' }, { status: 400 });
  }
  // `valid` is reported separately from `available` so a screen can say *why* an id is refused:
  // "already a story" and "not a usable id" are different mistakes with different next moves.
  return NextResponse.json({
    story_id: id,
    valid: STORY_ID_PATTERN.test(id) && !RESERVED_STORY_IDS.has(id),
    available: await storyIdAvailable(storyRepository(), id),
  });
}
