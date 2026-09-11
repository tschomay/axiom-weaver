import { notFound } from 'next/navigation';
import { storyRepository } from '@/persistence';
import { buildTellingsView } from '@/edition/tellings-view';
import { ReadView } from './read-view';

export const dynamic = 'force-dynamic';

/**
 * Generate a telling, watch it compile, and read what came out (ADR 0014 §3/§4).
 *
 * This is the whole compiler behind one button: a fresh run id, one writer call per scene in
 * order, each scene flushed before the next begins, and the finished edition handed back as
 * prose. The three author surfaces are for working on the machine a card at a time; this is for
 * seeing what the machine produces.
 */
export default async function ReadPage({ params }: { params: Promise<{ storyId: string }> }) {
  const { storyId } = await params;
  const repository = storyRepository();
  const pkg = await repository.getCurrentPackage(storyId);
  if (pkg === null) notFound();

  return <ReadView storyId={storyId} initial={await buildTellingsView(repository, pkg)} />;
}
