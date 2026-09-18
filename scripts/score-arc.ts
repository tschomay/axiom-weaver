/**
 * Judge arcs against `story-authoring-eval.md` §4.2, after §4.3's calibration.
 *
 *   npm run score-arc -- --calibrate                  # the two fixtures, judged first
 *   npm run score-arc -- --calibrate --generated      # calibration, then the generated arcs
 *
 * §4.3 is not optional and this script enforces it in the only way a script can: `--generated`
 * without `--calibrate` is refused. "Run §4.3 before believing any generated-arc number" is the
 * rubric's instruction, and a judge that cannot clear its own bars on Cinderella and the *Carol*
 * makes every number below it meaningless.
 *
 * Everything is judged through `blindArcView`, which relabels ids and drops titles so a fixture
 * and a generated arc reach the judge in the same shape.
 */

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local — GEMINI_API_KEY may still be in the environment.
}

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { provisionalPackage } from '../src/authoring/lint-fabula';
import { readFabulaArc, storyIdOf } from '../src/schema/fabula';
import { judgePackage, type JudgeScore } from '../src/arc/judge';
import { liveClient } from '../src/arc/generator';
import { plantSpans, spanHistogram } from '../src/arc/rubric';
import { parseStoryPackage, type StoryPackage } from '../src/schema/story-package';
import { TESTING_WRITER_MODEL, writerModelFromEnv } from '../src/writer/model-client';

const DEFAULT_DIR = 'prototypes/arc-generation';
// All three human-authored fixtures. `the-machine-stops` joined the calibration set with #147:
// §4.3's whole claim is that a judge which cannot rate material that demonstrably works is
// miscalibrated, and a third fixture makes that test harder to pass by accident.
const FIXTURES = ['cinderella', 'a-christmas-carol', 'the-machine-stops'] as const;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function line(score: JudgeScore): string {
  const pct = (value: number | null) => (value === null ? ' n/a ' : `${(value * 100).toFixed(0)}%`);
  return (
    `${score.label.padEnd(28)} ` +
    `causes ${pct(score.causal.continuous.share)} of ${score.causal.continuous.pairs} cont ` +
    `(all ${pct(score.causal.causes_share)}, ${score.causal.story_time_jumps} jumps, ` +
    `contradicts ${score.causal.contradicts}) | ` +
    `earned ${pct(score.payoff_earned.earned_share)} of ${score.payoff_earned.pairs} ` +
    `(seed ${pct(score.payoff_earned.seed_grounded.share)} of ${score.payoff_earned.seed_grounded.pairs}, ` +
    `planted ${pct(score.payoff_earned.planted.share)} of ${score.payoff_earned.planted.pairs}) | ` +
    `stock ${score.non_genericity.adherence}/5 +${score.non_genericity.load_bearing_particulars}lb ` +
    `${score.non_genericity.passed ? 'PASS' : 'FAIL'} | ` +
    `theme ${score.thematic_coherence.score}/5 | engage ${score.engagement.score}/5`
  );
}

/** Load a generated deliverable back into a package the judge and the span scorer can read. */
async function loadGenerated(path: string): Promise<{ label: string; pkg: StoryPackage }> {
  const envelope: unknown = JSON.parse(await readFile(path, 'utf8'));
  const { arc } = readFabulaArc(envelope);
  const storyId = storyIdOf(envelope, 'unknown');
  return { label: storyId, pkg: provisionalPackage(arc, storyId) };
}

async function main(): Promise<void> {
  const model = writerModelFromEnv();
  if (model === TESTING_WRITER_MODEL) {
    throw new Error(
      `AXIOM_WRITER_MODEL is ${TESTING_WRITER_MODEL}. The rubric's judge protocol (§4.2) forbids ` +
        'the lite model as a judge. Unset it.',
    );
  }

  const calibrate = flag('calibrate');
  const generated = flag('generated');
  if (generated && !calibrate) {
    throw new Error(
      '§4.3 first: run with --calibrate. A generated-arc score from an uncalibrated judge is not ' +
        'a measurement.',
    );
  }

  const client = liveClient();
  const dir = option('dir') ?? DEFAULT_DIR;
  const scores: JudgeScore[] = [];

  if (calibrate) {
    console.log(`§4.3 judge calibration — judge ${model}, human-authored fixtures\n`);
    for (const fixture of FIXTURES) {
      const pkg = parseStoryPackage(
        JSON.parse(await readFile(join('fixtures', fixture, 'package.json'), 'utf8')),
      );
      const score = await judgePackage(pkg, `fixture:${fixture}`, { client, model });
      scores.push(score);
      console.log(line(score));
      // A fixture is hand-authored Scene Cards — the real scene layer, not a projection.
      const histogram = spanHistogram(pkg, 'segmented_scenes');
      console.log(
        `  ${' '.repeat(26)} plant spans: ${JSON.stringify(histogram.counts)} ` +
          `(+${histogram.seed_grounded} seed-grounded), mean ${histogram.mean?.toFixed(1) ?? 'n/a'}`,
      );
    }

    const cleared = scores.every(
      (score) =>
        score.causal.passed &&
        score.payoff_earned.passed &&
        score.non_genericity.passed &&
        score.thematic_coherence.passed &&
        score.engagement.passed,
    );
    console.log(
      `\ncalibration: the judge ${cleared ? 'CLEARS' : 'DOES NOT CLEAR'} §4.2's bars on the ` +
        'human-authored fixtures.',
    );
    if (!cleared) {
      console.log(
        'Per §4.3 this does not stop the run — it changes what the generated numbers mean. ' +
          'Read every bar below against the fixture score for the same criterion, never against ' +
          'the bar in isolation.',
      );
    }
  }

  if (generated) {
    console.log(`\n§4.2 generated arcs — judge ${model}\n`);
    const files = (await readdir(dir)).filter((name) => name.endsWith('.package.json')).sort();
    for (const file of files) {
      const { label, pkg } = await loadGenerated(join(dir, file));
      const score = await judgePackage(pkg, label, { client, model });
      scores.push(score);
      console.log(line(score));
      // provisionalPackage: these spans are event distances, not scene distances (#149).
      const spans = plantSpans(pkg);
      console.log(
        `  ${' '.repeat(26)} spans (fabula_projection): ${JSON.stringify(
          spans.map((row) => row.span),
        )}  per-payoff: ${score.raw.payoffs
          .map((row) => `${row.fact_ref}=${row.verdict === 'earned' ? 'E' : 'L'}`)
          .join(' ')}`,
      );
    }
  }

  const out = join(dir, 'judged.json');
  await writeFile(
    out,
    `${JSON.stringify({ judged_at: new Date().toISOString(), judge_model: model, scores }, null, 2)}\n`,
  );
  console.log(`\nwrote ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
