/**
 * Generate original Fabula arcs and score them against `story-authoring-eval.md` §4.1.
 *
 *   npm run generate-arc -- --connectivity          # one cheap call, proves the API is reachable
 *   npm run generate-arc -- --config structured     # three arcs of one configuration
 *   npm run generate-arc -- --all                   # all three configurations
 *   npm run generate-arc -- --all --events 20 --out prototypes/arc-generation
 *   npm run generate-arc -- --rescore              # re-score saved packages, no API call
 *
 * Every arc is written twice: the deliverable (`<story_id>.package.json`, Fabula-only, valid
 * against `DraftStoryPackageSchema`) and the §4.1 score (`<story_id>.score.json`). The run's
 * summary lands in `run.json`, and it records the model that answered every call — per `AGENTS.md`,
 * a result that does not say which model produced it is not a measurement.
 *
 * `--connectivity` is the only mode that uses `gemini-3.5-flash-lite`, and it is used for exactly
 * what `AGENTS.md` keeps it for: proving a call reaches the API before spending a real one on
 * output you intend to judge. It never generates an arc.
 */

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local — GEMINI_API_KEY may still be in the environment.
}

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { briefsFor, CONFIG_IDS, type ConfigId } from '../src/arc/premises';
import { draftPackage } from '../src/arc/fabula';
import { readFabulaArc, storyIdOf } from '../src/schema/fabula';
import { generateArc, liveClient } from '../src/arc/generator';
import { scoreDiversity, scoreMechanical } from '../src/arc/rubric';
import { TESTING_WRITER_MODEL, writerModelFromEnv } from '../src/writer/model-client';

const DEFAULT_OUT = 'prototypes/arc-generation';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** The one thing the lite model is for: proving the call reaches the API. Never an arc. */
async function connectivity(): Promise<void> {
  const client = liveClient();
  const started = Date.now();
  const response = await client.generate({
    model: TESTING_WRITER_MODEL,
    systemInstruction: 'Answer with JSON only.',
    contents: 'Return {"ok": true} and nothing else.',
    responseJsonSchema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    },
    maxOutputTokens: 64,
    thinkingLevel: 'LOW',
  });
  console.log(
    `connectivity: ${response.model} answered in ${Date.now() - started}ms ` +
      `(${response.finish_reason}) — ${response.text.trim()}`,
  );
}

