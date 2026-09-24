import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { lintPackage } from '@/authoring/lint';
import { importSummary } from '@/authoring/transfer';
import type { AuthoringRunKind } from '@/authoring/run';

/**
 * Poll an Authoring run (ADR 0021) — the Generate/Extract counterpart of
 * `GET /api/tellings/[runId]`, over stages instead of scenes. Shared by
 * `GET /api/authoring/generate/[runId]` and `GET /api/authoring/extract/[runId]`; each only
 * answers for its own kind, so a run id is never reported under the other entry point's path.
 *
 * While the run is going, this answers the progress question only: which stage, and the stage's
 * own text ("drafting the arc", "pass 3/5 — events, per window…"). Once the run completes, it
 * also returns the produced package plus a fresh lint and import summary — the same shape
 * `new-story-view.tsx`'s import-preview screen already renders for a pasted/uploaded package
 * (ADR 0021 decision 5), so a produced package needs no separate preview path.
 */
export async function pollAuthoringRun(runId: string, kind: AuthoringRunKind): Promise<Response> {
  const repository = storyRepository();

  const manifest = await repository.getAuthoringRunManifest(runId);
  if (manifest === null || manifest.kind !== kind) {
    return NextResponse.json({ error: `No ${kind} run with run id "${runId}"` }, { status: 404 });
  }

  const body: Record<string, unknown> = {
    run_id: runId,
    kind: manifest.kind,
    status: manifest.status,
    stage: manifest.stage,
    progress: { text: manifest.stage_text },
    requested_model: manifest.requested_model,
    models_used: manifest.models_used,
    cost_usd: manifest.cost_usd,
    started_at: manifest.started_at,
    completed_at: manifest.completed_at,
    updated_at: manifest.updated_at,
    failure: manifest.failure,
    result: manifest.result,
  };

  if (manifest.status !== 'complete') {
    return NextResponse.json(body);
  }

  const pkg = await repository.getAuthoringRunResult(runId);
  if (pkg === null) {
    // The manifest says complete but the package write did not land — report it rather than lie.
    return NextResponse.json(
      { ...body, error: 'the run completed but its package could not be read back' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ...body,
    package: pkg,
    lint: lintPackage(pkg),
    summary: importSummary(pkg),
  });
}
