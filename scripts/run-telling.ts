/**
 * Run the read-time run loop end to end and persist a Compiled edition.
 *
 *   npm run telling                            # cinderella, stand-in writer or live
 *   npm run telling -- a-christmas-carol
 *   npm run telling -- cinderella --verbose
 *   npm run telling -- cinderella --promote    # promote the run to Baked afterwards
 *   npm run telling -- cinderella --model gemini-3.5-flash-lite   # trade prose for a cheap call
 *
 * `--model` (or `AXIOM_WRITER_MODEL`) exists to prove the loop actually reaches the API before
 * spending a real call on prose you intend to judge: Flash-Lite is far cheaper and faster than the
 * writer model, and writes worse prose — the right trade for proving the mechanism, the wrong one
 * for judging what it wrote. The run report shows what a run actually cost either way. See
 * `AGENTS.md`.
 *
 * This is what "pressing generate a new telling" does, minus the button (the author- and
 * reader-facing screens are ticket 4's). With `GEMINI_API_KEY` set every scene is a real writer
 * call; without one the stand-in writer answers from the Scene Cards, and this script says so on
 * every run rather than skipping quietly.
 *
 * The edition lands in the local blob store (`.data/edition/{runId}/…`) unless
 * `BLOB_READ_WRITE_TOKEN` is set, in which case it lands in Vercel Blob — same paths either way.
 */

import { readFixturePackage } from '../src/fixtures/load';
import { storyRepository } from '../src/persistence';
import {
  GeminiClient,
  WRITER_MODEL,
  writerModelFromEnv,
  type ModelClient,
} from '../src/writer/model-client';
import { SyntheticWriterClient } from '../src/writer/synthetic-client';
import { runTelling, progressText } from '../src/edition/run-loop';
import { renderRunReport } from '../src/edition/report-view';
import { estimateCompile } from '../src/edition/run-report';
import { scenesInOrder } from '../src/schema/story-package';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const promote = args.includes('--promote');
  const modelFlag = args.indexOf('--model');
  const writerModel = modelFlag === -1 ? writerModelFromEnv() : (args[modelFlag + 1] ?? '');
  const fixture =
    args.find((arg) => !arg.startsWith('--') && arg !== writerModel) ?? 'cinderella';

  const pkg = await readFixturePackage(fixture);
  const repository = storyRepository();
  // The edition pins a `package_version`, which has to stay dereferenceable afterwards
  // (ADR 0015 §2) — so the snapshot is retained before the run, not after it.
  await repository.putPackage(pkg);

  const live = GeminiClient.fromEnv();
  const client: ModelClient = live ?? new SyntheticWriterClient(pkg);

  const history = await repository.getRunReports(pkg.story_id);
  const estimate = estimateCompile(scenesInOrder(pkg).length, history);

  console.log(`\n${'#'.repeat(78)}`);
  console.log(`# ${fixture} — generate a new telling`);
  console.log(
    `# writer: ${live === null ? 'STAND-IN (no GEMINI_API_KEY set, so no model was called — every scene is composed from its Scene Card)' : `LIVE Gemini calls to ${writerModel}`}`,
  );
  if (live !== null && writerModel !== WRITER_MODEL) {
    console.log(
      `# NOTE: ${writerModel} is not the writer model this project judges prose by — it is here for request headroom`,
    );
  }
  console.log(
    `# estimate: ${estimate.text}${estimate.from_default ? ' (project-wide default — this story has no measured runs yet)' : ' (from this story’s own measured runs)'}`,
  );
  console.log(`${'#'.repeat(78)}\n`);

  const { manifest, report } = await runTelling({
    pkg,
    client,
    repository,
    writerModel,
    onProgress: (event) => console.log(`  ${progressText(event)}`),
  });

  console.log(`\n${renderRunReport(report, { verbose })}\n`);
  console.log(`Compiled edition: edition/${manifest.run_id}/  (${manifest.scenes.length} scenes)`);

  if (promote) {
    // ADR 0014 §9: promotion is manual and author-initiated. Nothing in the loop does this.
    try {
      const pointer = await repository.promoteToBaked(manifest.run_id);
      console.log(`Promoted to Baked: ${pointer.run_id}`);
    } catch (error) {
      console.error(`${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
