import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Axiom Weaver',
  description:
    'The Dynamic Novel Compiler — a story authored once as a Story Package and performed into prose on every read.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
