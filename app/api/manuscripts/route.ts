import { NextResponse } from 'next/server';
import { bearerToken, isAuthorizedAuthorRequest } from '@/admin/authorize';
import { storyRepository } from '@/persistence';
import { mapAuthoringError } from '@/authoring/http';
import { seedManuscript, slugifyStoryId, type ManuscriptSeed } from '@/authoring/manuscript';

export const dynamic = 'force-dynamic';

/**
 * Start a Manuscript from one of ADR 0017 §5's three entry points.
 *
 * `new` and `duplicate` both claim a `story_id`, and the claim is checked here rather than only
 * in the browser — a collision decided client-side is a collision two tabs can both win.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const source = body?.source;
  if (source !== 'new' && source !== 'edit' && source !== 'duplicate') {
    return NextResponse.json(
      { error: 'source must be "new", "edit" or "duplicate"' },
      { status: 400 },
    );
  }

  const title = typeof body?.title === 'string' ? body.title : undefined;
  const explicitId = typeof body?.story_id === 'string' ? body.story_id : undefined;

  let seed: ManuscriptSeed;
  if (source === 'edit') {
    if (explicitId === undefined) {
      return NextResponse.json({ error: 'edit needs a story_id' }, { status: 400 });
    }
    seed = { source, story_id: explicitId };
  } else if (source === 'new') {
    if (title === undefined || title.trim() === '') {
      return NextResponse.json({ error: 'a new story needs a title' }, { status: 400 });
    }
    // The id is slugged from the title when the caller does not name one, which is what makes
    // "new story" a single field rather than two (ADR 0017 §5).
    seed = { source, story_id: explicitId ?? slugifyStoryId(title), title };
  } else {
    const fromStoryId = body?.from_story_id;
    if (typeof fromStoryId !== 'string') {
      return NextResponse.json({ error: 'duplicate needs a from_story_id' }, { status: 400 });
    }
    const rawVersion = body?.from_version;
    const fromVersion = typeof rawVersion === 'number' ? rawVersion : undefined;
    if (rawVersion !== undefined && (fromVersion === undefined || !Number.isInteger(fromVersion))) {
      return NextResponse.json({ error: 'from_version must be an integer' }, { status: 400 });
    }
    const storyId = explicitId ?? (title !== undefined ? slugifyStoryId(title) : undefined);
    if (storyId === undefined) {
      return NextResponse.json(
        { error: 'duplicate needs a story_id or a title to slug one from' },
        { status: 400 },
      );
    }
    seed = { source, story_id: storyId, from_story_id: fromStoryId, from_version: fromVersion, title };
  }

  try {
    return NextResponse.json(await seedManuscript(storyRepository(), seed), { status: 201 });
  } catch (error) {
    const mapped = mapAuthoringError(error);
    if (mapped !== null) return NextResponse.json(mapped.body, { status: mapped.status });
    throw error;
  }
}
