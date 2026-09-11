import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { runTelling } from '@/edition/run-loop';
import { mintRunId } from '@/edition/edition';
import { estimateCompile } from '@/edition/run-report';
import { buildTellingsView } from '@/edition/tellings-view';
import {
  GeminiClient,
  isSelectableWriterModel,
  writerModelFromEnv,
} from '@/writer/model-client';
import { SyntheticWriterClient } from '@/writer/synthetic-client';
import { scenesInOrder } from '@/schema/story-package';

export const dynamic = 'force-dynamic';

/**
 * The three-way reader choice's third arm (ADR 0014 §3), and the read side of the other two.
 *
 * GET lists what a reader can pick from: the Baked edition, the story's saved runs, and what a
 * fresh telling would cost in wall-clock time (never in money — ADR 0014 §5).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;
  const repository = storyRepository();

  const pkg = await repository.getCurrentPackage(storyId);
  if (pkg === null) {
    return NextResponse.json({ error: `No package retained for "${storyId}"` }, { status: 404 });
  }

  return NextResponse.json(await buildTellingsView(repository, pkg));
}

/**
 * "Generate a new telling."
 *
 * A brand-new run id every time (ADR 0014 §3) — never a silent reuse of a previous run, and never
 * another reader's. The response hands back that id immediately, because the reader's only
 * reader-facing state during a compile is scene-count progress against it (§4), and rejoining
 * their own still-in-flight run means presenting this id again.
 *
 * **Where the Workflow goes.** On Vercel this handler starts a durable Workflow run and returns;
 * the loop's `StepRunner` seam is what WDK's `"use step"` wraps, per ADR 0014 §2. Started inline
 * here — deliberately not awaited — the same loop runs to completion in a long-lived process
 * (`npm run dev`, `npm run telling`), which is what makes the mechanism developable before the
 * platform is wired up. It is not a substitute for durability: a serverless invocation that ends
 * takes an un-awaited loop with it, and only the scenes already flushed to Blob survive.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;
  const repository = storyRepository();

  const pkg = await repository.getCurrentPackage(storyId);
  if (pkg === null) {
    return NextResponse.json({ error: `No package retained for "${storyId}"` }, { status: 404 });
  }

  // The same choice the author-time compile offers, for the same reason: on a rate-limited key a
  // whole telling is the day's allowance, and proving the loop runs is a different question from
  // judging what it wrote (AGENTS.md, The Gemini API key). Never chosen silently — the run report
  // records the model every call used either way.
  const body = (await request.json().catch(() => null)) as
    | { writer?: unknown; model?: unknown }
    | null;
  if (body?.writer !== undefined && body.writer !== 'live' && body.writer !== 'stand_in') {
    return NextResponse.json({ error: 'writer must be "live" or "stand_in"' }, { status: 400 });
  }
  const requestedWriter = body?.writer === 'stand_in' ? 'stand_in' : 'live';

  // A named model is how a reader takes up the offer a quota-failed run leaves on the manifest.
  // Their choice, never a default — the run report records what actually wrote each scene.
  if (body?.model !== undefined) {
    if (typeof body.model !== 'string' || !isSelectableWriterModel(body.model)) {
      return NextResponse.json(
        { error: `"${String(body.model)}" is not a writer model this deployment will call` },
        { status: 400 },
      );
    }
  }
  const writerModel = typeof body?.model === 'string' ? body.model : writerModelFromEnv();

  const live = requestedWriter === 'live' ? GeminiClient.fromEnv() : null;
  const client = live ?? new SyntheticWriterClient(pkg);
  const runId = mintRunId(storyId);
  const scenes = scenesInOrder(pkg).length;

  void runTelling({
    pkg,
    client,
    repository,
    runId,
    writerModel,
  }).catch((error: unknown) => {
    // The run's own failure path has already marked the manifest `failed` and flushed it; this is
    // only so a crash is not silent in the server log.
    console.error(`telling ${runId} stopped:`, error);
  });

  return NextResponse.json(
    {
      run_id: runId,
      story_id: storyId,
      scene_count: scenes,
      writer: {
        live: live !== null,
        requested: requestedWriter,
        model:
          live !== null
            ? writerModel
            : requestedWriter === 'stand_in'
              ? 'stand-in writer — composed from the Scene Cards, no model called'
              : 'stand-in writer — no GEMINI_API_KEY configured, so no model was called',
      },
      estimate: estimateCompile(scenes, await repository.getRunReports(storyId)),
      status_path: `/api/tellings/${runId}`,
    },
    { status: 202 },
  );
}
