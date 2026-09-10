import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { buildRunReportView } from '@/edition/report-view';

export const dynamic = 'force-dynamic';

/**
 * The run report (ADR 0016 §1, surface 4), aggregated per Scene Card across every run the story
 * has — ADR 0014 §8's "Scene 13 has degraded on 4 of 20 reads", which is the signal that names
 * which cards are underspecified.
 *
 * The runs are listed alongside it because the manual Baked-promotion action lives on this
 * screen (ADR 0014 §9), and it needs to know which runs may be promoted.
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

  return NextResponse.json(await buildRunReportView(repository, pkg));
}
