/**
 * Run the extraction pipeline over a source text and, optionally, score it against its fixture.
 *
 *   npm run extract -- cinderella
 *   npm run extract -- a-christmas-carol --score
 *   npm run extract -- cinderella --model gemini-3.5-flash-lite   # connectivity only, never a result
 *   npm run extract -- cinderella --score --out .data/extraction
 *   npm run extract -- a-christmas-carol --rescore                # score a saved run again
 *
 * `--rescore` re-runs only the scoring half against an extraction already on disk. It exists
 * because the scoring harness has its own failure modes — the event-alignment judge degraded
 * badly on the *Carol*'s 394-event candidate list before it was given a shortlist — and
 * re-measuring should not cost another extraction run, nor silently compare numbers produced by
 * two different harnesses.
 *
 * Issue #117. This is a standalone pipeline, not part of the app: nothing under `src/authoring`,
 * `src/schema`, the compiler or any UI route is touched, per #113's boundaries. The package it
 * writes is the object the existing import escape hatch (`src/authoring/transfer.ts`, ADR 0017
 * §6) would take, and wiring that up is somebody else's ticket.
 *
 * `--model` exists for the reason `AGENTS.md` gives and no other: `gemini-3.5-flash-lite` proves
 * a call reaches the API, and is never to be used for anything you intend to judge or trust. The
 * default is `WRITER_MODEL`, the judge is always `WRITER_MODEL`, and every output file records
 * which model actually answered each call.
 */

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local; the key may still be in the environment.
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ExtractionModel } from '../src/extraction/call';
import { extractStoryPackage, type ExtractionResult } from '../src/extraction/pipeline';
import { scoreExtraction } from '../src/extraction/scoring/score';
import { SOURCE_MANIFESTS, loadSource } from '../src/extraction/sources';
import { GeminiClient, WRITER_MODEL, isSelectableWriterModel } from '../src/writer/model-client';

/**
 * Read back a saved run so `--rescore` measures the same extraction again.
 *
 * Trusted rather than re-validated: these are files this script wrote minutes or hours ago, and
 * a schema parse here would only restate the parse the pipeline already did before writing them.
 */
