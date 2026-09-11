import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { storyRepository } from '@/persistence';
import { StoryNav } from './story-nav';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ storyId: string }>;
}): Promise<Metadata> {
  const { storyId } = await params;
  const repository = storyRepository();
  const pkg = await repository.getCurrentPackage(storyId);
  const title = pkg?.metadata.title ?? (await repository.getManuscript(storyId))?.package.metadata.title;
  return { title: title === undefined ? 'Axiom Weaver' : `${title} — Axiom Weaver` };
}

/**
 * The app shell for one story's author surfaces (ADR 0016 §1).
 *
 * Deliberately thin: the map's Out of scope excludes app chrome beyond what feeds the mechanics,
 * so this is a title, the package version the author is working against, and a way between the
 * screens the surfaces occupy.
 *
 * A story that has never published still belongs here. It has a Manuscript and nothing else, so
 * the four read surfaces have nothing to show and the nav says so — but the story exists, and
 * sending it to a 404 would mean the one screen that *can* do something with it were unreachable
 * from the one URL an author would guess.
 */
export default async function StoryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ storyId: string }>;
}) {
  const { storyId } = await params;
  const repository = storyRepository();
  const pkg = await repository.getCurrentPackage(storyId);
  const manuscript = pkg === null ? await repository.getManuscript(storyId) : null;
  if (pkg === null && manuscript === null) notFound();

  const title = pkg?.metadata.title ?? manuscript?.package.metadata.title ?? storyId;
  const scenes = pkg?.scene_cards.length ?? manuscript?.package.scene_cards.length ?? 0;

  return (
    <main className="wide">
      <p className="meta">
        <Link href="/">← stories</Link>
      </p>
      <h1>{title === '' ? storyId : title}</h1>
      <p className="lede meta">
        {storyId} ·{' '}
        {pkg === null ? 'draft — never published' : `package_version ${pkg.package_version}`} ·{' '}
        {scenes} scene card{scenes === 1 ? '' : 's'}
      </p>
      <StoryNav storyId={storyId} published={pkg !== null} />
      {children}
    </main>
  );
}
