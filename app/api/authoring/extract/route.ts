import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { bearerToken, isAuthorizedAuthorRequest } from '@/admin/authorize';
import { storyRepository } from '@/persistence';
import { liveClient } from '@/arc/generator';
import { runExtract } from '@/authoring/extract-run';
import { mintAuthoringRunId } from '@/authoring/run';
import {
  PASTED_SOURCE_MAX_WORDS,
  PASTED_SOURCE_MIN_WORDS,
  SOURCE_MANIFESTS,
  loadSource,
  pastedSource,
  type LoadedSource,
} from '@/extraction/sources';
import { isSelectableWriterModel, writerModelFromEnv } from '@/writer/model-client';

export const dynamic = 'force-dynamic';

/**
 * "Import existing prose" (ADR 0021, #173): extract a Fabula and World Model seed from a story's
 * text, then segment it into Scene Cards, as one Authoring run.
 *
 * Two ways to name the prose:
 *
 * - `text` (+ `title`, optional `author`) — raw pasted prose, the flow's real purpose. Built into
 *   a `LoadedSource` by `pastedSource`, not a manifest lookup: a pasted story has no edition, URL
 *   or line range to pin.
 * - `fixture_source` — one of `SOURCE_MANIFESTS`' ids (`cinderella`, `a-christmas-carol`,
 *   `the-machine-stops`). The same public-domain text `npm run extract` reads, fetched and sliced
 *   the same way, so a UI run can be compared against `fixtures/extraction/runs/` before anyone
 *   trusts it on novel text (#173's verification step) — without pasting 28,000 words on a phone.
 *
 * Same mint-id/`202`/poll shape and cost guard as `POST /api/authoring/generate`: the POST is the
 * explicit confirm action, `model` is restricted to `SELECTABLE_WRITER_MODELS`, and there is no
 * stand-in. Extract adds a hard word bound (`PASTED_SOURCE_MAX_WORDS`), because extraction's call
 * count grows with the text and a pasted story's length is otherwise unbounded on a shared key.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null) {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || !isSelectableWriterModel(body.model)) {
      return NextResponse.json(
        { error: `"${String(body.model)}" is not a writer model this deployment will call` },
        { status: 400 },
      );
    }
  }
  const model = typeof body.model === 'string' ? body.model : writerModelFromEnv();

  const hasText = body.text !== undefined;
  const hasFixture = body.fixture_source !== undefined;
  if (hasText === hasFixture) {
    return NextResponse.json(
      { error: 'give exactly one of text (pasted prose) or fixture_source' },
      { status: 400 },
    );
  }

  if (hasFixture) {
    const known = SOURCE_MANIFESTS.map((manifest) => manifest.id);
    if (typeof body.fixture_source !== 'string' || !known.includes(body.fixture_source)) {
      return NextResponse.json(
        { error: `fixture_source must be one of ${known.join(', ')}` },
        { status: 400 },
      );
    }
  } else {
    if (typeof body.text !== 'string') {
      return NextResponse.json({ error: 'text must be a string' }, { status: 400 });
    }
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return NextResponse.json({ error: 'title is required with pasted text' }, { status: 400 });
    }
    if (body.author !== undefined && body.author !== null && typeof body.author !== 'string') {
      return NextResponse.json({ error: 'author must be a string' }, { status: 400 });
    }
  }

  const runId = mintAuthoringRunId(new Date(), 'extract');

  let source: LoadedSource;
  if (hasFixture) {
    try {
      // A serverless filesystem is read-only outside the temp dir, so the fetched volume is
      // cached there rather than under `.data/sources/` the way the CLI caches it.
      source = await loadSource(body.fixture_source as string, {
        cacheDir: path.join(tmpdir(), 'axiom-sources'),
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'could not fetch the fixture source' },
        { status: 502 },
      );
    }
  } else {
    source = pastedSource({
      id: runId,
      title: body.title as string,
      author: (body.author as string | null | undefined) ?? null,
      text: body.text as string,
    });
  }

  if (source.words < PASTED_SOURCE_MIN_WORDS) {
    return NextResponse.json(
      { error: `the text is ${source.words} words; extraction needs at least ${PASTED_SOURCE_MIN_WORDS}` },
      { status: 400 },
    );
  }
  if (source.words > PASTED_SOURCE_MAX_WORDS) {
    return NextResponse.json(
      {
        error:
          `the text is ${source.words.toLocaleString('en-US')} words; the limit is ` +
          `${PASTED_SOURCE_MAX_WORDS.toLocaleString('en-US')} — nothing longer has been measured`,
      },
      { status: 413 },
    );
  }

  let client;
  try {
    client = liveClient();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'extraction is not configured' },
      { status: 503 },
    );
  }

  const repository = storyRepository();

  void runExtract({ source, client, repository, runId, model }).catch((error: unknown) => {
    // The run's own failure path has already marked the manifest `failed` and flushed it; this is
    // only so a crash outside that path is not silent in the server log.
    console.error(`authoring run ${runId} stopped:`, error);
  });

  return NextResponse.json(
    {
      run_id: runId,
      model,
      words: source.words,
      status_path: `/api/authoring/extract/${runId}`,
    },
    { status: 202 },
  );
}
