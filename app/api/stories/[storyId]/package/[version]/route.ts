import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';

export const dynamic = 'force-dynamic';

/**
 * A retained `package_version` snapshot (ADR 0015 §2) — what a Compiled edition's pinned
 * version dereferences to, and what keeps it dereferenceable after later edits.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storyId: string; version: string }> },
) {
  const { storyId, version } = await params;
  const parsed = Number.parseInt(version, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return NextResponse.json({ error: `Invalid package_version "${version}"` }, { status: 400 });
  }

  const pkg = await storyRepository().getPackageVersion(storyId, parsed);
  if (pkg === null) {
    return NextResponse.json(
      { error: `No package_version ${parsed} retained for "${storyId}"` },
      { status: 404 },
    );
  }
  return NextResponse.json(pkg);
}
