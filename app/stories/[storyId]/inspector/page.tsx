import { notFound } from 'next/navigation';
import { storyRepository } from '@/persistence';
import { buildInspectorPayload } from '@/draft/inspector';
import { scenesInOrder } from '@/schema/story-package';
import { InspectorView } from './inspector-view';

export const dynamic = 'force-dynamic';

/**
 * The World & Discourse inspector (ADR 0016 §1, surface 2).
 *
 * Two tabs over one scene-index scrubber: the World Model and the told-ledger are
 * `CONTEXT.md`'s two memories, and an author asking "what does my story know as of scene N?"
 * wants to ask it of both from the same place.
 */
export default async function InspectorPage({
  params,
}: {
  params: Promise<{ storyId: string }>;
}) {
  const { storyId } = await params;
  const repository = storyRepository();
  const pkg = await repository.getCurrentPackage(storyId);
  if (pkg === null) notFound();

  const sceneCards = scenesInOrder(pkg).map((card) => ({ id: card.id, order: card.order }));

  return (
    <InspectorView
      storyId={storyId}
      sceneCards={sceneCards}
      initial={await buildInspectorPayload(repository, pkg, Number.POSITIVE_INFINITY)}
    />
  );
}
