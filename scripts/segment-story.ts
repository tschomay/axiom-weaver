/**
 * Segment a Fabula-only package into Scene Cards, and optionally score the result.
 *
 *   npm run segment -- cinderella
 *   npm run segment -- a-christmas-carol --score
 *   npm run segment -- cinderella --model gemini-3.5-flash-lite   # connectivity only, never a result
 *   npm run segment -- cinderella --in prototypes/arc-generation/x.package.json
 *   npm run segment -- cinderella --rescore                       # score a saved run again
 *   npm run segment -- cinderella --mechanical                    # no model: the signal baseline
 *
 * Issue #118. A standalone pipeline, not part of the app: the package it writes is the object the
 * existing import escape hatch (`src/authoring/transfer.ts`, ADR 0017 §6) would take, and wiring
 * that up is somebody else's ticket.
 *
 * `--in` is the point of the ticket. Segmentation reads a `_fabula` block and nothing else, so the
 * same command runs over #117's extraction output (the default, read from
 * `fixtures/extraction/runs/<story>/package.json`) and over #119's generated arcs — which is
 * exactly what #120 has to demonstrate.
 *
 * `--model` exists for the reason `AGENTS.md` gives and no other: `gemini-3.5-flash-lite` proves a
 * call reaches the API, and is never to be used for anything you intend to judge or trust. The
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
import { loadGroundTruth } from '../src/extraction/scoring/ground-truth';
import { loadSource } from '../src/extraction/sources';
import { parseStoryPackage } from '../src/schema/story-package';
import {
  SEGMENTATION_BLOCK,
  segmentFabulaPackage,
  segmentMechanically,
  type SegmentationReport,
} from '../src/segmentation/segment';
import {
  scoreSegmentation,
  type SavedAlignment,
  type SegmentationBlockScene,
} from '../src/segmentation/scoring/score';
import { FABULA_BLOCK } from '../src/schema/fabula';
import { WRITER_MODEL, isSelectableWriterModel } from '../src/writer/model-client';
import { liveClient } from '../src/arc/generator';

const DEFAULT_OUT = 'prototypes/segmentation';
const STORIES = ['cinderella', 'a-christmas-carol'] as const;

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  return process.argv[at + 1] ?? '';
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

interface SpanCarrier {
  id?: unknown;
  source_span?: { start?: unknown; end?: unknown } | null;
}

/** The spans the scorer needs, read off the `_fabula` block. Absent on a generated arc. */
function spansOf(envelope: unknown): Array<{ id: string; start: number; end: number }> {
  const block = (envelope as Record<string, unknown> | null)?.[FABULA_BLOCK] as
    | { events?: unknown }
    | undefined;
  if (!Array.isArray(block?.events)) return [];
  const spans: Array<{ id: string; start: number; end: number }> = [];
  for (const raw of block.events as SpanCarrier[]) {
    const span = raw.source_span;
    if (span === null || span === undefined) continue;
    if (typeof raw.id !== 'string' || typeof span.start !== 'number' || typeof span.end !== 'number') {
      continue;
    }
    spans.push({ id: raw.id, start: span.start, end: span.end });
  }
  return spans;
}

function sceneBlockOf(pkg: unknown): SegmentationBlockScene[] {
  const block = (pkg as Record<string, unknown> | null)?.[SEGMENTATION_BLOCK] as
    | { scenes?: unknown }
    | undefined;
  if (!Array.isArray(block?.scenes)) return [];
  return block.scenes as SegmentationBlockScene[];
}