async function readSavedRun(outStory: string): Promise<ExtractionResult> {
  const [pkg, sidecar] = await Promise.all([
    readFile(path.join(outStory, 'package.json'), 'utf8'),
    readFile(path.join(outStory, 'extraction.json'), 'utf8'),
  ]);
  return {
    package: JSON.parse(pkg) as ExtractionResult['package'],
    sidecar: JSON.parse(sidecar) as ExtractionResult['sidecar'],
  };
}

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  return process.argv[at + 1] ?? '';
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // A flag's value is positional-looking (`--model gemini-3.8-flash`), so it has to be excluded
  // before what is left can be read as story ids.
  const flagValues = new Set(
    argv.flatMap((argument, index) => (argument.startsWith('--') ? [argv[index + 1] ?? ''] : [])),
  );
  const named = argv.filter(
    (argument) => !argument.startsWith('--') && !flagValues.has(argument),
  );
  const wanted = named.length > 0 ? named : SOURCE_MANIFESTS.map((manifest) => manifest.id);

  const model = flag('model') ?? WRITER_MODEL;
  if (!isSelectableWriterModel(model)) {
    throw new Error(`--model ${model} is not one of the project's selectable models.`);
  }
  const outDir = flag('out') ?? path.join('.data', 'extraction');
  const rescoreOnly = process.argv.includes('--rescore');
  const shouldScore = rescoreOnly || process.argv.includes('--score');

  const client = GeminiClient.fromEnv();
  if (client === null) {
    throw new Error(
      'GEMINI_API_KEY is not set. This pipeline has no recorded stand-in: extraction reads a ' +
        'source text that is itself fetched at run time, so a replay would be a fiction.',
    );
  }

  if (model !== WRITER_MODEL) {
    console.log(
      `\n  !! Running on ${model}, not ${WRITER_MODEL}. Per AGENTS.md that model is for proving a\n` +
        '     call reaches the API. Do not report anything it produces as a measurement.\n',
    );
  }

  for (const storyId of wanted) {
    console.log(`\n=== ${storyId} ===`);
    const source = await loadSource(storyId);
    console.log(
      `source: ${source.manifest.edition}\n        lines ${source.manifest.first_line}–${source.manifest.last_line}, ${source.words} words (expected ${source.manifest.expected_words}), sha256 ${source.sha256.slice(0, 16)}…`,
    );

    const outStory = path.join(outDir, storyId);
    const started = Date.now();
    const result = rescoreOnly
      ? await readSavedRun(outStory)
      : await extractStoryPackage(source, client, model, {
          onProgress: (message) => console.log(`  ${message}`),
        });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    if (!rescoreOnly) {
      await mkdir(outStory, { recursive: true });
      await writeFile(
        path.join(outStory, 'package.json'),
        `${JSON.stringify(result.package, null, 2)}\n`,
        'utf8',
      );
      await writeFile(
        path.join(outStory, 'extraction.json'),
        `${JSON.stringify(result.sidecar, null, 2)}\n`,
        'utf8',
      );
    }

    const seed = result.package.world_model_seed;
    const provenance = result.sidecar.provenance;
    console.log(
      [
        '',
        `  seed: ${seed.characters.length} characters, ${seed.locations.length} locations, ` +
          `${seed.objects.length} objects, ${seed.relationships.length} relationships`,
        `  events: ${result.sidecar.events.length} in Fabula order`,
        `  span grounding: ${(result.sidecar.grounding.grounded_rate * 100).toFixed(1)}% of ` +
          `${result.sidecar.grounding.total} claims resolved to a real span ` +
          `(${result.sidecar.grounding.unresolved} unresolved)`,
        `  calls: ${provenance.call_count} on ${provenance.models_used.join(', ')}, ` +
          `$${provenance.cost_usd.toFixed(4)}` +
          (rescoreOnly ? ' (replayed from disk, not re-run)' : `, ${seconds}s`),
        rescoreOnly
          ? `  read: ${outStory}/package.json, ${outStory}/extraction.json`
          : `  written: ${outStory}/package.json, ${outStory}/extraction.json`,
      ].join('\n'),
    );

    for (const merge of result.sidecar.diagnostics.suspicious_merges) {
      console.log(`  !! suspicious merge into ${merge.id}: ${merge.names.join(' + ')}`);
    }

    if (!shouldScore) continue;

    console.log(`\n  scoring against fixtures/${storyId}/package.json (judge: ${WRITER_MODEL})`);
    const judge = new ExtractionModel(client, WRITER_MODEL);
    const report = await scoreExtraction(result, source, judge, {
      onProgress: (message) => console.log(`    ${message}`),
    });
    await writeFile(
      path.join(outStory, 'score.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    printScore(report);
    console.log(`  written: ${outStory}/score.json`);
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printScore(report: Awaited<ReturnType<typeof scoreExtraction>>): void {
  const lines: string[] = [];
  lines.push('');
  const g0 = report.g0;
  lines.push(
    `  G0 on the deliverable (§1, as written): publishable=${g0.deliverable.publishable}` +
      ` — ${g0.deliverable.unexpected_errors.length} unexpected error(s)`,
  );
  for (const error of g0.deliverable.errors) {
    lines.push(`      error  ${error.code} @ ${error.path}`);
  }
  lines.push(
    `  G0 on the provisional projection (#119's provisionalPackage, ${g0.projected.scene_count} scenes): ` +
      `${g0.projected.passed ? 'PASS' : 'FAIL'}`,
  );
  for (const error of g0.projected.errors.slice(0, 10)) {
    lines.push(`      error  ${error.code} @ ${error.path}`);
  }
  if (g0.projected.errors.length > 10) {
    lines.push(`      …and ${g0.projected.errors.length - 10} more`);
  }
  lines.push(
    `      warnings: ${g0.projected.warnings.length}; substitutions: ` +
      `pov<-participant ${g0.projected.substitutions.pov_from_first_participant}, ` +
      `pov unavailable ${g0.projected.substitutions.pov_unavailable}, ` +
      `location carried forward ${g0.projected.substitutions.location_carried_forward}`,
  );
  for (const problem of g0.seed_parse_errors) lines.push(`      seed parse: ${problem}`);

  const span = report.span_grounding;
  lines.push('');
  lines.push(
    `  Span grounding: ${pct(span.quote_resolution_rate)} of ${span.claims} claims resolved ` +
      `(${span.resolved_exact} exact, ${span.resolved_normalized} normalized, ${span.unresolved} unresolved)`,
  );
  lines.push(
    `      judged support: ${span.supports}/${span.judged} supports, ${span.insufficient} insufficient, ` +
      `${span.contradicts} contradicts (${pct(span.support_rate)})`,
  );

  lines.push('');
  lines.push('  §3.2 World Model seed');
  for (const table of report.world_model.tables) {
    lines.push(
      `      ${table.table.padEnd(11)} recall ${pct(table.recall).padStart(6)} ` +
        `(${table.aligned}/${table.fixture_rows})   precision ${pct(table.precision).padStart(6)} ` +
        `(${table.aligned}/${table.candidate_rows})`,
    );
  }
  lines.push(
    `      relationships recall ${pct(report.world_model.relationship_recall)} ` +
      `(${report.world_model.relationship_matched}/${report.world_model.relationship_fixture_rows}), ` +
      `${report.world_model.relationship_candidate_rows} candidate edges`,
  );
  const attributes = report.world_model.seed_attributes;
  lines.push(
    `      attribute contradiction rate ${pct(attributes.contradiction_rate)} ` +
      `(${attributes.contradicted}/${attributes.judged})   seed-time errors ${attributes.seed_time_errors}`,
  );

  const events = report.events;
  lines.push('');
  lines.push('  §3.3 Event list and chronology');
  lines.push(
    `      event recall ${pct(events.recall)} (${events.matched}/${events.ground_truth_events}), ` +
      `${events.candidate_events} candidate events`,
  );
  lines.push(
    `      pairwise chronology ${pct(events.pairwise_accuracy)} over ${events.pairwise_total} pairs; ` +
      `high-confidence ${pct(events.high_confidence_accuracy)} over ${events.high_confidence_total}`,
  );
  lines.push(
    `      narrated-out-of-order pairs: ${
      events.out_of_order_accuracy === null
        ? 'N/A (source is linear)'
        : `${pct(events.out_of_order_accuracy)} over ${events.out_of_order_total}`
    }`,
  );
  lines.push(
    `      fabricated events (§3.4, bar 0): ${events.fabricated} of ${events.fabricated_judged} judged`,
  );
  lines.push(
    `      ungroundable quotes (§3.2, not invention): ${events.ungroundable_events} events`,
  );

  lines.push('');
  lines.push(`  extractor: ${report.extractor_models.join(', ')}   judge: ${report.judge_model}`);
  lines.push(`  judge spend: ${report.judge_calls} calls, $${report.judge_cost_usd.toFixed(4)}`);
  console.log(lines.join('\n'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
