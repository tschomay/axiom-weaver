import { NextResponse } from 'next/server';
import { bearerToken, isAuthorizedAuthorRequest } from '@/admin/authorize';
import { MAX_AVOID, generateSurprisePremise } from '@/arc/surprise-premise';
import { GeminiClient, writerModelFromEnv } from '@/writer/model-client';

export const dynamic = 'force-dynamic';

/**
 * "Surprise me": a new premise from the model on every press (`src/arc/surprise-premise.ts`).
 *
 * Author-gated like the Generate route, because it spends a (small) model call. It only returns a
 * premise and saves nothing: the author reviews it in the form and still has to press Generate.
 *
 * `avoid` is the loglines the author has already been shown this session, so a second press moves
 * somewhere new. A `503` (no key) or `502` (the call failed) tells the page to fall back to the
 * ready-made list.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { avoid?: unknown } | null;
  const avoid = Array.isArray(body?.avoid)
    ? body.avoid
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
        .map((entry) => entry.trim().slice(0, 400))
        .slice(-MAX_AVOID)
    : [];

  const client = GeminiClient.fromEnv();
  if (client === null) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not set' }, { status: 503 });
  }

  try {
    const result = await generateSurprisePremise({ client, model: writerModelFromEnv(), avoid });
    return NextResponse.json({ ...result.premise, model: result.model });
  } catch (error) {
    // The detail can be a whole API error body, so the page gets a short reason to show.
    const detail = error instanceof Error ? error.message : String(error);
    const reason = /spending cap/i.test(detail)
      ? 'the Gemini project has reached its spending cap'
      : /\b429\b/.test(detail)
        ? 'the model is rate-limited right now'
        : 'the model call failed';
    return NextResponse.json({ error: reason, detail }, { status: 502 });
  }
}
