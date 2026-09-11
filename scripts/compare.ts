/**
 * Set two tellings beside each other (ADR 0015 §6).
 *
 *   npm run compare -- <runIdA> <runIdB>
 *   npm run compare -- cinderella            # the story's two most recent finished runs
 *   npm run compare -- cinderella --prose 13 # …and read scene 13 from both
 *
 * The same surface the `/stories/{storyId}/diff` screen renders, on the terminal, because every
 * other part of this compiler is reachable from a script and this one should be too.
 *
 * What it shows is what the variance contract leaves free. What it does *not* show is a
 * line-level text diff of the prose: two performances of one Scene Card share almost no words, so
 * that would be red from top to bottom and say nothing. Prose is printed side by side to read.
 */

import { storyRepository } from '../src/persistence';
import { EditionDiffError, diffEditions, type EditionDiff } from '../src/edition/edition-diff';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const proseFlag = args.indexOf('--prose');
  const proseScene = proseFlag === -1 ? null : Number.parseInt(args[proseFlag + 1] ?? '', 10);
  const positional = args.filter(
    (arg, index) => !arg.startsWith('--') && !(proseFlag !== -1 && index === proseFlag + 1),
  );

  const repository = storyRepository();
  const [first, second] = await resolveRuns(repository, positional);

  let diff: EditionDiff;
  try {
    diff = await diffEditions(repository, first, second);
  } catch (error) {
    if (error instanceof EditionDiffError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log(`COMPARING — ${diff.story_id}, package_version ${diff.package_version}`);
  console.log(`  A  ${diff.a.run_id}  (${diff.a.started_at}${diff.a.degraded ? ', degraded' : ''})`);
  console.log(`  B  ${diff.b.run_id}  (${diff.b.started_at}${diff.b.degraded ? ', degraded' : ''})`);
  console.log(`${'='.repeat(78)}\n`);
  console.log(
    `  ${diff.scenes_varied} of ${diff.scenes.length} scenes came out differently on at least one digest field.\n`,
  );

  for (const scene of diff.scenes) {
    const verdict = scene.identical
      ? 'same digest — only the words differ'
      : `${scene.fields.length} field(s) differ`;
    console.log(`  scene ${scene.scene_index}  ${scene.scene_id}  — ${verdict}`);
    for (const field of scene.fields) {
      if (field.a !== null || field.b !== null) {
        console.log(`      ${field.field}`);
        console.log(`        A: ${field.a}`);
        console.log(`        B: ${field.b}`);
        continue;
      }
      const parts: string[] = [];
      if (field.removed.length > 0) parts.push(`only in A: ${field.removed.join('; ')}`);
      if (field.added.length > 0) parts.push(`only in B: ${field.added.join('; ')}`);
      console.log(`      ${field.field} — ${parts.join('  |  ')}`);
    }
  }

  if (diff.proposals.length > 0) {
    console.log('\n  WHERE THE TWO RUNS CHOSE DIFFERENTLY (volitional columns only):');
    for (const proposal of diff.proposals) {
      console.log(
        `      scene ${proposal.scene_index}  ${proposal.entity_id}.${proposal.column}`,
      );
      console.log(`        A: ${describe(proposal.a)}`);
      console.log(`        B: ${describe(proposal.b)}`);
    }
  }

  if (proseScene !== null && Number.isFinite(proseScene)) {
    const scene = diff.scenes.find((entry) => entry.scene_index === proseScene);
    if (scene === undefined) {
      console.log(`\n  No scene ${proseScene} in either telling.`);
    } else {
      console.log(`\n${'-'.repeat(78)}\n  A — scene ${scene.scene_index}\n${'-'.repeat(78)}\n`);
      console.log(scene.prose.a ?? '(not in this run)');
      console.log(`\n${'-'.repeat(78)}\n  B — scene ${scene.scene_index}\n${'-'.repeat(78)}\n`);
      console.log(scene.prose.b ?? '(not in this run)');
    }
  }

  console.log('');
}

/**
 * Two run ids, given either explicitly or as a story whose last two finished runs to take.
 *
 * Only `complete` runs: a run still compiling has scenes that do not exist yet, and the missing
 * ones would read as variance rather than as absence.
 */
async function resolveRuns(
  repository: ReturnType<typeof storyRepository>,
  positional: string[],
): Promise<[string, string]> {
  if (positional.length >= 2) return [positional[0]!, positional[1]!];

  const storyId = positional[0];
  if (storyId === undefined) {
    throw new Error('Usage: npm run compare -- <runIdA> <runIdB>   |   <storyId>');
  }

  const index = await repository.getRunIndex(storyId);
  const finished = index.runs.filter((run) => run.status === 'complete');
  const [b, a] = [...finished].reverse();
  if (a === undefined || b === undefined) {
    throw new Error(
      `"${storyId}" has ${finished.length} finished telling(s); comparing needs two. Run \`npm run telling -- ${storyId}\` again.`,
    );
  }
  return [a.run_id, b.run_id];
}

function describe(side: { status: string; value: string | null } | null): string {
  if (side === null) return 'never proposed';
  return `${side.status.replace(/_/g, ' ')}${side.value === null ? '' : ` → ${side.value}`}`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
