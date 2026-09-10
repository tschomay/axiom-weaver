import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';

export const dynamic = 'force-dynamic';

/**
 * One telling, by run id — the address ADR 0014 §3 makes a Compiled edition shareable at, and the
 * only thing a reader ever rejoins (their own still-in-flight run, never a completed one and
 * never someone else's).
 *
 * While the run is going, this answers the progress question and nothing else: scene count, not a
 * percentage, and never prose (§4). `?include=scenes` returns the edition's prose once it is
 * complete — a reader reads the finished edition, exactly as they would a Baked one.
 *
 * What it never exposes is the Story Package behind the edition — Scene Cards, World Model seed,
 * Voice Card stay author-only however many editions get shared (ADR 0015 §5).
 */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const repository = storyRepository();

  const manifest = await repository.getEditionManifest(runId);
  if (manifest === null) {
    return NextResponse.json({ error: `No telling with run id "${runId}"` }, { status: 404 });
  }

  const compiled = manifest.scenes.length;
  const body: Record<string, unknown> = {
    run_id: runId,
    story_id: manifest.story_id,
    package_version: manifest.package_version,
    status: manifest.status,
    degraded: manifest.degraded,
    progress: {
      scenes_compiled: compiled,
      scene_count: manifest.scene_count,
      text:
        manifest.status === 'running'
          ? `compiling scene ${Math.min(compiled + 1, manifest.scene_count)} of ${manifest.scene_count}`
          : `${compiled} of ${manifest.scene_count} scenes`,
    },
    started_at: manifest.started_at,
    completed_at: manifest.completed_at,
  };

  const include = new URL(request.url).searchParams.get('include');
  if (include === 'scenes') {
    if (manifest.status !== 'complete') {
      return NextResponse.json(
        { ...body, error: 'the telling is not finished; there is nothing to read yet' },
        { status: 409 },
      );
    }
    body['scenes'] = (await repository.getEditionScenes(runId)).map((scene) => ({
      scene_id: scene.scene_id,
      scene_index: scene.scene_index,
      prose: scene.prose,
    }));
  }

  return NextResponse.json(body);
}
