'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The four surfaces ADR 0016 §1 settled on, minus the one that is not a screen — plus the
 * edition comparison ADR 0015 §6 specifies, which belongs to no surface in ADR 0016 because it is
 * a property of Compiled editions rather than of the authoring loop.
 */
export function StoryNav({ storyId }: { storyId: string }) {
  const pathname = usePathname();
  const base = `/stories/${storyId}`;
  const links = [
    { href: base, label: 'Working Draft' },
    { href: `${base}/inspector`, label: 'World & Discourse' },
    { href: `${base}/runs`, label: 'Run report' },
    { href: `${base}/read`, label: 'Read' },
    { href: `${base}/diff`, label: 'Compare' },
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
    </nav>
  );
}
