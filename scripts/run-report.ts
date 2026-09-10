/**
 * Read persisted run reports back out of the blob store.
 *
 *   npm run run-report -- cinderella                # every run of a story, aggregated by card
 *   npm run run-report -- cinderella --run <runId>  # one run in full
 *   npm run run-report -- cinderella --verbose
 *
 * ADR 0014 §8's aggregation is the point of the story-wide view: grouped by Scene Card id across
 * runs, so "scene 13 degraded on 4 of 20 reads" is a question the author can actually ask. The
 * screen that will show this is ticket 4's; the data is here now.
 */

import { storyRepository } from '../src/persistence';
import { renderCardAggregates, renderRunReport } from '../src/edition/report-view';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const runFlag = args.indexOf('--run');
  const runId = runFlag === -1 ? null : (args[runFlag + 1] ?? null);
  const storyId = args.find((arg) => !arg.startsWith('--') && arg !== runId) ?? 'cinderella';

  const repository = storyRepository();

  if (runId !== null) {
    const report = await repository.getRunReport(runId);
    if (report === null) {
      console.error(`No run report at edition/${runId}/run-report.json`);
      process.exitCode = 1;
      return;
    }
    console.log(renderRunReport(report, { verbose }));
    return;
  }

  const reports = await repository.getRunReports(storyId);
  if (reports.length === 0) {
    console.error(`No runs recorded for "${storyId}" — run \`npm run telling -- ${storyId}\` first`);
    process.exitCode = 1;
    return;
  }

  for (const report of reports) console.log(`${renderRunReport(report, { verbose })}\n`);
  console.log(renderCardAggregates(reports));

  const baked = await repository.getBakedPointer(storyId);
  console.log(
    `\nBaked edition: ${baked === null ? 'none promoted yet (promotion is manual — ADR 0014 §9)' : `${baked.run_id} (promoted ${baked.promoted_at})`}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
