import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';

export const dynamic = 'force-dynamic';

export async function GET() {
  const repository = storyRepository();
  const storyIds = await repository.listStoryIds();

  const stories = [];
  for (const storyId of storyIds) {
    const pointer = await repository.getPointer(storyId);
    if (pointer === null) continue;
    stories.push({
      story_id: storyId,
      current_package_version: pointer.current_package_version,
      retained_versions: await repository.listPackageVersions(storyId),
    });
  }

  return NextResponse.json({ stories });
}
