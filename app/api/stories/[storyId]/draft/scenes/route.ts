import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { scenesInOrder } from '@/schema/story-package';

export const dynamic = 'force-dynamic';

/**
 * The Working Draft's prose, in order — what the author has actually built so far.
 *
 * A draft is not an edition: it is overwritten scene by scene as the author recompiles, it may
 * stop halfway through the story, and some of it may be stale (ADR 0015 §1). All three are
 * legitimate states, so this returns what exists rather than refusing an incomplete draft the way
 * a half-finished telling is refused.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;
  const repository = storyRepository();

  const pkg = await repository.getCurrentPackage(storyId);
  if (pkg === null) {
    return NextResponse.json({ error: `No package retained for "${storyId}"` }, { status: 404 });
  }

  const manifest = await repository.getDraftManifest(storyId);
  const stale = new Map(manifest.scenes.map((scene) => [scene.scene_id, scene.stale]));

  const scenes = [];
  for (const card of scenesInOrder(pkg)) {
    const stored = await repository.getDraftScene(storyId, card.order);
    if (stored === null) continue;
    scenes.push({
      scene_id: stored.scene_id,
      scene_index: stored.scene_index,
      prose: stored.prose,
      compiled_against_package_version: stored.compiled_against_package_version,
      stale: stale.get(stored.scene_id) ?? false,
    });
  }

  return NextResponse.json({
    story_id: storyId,
    title: pkg.metadata.title,
    scene_count: pkg.scene_cards.length,
    scenes,
  });
}
