import { NextResponse } from 'next/server';
import { lintPackage } from '@/authoring/lint';

export const dynamic = 'force-dynamic';

/**
 * Lint a package body without saving anything (ADR 0017 §4/§6).
 *
 * What the import path validates against before it writes a Manuscript, and what a screen can ask
 * of a package it has not committed to. Pure: it reads nothing and writes nothing, which is why
 * it needs no author gate — it tells a caller only what the caller already sent.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { package?: unknown } | null;
  if (body === null || body.package === undefined) {
    return NextResponse.json({ error: 'Expected a JSON body with a `package`' }, { status: 400 });
  }
  return NextResponse.json(lintPackage(body.package));
}
