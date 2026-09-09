import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;
  const pkg = await storyRepository().getCurrentPackage(storyId);
  if (pkg === null) {
    return NextResponse.json({ error: `No package retained for "${storyId}"` }, { status: 404 });
  }
  return NextResponse.json(pkg);
}
