import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { worldModelAsOf } from '@/world-model/state-log';

export const dynamic = 'force-dynamic';

/**
 * "World Model as of scene N" — the seed replayed forward through the state-update commit log
 * (ADR 0016 §2). This is the surface ADR 0016's World & Discourse inspector scrubber reads from.
 *
 * `?scene=` defaults to the whole log. `?scene=0` is the seed itself.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;
  const repository = storyRepository();

  const seed = await repository.getSeedWorldModel(storyId);
  if (seed === null) {
    return NextResponse.json({ error: `No package retained for "${storyId}"` }, { status: 404 });
  }

  const raw = new URL(request.url).searchParams.get('scene');
  const sceneIndex = raw === null ? Number.POSITIVE_INFINITY : Number.parseInt(raw, 10);
  if (Number.isNaN(sceneIndex) || sceneIndex < 0) {
    return NextResponse.json({ error: `Invalid scene index "${raw}"` }, { status: 400 });
  }

  const log = await repository.getDraftStateLog(storyId);
  const model = worldModelAsOf(seed, log, sceneIndex);

  return NextResponse.json({
    story_id: storyId,
    as_of_scene: Number.isFinite(sceneIndex) ? sceneIndex : log.lastSceneIndex(),
    log_entries: log.length,
    world_model: model.toJSON(),
  });
}
