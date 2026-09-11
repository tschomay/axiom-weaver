import { notFound } from 'next/navigation';
import { storyRepository } from '@/persistence';
import { DiffView } from './diff-view';

export const dynamic = 'force-dynamic';

/**
 * Two tellings, side by side (ADR 0015 §6).
 *
 * The one screen where "same story, told uniquely each time" is something you can look at rather
 * than something the project asserts. It shows what the engine *chose* — per scene, the Scene
 * Digest fields that came out differently, the volitional proposals the two runs resolved
 * differently, and both performances to read.
 *
 * Never a line-level text diff of the prose. Two performances of one Scene Card share almost no
 * words; a text diff would be red from top to bottom and tell a reader nothing about what varied.
 */
export default async function DiffPage({ params }: { params: Promise<{ storyId: string }> }) {
  const { storyId } = await params;
  const repository = storyRepository();

  const pkg = await repository.getCurrentPackage(storyId);
  if (pkg === null) notFound();

  const index = await repository.getRunIndex(storyId);
  // Only completed runs: a run still compiling has scenes that do not exist yet, and the missing
  // ones would read as variance rather than as absence.
  const runs = [...index.runs].reverse().filter((run) => run.status === 'complete');

  return <DiffView storyId={storyId} title={pkg.metadata.title} runs={runs} />;
}
