import { notFound } from 'next/navigation';
import { storyRepository } from '@/persistence';
import { buildDraftView } from '@/draft/draft-view';
import { WorkingDraftView } from './working-draft-view';

export const dynamic = 'force-dynamic';

/**
 * The Working Draft and the scene compile view (ADR 0016 §1, surfaces 1 and 3).
 *
 * Two surfaces on one screen because that is where they belong: author-time compiling is stepwise,
 * one card at a time, so the diagnostics and proposals a compile produces are scoped to the card
 * the author is already looking at, and the stale badges a recompile propagates land on the same
 * list they just compiled from.
 */
export default async function WorkingDraftPage({
  params,
}: {
  params: Promise<{ storyId: string }>;
}) {
  const { storyId } = await params;
  const repository = storyRepository();
  const pkg = await repository.getCurrentPackage(storyId);
  if (pkg === null) notFound();

  return <WorkingDraftView storyId={storyId} initial={await buildDraftView(repository, pkg)} />;
}
