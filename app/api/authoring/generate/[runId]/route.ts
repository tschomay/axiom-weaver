import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { lintPackage } from '@/authoring/lint';
import { importSummary } from '@/authoring/transfer';

export const dynamic = 'force-dynamic';

/**
 * Poll an Authoring run (ADR 0021, #172) — the Generate/Extract counterpart of
 * `GET /api/tellings/[runId]`, over stages instead of scenes.
 *
 * While the run is going, this answers the progress question only: which stage, and the stage's
 * own text ("drafting the arc", "pass 2/4 — scene properties"). Once the run completes, it also
 * returns the produced package plus a fresh lint and import summary — the same shape
 * `new-story-view.tsx`'s import-preview screen already renders for a pasted/uploaded package
 * (ADR 0021 decision 5), so a generated package needs no separate preview path.
 */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const repository = storyRepository();

  const manifest = await repository.getAuthoringRunManifest(runId);
  if (manifest === null) {
    return NextResponse.json({ error: `No authoring run with run id "${runId}"` }, { status: 404 });
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
