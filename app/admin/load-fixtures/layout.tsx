import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Load fixtures — Axiom Weaver admin',
  robots: { index: false, follow: false },
};

export default function LoadFixturesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
