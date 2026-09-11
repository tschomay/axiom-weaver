import { NextResponse } from 'next/server';
import { bearerToken, isAuthorizedAuthorRequest } from '@/admin/authorize';
import { storyRepository } from '@/persistence';
import { lintPackage } from '@/authoring/lint';
import { mapAuthoringError } from '@/authoring/http';
import { nextPackageVersion, renameManuscript } from '@/authoring/manuscript';
import { DraftStoryPackageSchema, type Manuscript } from '@/schema/manuscript';

export const dynamic = 'force-dynamic';

/**
 * The Manuscript, with everything a surface needs to render it in one read (ADR 0017 §1).
 *
 * The lint result rides along rather than sitting behind a second request: the screen shows
 * problems against the fields that own them, so a Manuscript without its problems is a screen
 * that renders twice — once wrong.
 */
async function present(manuscript: Manuscript) {
  return {
    ...manuscript,
    lint: lintPackage({
      ...manuscript.package,
      package_version: await nextPackageVersion(storyRepository(), manuscript.story_id),
    }),
    /** What publishing would write. Said before the author commits, not after (ADR 0017 §3). */
    next_package_version: await nextPackageVersion(storyRepository(), manuscript.story_id),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;
  const manuscript = await storyRepository().getManuscript(storyId);
  if (manuscript === null) {
    return NextResponse.json({ error: `No Manuscript for "${storyId}"` }, { status: 404 });
  }
  return NextResponse.json(await present(manuscript));
}

/**
 * Save (ADR 0017 §1/§8).
 *
 * `updated_at` is the value the caller read, and a save whose stored copy has moved on since is
 * refused with a 409 naming what the store actually holds. Two tabs on one phone is the likely
 * case, and silently discarding one of them is the outcome worth a precondition to avoid.
 *
 * A changed `story_id` is a rename, which is only legal before the story has ever published —
 * afterwards the id keys every blob path a retained version and its editions live under.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ storyId: string }> }) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { storyId } = await params;
  const body = (await request.json().catch(() => null)) as {
    package?: unknown;
    updated_at?: unknown;
  } | null;

  if (body === null || typeof body.updated_at !== 'string') {
    return NextResponse.json(
      { error: 'Expected a JSON body with `package` and the `updated_at` it was read at' },
      { status: 400 },
    );
  }

  const repository = storyRepository();
  const stored = await repository.getManuscript(storyId);
  if (stored === null) {
    return NextResponse.json({ error: `No Manuscript for "${storyId}"` }, { status: 404 });
  }

  const parsed = DraftStoryPackageSchema.safeParse(body.package);
  if (!parsed.success) {
    // The relaxed schema already tolerates a half-written story, so a failure here is a
    // malformed request rather than an author mid-thought.
    return NextResponse.json(
      { error: 'package does not parse, even loosely', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const renamed =
      parsed.data.story_id !== storyId
        ? await renameManuscript(repository, storyId, parsed.data.story_id, body.updated_at)
        : null;

    const target = renamed ?? stored;
    const saved = await repository.putManuscript(
      { ...target, package: { ...parsed.data, story_id: target.story_id } },
      // A rename has just written the new path itself, so the precondition it must satisfy is
      // the one that write left behind, not the one the caller read at the old path.
      renamed === null ? body.updated_at : renamed.updated_at,
    );
    return NextResponse.json(await present(saved));
  } catch (error) {
    const mapped = mapAuthoringError(error);
    if (mapped !== null) return NextResponse.json(mapped.body, { status: mapped.status });
    throw error;
  }
}

/** Discard: the story returns to its published package (ADR 0017 §9). Idempotent. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { storyId } = await params;
  const repository = storyRepository();
  await repository.deleteManuscript(storyId);

  // A story that never published has nothing behind the Manuscript, so discarding it is the one
  // case where the story itself is gone (ADR 0017 §9).
  const published = await repository.getPointer(storyId);
  return NextResponse.json({
    story_id: storyId,
    discarded: true,
    story_remains: published !== null,
  });
}
