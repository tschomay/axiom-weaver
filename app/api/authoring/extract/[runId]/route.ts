import { pollAuthoringRun } from '../../poll';

export const dynamic = 'force-dynamic';

/** Poll an Extract run (ADR 0021, #173). The shape is `pollAuthoringRun`'s, shared with Generate. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return pollAuthoringRun(runId, 'extract');
}