async function runConfig(
  config: ConfigId,
  eventCount: number,
  outDir: string,
  model: string,
): Promise<Record<string, unknown>> {
  const client = liveClient();
  const limit = Number.parseInt(option('limit') ?? '0', 10);
  const all = briefsFor(config, eventCount);
  const briefs = limit > 0 ? all.slice(0, limit) : all;
  const results: Array<Record<string, unknown>> = [];
  const arcs = [];

  for (const brief of briefs) {
    process.stdout.write(`${config}/${brief.story_id}: generating… `);
    const started = Date.now();
    let generated;
    try {
      generated = await generateArc(brief, { client, model });
    } catch (error) {
      console.log(`FAILED — ${error instanceof Error ? error.message : String(error)}`);
      results.push({
        story_id: brief.story_id,
        failed: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const score = scoreMechanical(generated.arc, brief.story_id);
    arcs.push(generated.arc);

    const pkg = draftPackage(generated.arc, brief.story_id, {
      generator: 'src/arc (issue #119)',
      model: generated.model,
      generated_at: new Date().toISOString(),
      brief,
      repairs: generated.repairs,
    });

    await writeFile(
      join(outDir, `${brief.story_id}.package.json`),
      `${JSON.stringify(pkg, null, 2)}\n`,
    );
    await writeFile(
      join(outDir, `${brief.story_id}.score.json`),
      `${JSON.stringify(
        {
          config,
          model: generated.model,
          calls: generated.calls,
          initial_problems: generated.initial_problems,
          repairs: generated.repairs,
          remaining_problems: generated.remaining_problems,
          score,
        },
        null,
        2,
      )}\n`,
    );

    const histogram = score.plant_spans.histogram;
    console.log(
      `${generated.model} ${Math.round((Date.now() - started) / 1000)}s | ` +
        `${generated.event_count.returned}/${generated.event_count.requested} events | ` +
        `gates ${score.all_gates_passed ? 'PASS' : 'FAIL'} | ` +
        `first-pass defects ${generated.initial_problems.length} → ${generated.remaining_problems.length} | ` +
        `${histogram.edges} edges, spans ${JSON.stringify(histogram.counts)}`,
    );

    results.push({
      story_id: brief.story_id,
      model: generated.model,
      event_count: generated.event_count,
      gates_passed: score.all_gates_passed,
      initial_problems: generated.initial_problems.map((p) => p.code),
      remaining_problems: generated.remaining_problems.map((p) => p.code),
      repairs: generated.repairs,
      histogram,
      lexical_canary: score.lexical_canary,
      calls: generated.calls,
    });
  }

  const diversity = arcs.length > 1 ? scoreDiversity(arcs) : null;
  if (diversity !== null) {
    console.log(
      `${config}: diversity — summary overlap ${diversity.mean_pairwise_overlap.toFixed(3)}, ` +
        `name overlap ${diversity.mean_name_overlap.toFixed(3)}` +
        (diversity.shared_names.length === 0
          ? ''
          : `, shared names: ${diversity.shared_names.join(', ')}`),
    );
  }

  return { config, arcs: results, diversity };
}

/**
 * Re-score packages already on disk, without calling the API.
 *
 * §4.1's bars are explicitly "initial, unmeasured, and expected to move" (rubric §5), so the
 * scoring pass will change under packages that cost real calls to produce. Re-deriving the score
 * from the saved deliverable keeps a rubric change from costing a regeneration.
 */
async function rescore(outDir: string): Promise<void> {
  const files = (await readdir(outDir)).filter((name) => name.endsWith('.package.json')).sort();
  const summaries = [];
  for (const file of files) {
    const envelope = JSON.parse(await readFile(join(outDir, file), 'utf8')) as Record<string, unknown>;
    const storyId = storyIdOf(envelope, 'unknown');
    const { arc } = readFabulaArc(envelope);
    const score = scoreMechanical(arc, storyId);
    const scorePath = join(outDir, `${storyId}.score.json`);
    let previous: Record<string, unknown> = {};
    try {
      previous = JSON.parse(await readFile(scorePath, 'utf8')) as Record<string, unknown>;
    } catch {
      // No earlier score file; the fresh one stands alone.
    }
    await writeFile(scorePath, `${JSON.stringify({ ...previous, score }, null, 2)}\n`);
    console.log(
      `${storyId.padEnd(28)} gates ${score.all_gates_passed ? 'PASS' : 'FAIL'} | ` +
        `${score.events} events | spans ${JSON.stringify(score.plant_spans.histogram.counts)} ` +
        `(+${score.plant_spans.histogram.seed_grounded} seed)`,
    );
    summaries.push({ storyId, score });
  }
  console.log(`\nre-scored ${summaries.length} package(s) in ${outDir}`);
}

async function main(): Promise<void> {
  if (flag('connectivity')) {
    await connectivity();
    return;
  }

  if (flag('rescore')) {
    await rescore(option('out') ?? DEFAULT_OUT);
    return;
  }

  const model = writerModelFromEnv();
  if (model === TESTING_WRITER_MODEL) {
    throw new Error(
      `AXIOM_WRITER_MODEL is ${TESTING_WRITER_MODEL}. Per AGENTS.md the lite model proves ` +
        'connectivity and is never used for output anyone intends to judge. Unset it.',
    );
  }

  const configs: ConfigId[] = flag('all')
    ? [...CONFIG_IDS]
    : [(option('config') ?? 'structured') as ConfigId];
  for (const config of configs) {
    if (!CONFIG_IDS.includes(config)) {
      throw new Error(`unknown config "${config}" — one of ${CONFIG_IDS.join(', ')}`);
    }
  }

  const eventCount = Number.parseInt(option('events') ?? '20', 10);
  const outDir = option('out') ?? DEFAULT_OUT;
  await mkdir(outDir, { recursive: true });

  console.log(`arc generation — model ${model}, ${eventCount} events, out ${outDir}\n`);

  const runs = [];
  for (const config of configs) {
    runs.push(await runConfig(config, eventCount, outDir, model));
  }

  await writeFile(
    join(outDir, 'run.json'),
    `${JSON.stringify(
      { generated_at: new Date().toISOString(), model, event_count: eventCount, runs },
      null,
      2,
    )}\n`,
  );
  console.log(`\nwrote ${join(outDir, 'run.json')}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
