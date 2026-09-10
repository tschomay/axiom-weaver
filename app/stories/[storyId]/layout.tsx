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
  const pkg = await storyRepository().getCurrentPackage(storyId);
  return { title: pkg === null ? 'Axiom Weaver' : `${pkg.metadata.title} — Axiom Weaver` };
}

/**
 * The app shell for one story's author surfaces (ADR 0016 §1).
 *
 * Deliberately thin: the map's Out of scope excludes app chrome beyond what feeds the mechanics,
 * so this is a title, the package version the author is working against, and a way between the
 * three screens the four surfaces occupy.
 */
export default async function StoryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ storyId: string }>;
}) {
  const { storyId } = await params;
  const pkg = await storyRepository().getCurrentPackage(storyId);
  if (pkg === null) notFound();

  return (
    <main className="wide">
      <p className="meta">
        <Link href="/">← stories</Link>
      </p>
      <h1>{pkg.metadata.title}</h1>
      <p className="lede meta">
        {storyId} · package_version {pkg.package_version} · {pkg.scene_cards.length} scene cards
      </p>
      <StoryNav storyId={storyId} />
      {children}
    </main>
  );
}
