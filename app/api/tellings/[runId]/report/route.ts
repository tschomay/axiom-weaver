import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';

export const dynamic = 'force-dynamic';

/**
 * One run's report, whole — every scene's calls, diagnostics and continuity repairs.
 *
 * The aggregated, per-Scene-Card view is the story-level route; this is what an author opens when
 * the aggregate has pointed them at a card and they want the run that produced it. It is safe to
 * hand out with the edition: ADR 0014 §8 keeps the assembled prompt envelope out of the report on
 * purpose, so nothing here carries what a shared edition should not.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const report = await storyRepository().getRunReport(runId);
  if (report === null) {
    return NextResponse.json({ error: `No run report for "${runId}"` }, { status: 404 });
  }
  return NextResponse.json(report);
}
