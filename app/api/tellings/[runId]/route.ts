import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { WRITER_MODEL, quotaOffer } from '@/writer/model-client';
import { STALL_THRESHOLD_MS } from '@/edition/run-loop';
import type { EditionManifest } from '@/edition/edition';

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
    // Why a run stopped, when it stopped for a reason a surface can act on. A spent daily quota is
    // the one such reason: the run is over either way, but another model would get past it today,
    // and the same offer the author-time compile makes is put here to the reader.
    failure: manifest.failure,
    quota:
      manifest.failure?.quota_exhausted_for_today === true
        ? quotaOffer(manifest.failure.model ?? WRITER_MODEL, manifest.failure.detail)
        : null,
    // ADR 0014 §7's escape hatch. The loop emits `baked_fallback_offered` to an in-process
    // listener, which the HTTP path does not have — a reader polling this route saw the progress
    // bar stop and was offered nothing. Computed here from the clock the flush writes, so the
    // same poll that carries the scene count carries the offer.
    baked_fallback: await stallOffer(repository, manifest),
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

/**
 * The offer a reader gets when a run stops advancing (ADR 0014 §7).
 *
 * Read the Baked edition now; the live run keeps compiling, unattended, whether they take it or
 * not — the offer is a progress event, never an instruction to the loop, so nothing here touches
 * the run. `null` unless the run is genuinely still going, has been quiet past the threshold, and
 * the story actually has a Baked edition to fall back to: offering one that does not exist would
 * be worse than the stalled bar.
 */
async function stallOffer(
  repository: ReturnType<typeof storyRepository>,
  manifest: EditionManifest,
  now: number = Date.now(),
): Promise<{ run_id: string; stalled_ms: number } | null> {
  if (manifest.status !== 'running') return null;

  const since = manifest.last_scene_completed_at ?? manifest.started_at;
  const stalledMs = now - Date.parse(since);
  if (!Number.isFinite(stalledMs) || stalledMs < STALL_THRESHOLD_MS) return null;

  const baked = await repository.getBakedPointer(manifest.story_id);
  return baked === null ? null : { run_id: baked.run_id, stalled_ms: stalledMs };
}
