import { NextResponse } from 'next/server';
import { storyRepository } from '@/persistence';
import { runTelling } from '@/edition/run-loop';
import { mintRunId } from '@/edition/edition';
import { estimateCompile } from '@/edition/run-report';
import { GeminiClient, writerModelFromEnv } from '@/writer/model-client';
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

  const index = await repository.getRunIndex(storyId);
  const estimate = estimateCompile(
    scenesInOrder(pkg).length,
    await repository.getRunReports(storyId),
  );

  return NextResponse.json({
    story_id: storyId,
    baked: await repository.getBakedPointer(storyId),
    runs: index.runs,
    estimate,
  });
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
  _request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;
  const repository = storyRepository();

  const pkg = await repository.getCurrentPackage(storyId);
  if (pkg === null) {
    return NextResponse.json({ error: `No package retained for "${storyId}"` }, { status: 404 });
  }

  const client = GeminiClient.fromEnv() ?? new SyntheticWriterClient(pkg);
  const runId = mintRunId(storyId);
  const scenes = scenesInOrder(pkg).length;

  void runTelling({
    pkg,
    client,
    repository,
    runId,
    writerModel: writerModelFromEnv(),
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
      estimate: estimateCompile(scenes, await repository.getRunReports(storyId)),
      status_path: `/api/tellings/${runId}`,
    },
    { status: 202 },
  );
}
