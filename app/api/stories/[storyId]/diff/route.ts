import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { EditionDiffError, diffEditions } from '@/edition/edition-diff';

export const dynamic = 'force-dynamic';

/**
 * Two tellings of one story, set beside each other (ADR 0015 §6).
 *
 * `?a={runId}&b={runId}`. Both must be tellings of this story pinned to the same
 * `package_version` — a cross-version comparison is a different question, already owned by the
 * Working Draft and its staleness, and answering it here would put authored change and generation
 * variance in the same column.
 *
 * Read-only and reader-facing, like every other edition surface: it exposes prose and digests,
 * never the Story Package behind them (ADR 0015 §5).
 */
export async function GET(request: Request, { params }: { params: Promise<{ storyId: string }> }) {
  const { storyId } = await params;
  const url = new URL(request.url);
  const a = url.searchParams.get('a');
  const b = url.searchParams.get('b');

  if (a === null || b === null) {
    return NextResponse.json(
      { error: 'name two tellings to compare: ?a={runId}&b={runId}' },
      { status: 400 },
    );
  }

  try {
    const diff = await diffEditions(storyRepository(), a, b);
    if (diff.story_id !== storyId) {
      return NextResponse.json(
        { error: `those tellings belong to ${diff.story_id}, not ${storyId}` },
        { status: 400 },
      );
    }
    return NextResponse.json(diff);
  } catch (error) {
    if (error instanceof EditionDiffError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
