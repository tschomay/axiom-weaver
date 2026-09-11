import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { WRITER_MODEL, quotaOffer } from '@/writer/model-client';
import { hasStoppedReporting, msSinceLastReport } from '@/edition/edition';

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
 * ADR 0014 §4 delivers that progress over the Workflow's own resumable stream, so one mechanism
 * serves both reconnect-safety and the progress UI. Polling this route is the stand-in until the
 * loop runs on that platform, and it reads the same number from the same place the stream would:
 * the manifest's scene index, which is written by the step that completed the scene.
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
    updated_at: manifest.updated_at,
    /**
     * How long since the run reported anything, and whether that is long enough to stop believing
     * it. A loop can die without ever reaching its own failure path — a restarted dev server, a
     * serverless invocation ending and taking the un-awaited loop with it — and `status` would go
     * on saying `running` for good. Computed on read; nothing is written to an edition from here.
     */
    stalled_ms: msSinceLastReport(manifest),
    stopped_reporting: hasStoppedReporting(manifest),
    // Why a run stopped, when it stopped for a reason a surface can act on. A spent daily quota is
    // the one such reason: the run is over either way, but another model would get past it today,
    // and the same offer the author-time compile makes is put here to the reader.
    failure: manifest.failure,
    quota:
      manifest.failure?.quota_exhausted_for_today === true
        ? quotaOffer(manifest.failure.model ?? WRITER_MODEL, manifest.failure.detail)
        : null,
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
