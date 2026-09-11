'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The four surfaces ADR 0016 §1 settled on, minus the one that is not a screen — plus the
 * edition comparison ADR 0015 §6 specifies, which belongs to no surface in ADR 0016 because it is
 * a property of Compiled editions rather than of the authoring loop, plus the authoring screen
 * ADR 0017 adds, which runs the other way: it is where the package the rest of them read from
 * comes from.
 *
 * A story that has never published has only the last of these. Linking to four screens that would
 * all 404 would be worse than saying there is nothing there yet.
 */
export function StoryNav({ storyId, published }: { storyId: string; published: boolean }) {
  const pathname = usePathname();
  const base = `/stories/${storyId}`;
  const links = [
    ...(published
      ? [
          { href: base, label: 'Working Draft' },
          { href: `${base}/inspector`, label: 'World & Discourse' },
          { href: `${base}/runs`, label: 'Run report' },
          { href: `${base}/read`, label: 'Read' },
          { href: `${base}/diff`, label: 'Compare' },
        ]
      : []),
    { href: `${base}/edit`, label: 'Edit' },
  ];

  return (
    <nav className="story-nav">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={pathname === link.href ? 'current' : undefined}
        >
          {link.label}
        </Link>
      ))}
      {published ? null : (
        <span className="meta">
          nothing published yet — the read surfaces appear once there is a version to read
        </span>
      )}
    </nav>
  );
}