function summarize(report: SegmentationReport): string[] {
  const lines = [
    `  ${report.events} events → ${report.scenes} scenes (${report.events_per_scene.toFixed(1)} events per scene)`,
    `  boundaries: ${report.boundaries.decisions.filter((d) => d.decision === 'new_scene').length} judged new_scene, ` +
      `${report.boundaries.fell_back_to_signals} fell back to signals, ` +
      `self-consistency ${report.boundaries.self_consistency === null ? 'n/a' : report.boundaries.self_consistency.toFixed(2)}`,
    `  forced splits: ${report.grouping.forced_by_plant_span} by a plant span, ${report.grouping.forced_by_size} by the size guardrail`,
    `  substitutions: pov ${report.substitutions.pov_from_candidates}+${report.substitutions.pov_from_seed}, ` +
      `location ${report.substitutions.location_from_candidates}+${report.substitutions.location_from_seed}, ` +
      `beats ${report.substitutions.beats_from_events}`,
    `  plants: ${report.plants.proposed} proposed, ${report.plants.verified} verified, ` +
      `${report.plants.rejected_by_verifier} rejected, ${report.plants.carried_from_fabula} carried from the Fabula layer`,
    `  told-ledger: ${report.told_ledger.facts} facts, ${report.told_ledger.withheld_scene_entries} must_stay_hidden entries`,
    `  G0 (the real lintPackage): ${report.lint.publishable ? 'PASS' : 'FAIL'} — ` +
      `${report.lint.errors.length} errors, ${report.lint.warnings.length} warnings`,
    `  cost $${report.cost_usd.toFixed(4)} over ${report.calls.length} calls on ${report.models_used.join(', ')}`,
  ];
  for (const problem of report.boundaries.window_problems) lines.push(`  !! windowing: ${problem}`);
  for (const error of report.lint.errors.slice(0, 5)) {
    lines.push(`  !! ${error.code} ${error.path}: ${error.message}`);
  }
  return lines;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flagValues = new Set(
    argv.flatMap((argument, index) => (argument.startsWith('--') ? [argv[index + 1] ?? ''] : [])),
  );
  const named = argv.filter((argument) => !argument.startsWith('--') && !flagValues.has(argument));
  const wanted = named.length > 0 ? named : [...STORIES];

  const model = flag('model') ?? WRITER_MODEL;
  if (!isSelectableWriterModel(model)) {
    throw new Error(`--model ${model} is not one of the project's selectable models.`);
  }
  const outDir = flag('out') ?? DEFAULT_OUT;
  const wantScore = has('score') || has('rescore');

  for (const storyId of wanted) {
    const inPath = flag('in') ?? path.join('fixtures', 'extraction', 'runs', storyId, 'package.json');
    const outStory = path.join(outDir, storyId);
    await mkdir(outStory, { recursive: true });
    const packagePath = path.join(outStory, 'package.json');

    console.log(`\n=== ${storyId} ===`);

    let segmented: unknown;
    let report: SegmentationReport | null = null;
    let segmenterModels: string[] = [];

    if (has('rescore')) {
      segmented = JSON.parse(await readFile(packagePath, 'utf8')) as unknown;
      const saved = JSON.parse(
        await readFile(path.join(outStory, 'segmentation.json'), 'utf8'),
      ) as SegmentationReport;
      segmenterModels = [...saved.models_used];
      console.log(`  re-scoring the saved run (${segmenterModels.join(', ')})`);
    } else if (has('mechanical')) {
      const envelope = JSON.parse(await readFile(inPath, 'utf8')) as unknown;
      const result = segmentMechanically(envelope);
      console.log(
        `  mechanical baseline: ${result.package.scene_cards.length} scenes, ` +
          `lint ${result.lint.publishable ? 'PASS' : 'FAIL'}`,
      );
      continue;
    } else {
      const envelope = JSON.parse(await readFile(inPath, 'utf8')) as unknown;
      const extraction = new ExtractionModel(liveClient(), model);
      const result = await segmentFabulaPackage(envelope, extraction, {
        onProgress: (message) => console.log(`    ${message}`),
      });
      segmented = result.package;
      report = result.report;
      segmenterModels = [...result.report.models_used];
      await writeFile(packagePath, `${JSON.stringify(result.package, null, 2)}\n`);
      await writeFile(
        path.join(outStory, 'segmentation.json'),
        `${JSON.stringify(result.report, null, 2)}\n`,
      );
      for (const line of summarize(result.report)) console.log(line);
    }

    if (!wantScore) continue;

    const sourceEnvelope = JSON.parse(await readFile(inPath, 'utf8')) as unknown;
    const spans = spansOf(sourceEnvelope);
    const truth = await loadGroundTruth(storyId);
    const savedScore = JSON.parse(
      await readFile(path.join('fixtures', 'extraction', 'runs', storyId, 'score.json'), 'utf8'),
    ) as { alignment: SavedAlignment };

    let source: { text: string } | null = null;
    try {
      source = await loadSource(storyId);
    } catch (error) {
      console.log(`  (no source text available: ${error instanceof Error ? error.message : error})`);
    }

    const judge = new ExtractionModel(liveClient(), WRITER_MODEL);
    const score = await scoreSegmentation(judge, {
      storyId,
      candidate: parseStoryPackage(segmented),
      sceneBlock: sceneBlockOf(segmented),
      spans,
      truth,
      alignment: savedScore.alignment,
      segmenterModels,
      source,
      onProgress: (message) => console.log(`    ${message}`),
    });

    await writeFile(path.join(outStory, 'score.json'), `${JSON.stringify(score, null, 2)}\n`);
    console.log(`  scene count ${score.scene_count.candidate} vs fixture ${score.scene_count.fixture} (ratio ${score.scene_count.ratio.toFixed(2)})`);
    console.log(
      `  §3.5 boundaries: precision ${fmt(score.boundaries.precision)} recall ${fmt(score.boundaries.recall)}; ` +
        `beats coverage ${fmt(score.beats.mean_coverage)}, invention ${fmt(score.beats.invention_rate)}; ` +
        `pov ${fmt(score.pov_location.pov_accuracy)} location ${fmt(score.pov_location.location_accuracy)}; ` +
        `source coverage ${fmt(score.source_coverage.coverage)}`,
    );
    console.log(
      `  §3.6 reveal order: pairwise ${fmt(score.reveal_order.pairwise_accuracy)} over ` +
        `${score.reveal_order.aligned_facts} aligned facts; premature ${score.reveal_order.premature.length}; ` +
        `must_stay_hidden recall ${fmt(score.reveal_order.hidden_recall)}`,
    );
    console.log(
      `  §3.7 plants: recall ${fmt(score.plants.recall)} (${score.plants.matched}/${score.plants.fixture_pairs}), ` +
        `long-range ${fmt(score.plants.long_range_recall)}, misattributed ${score.plants.misattributed}, ` +
        `orphans ${score.plants.orphans.length}, walk errors ${score.plants.plant_walk_errors.length}`,
    );
    console.log(`  judge cost $${score.judge_cost_usd.toFixed(4)} on ${score.judge_model}`);
    if (report !== null && report.lint.publishable === false) {
      console.log('  !! G0 failed — every number above is below the level this rubric grades.');
    }
  }
}

function fmt(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
