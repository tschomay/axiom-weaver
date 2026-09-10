import { notFound } from 'next/navigation';
import { storyRepository } from '@/persistence';
import { buildRunReportView } from '@/edition/report-view';
import { RunReportView } from './runs-view';

export const dynamic = 'force-dynamic';

/**
 * The run report (ADR 0016 §1, surface 4): per-Scene-Card aggregation across read-time runs, plus
 * the manual Baked-promotion action ADR 0014 §9 requires exist somewhere.
 *
 * Visited occasionally, after runs exist to aggregate — not part of the per-compile loop the
 * other surfaces live in.
 */
export default async function RunsPage({ params }: { params: Promise<{ storyId: string }> }) {
  const { storyId } = await params;
  const repository = storyRepository();
  const pkg = await repository.getCurrentPackage(storyId);
  if (pkg === null) notFound();

  return <RunReportView storyId={storyId} initial={await buildRunReportView(repository, pkg)} />;
}
