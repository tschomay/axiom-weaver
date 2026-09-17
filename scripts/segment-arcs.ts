/**
 * Issue #120 — run #118's segmentation over #119's *generated* arcs, unmodified.
 *
 *   npm run segment-arcs                      # the default sample: two arcs per configuration
 *   npm run segment-arcs -- arc_structured_kiln
 *   npm run segment-arcs -- --mechanical      # no model at all: reads every committed arc
 *   npm run segment-arcs -- --rescore         # re-score saved runs, no API calls
 *   npm run segment-arcs -- --model gemini-3.5-flash-lite   # connectivity only, never a result
 *
 * The point of the ticket is that there is no second pipeline here. This script calls the same
 * `segmentFabulaPackage()` `scripts/segment-story.ts` calls, with the same options, on a different
 * `_fabula` block. It exists as its own script only because the *scoring* differs and cannot not
 * differ: §3.5–§3.7 are extraction-fidelity metrics defined against a ground-truth fixture and a
 * source text, and a generated arc has neither. See `docs/research/generated-arc-segmentation.md`.
 *
 * So what is scored here is:
 *
 * - **§4.1 in full, over the segmented Story Package** rather than over the Fabula projection
 *   `lintFabulaArc` builds. That is the interesting number: #119 already reported §4.1 on its own
 *   output, so the same gates re-run after segmentation say directly whether segmentation
 *   preserved, broke or repaired what the generator produced.
 * - **The ground-truth-free part of §3.5** — scene count, events per scene, and the boundary
 *   pass's own self-consistency, which §3.5 explicitly names as the number that "needs no ground
 *   truth".
 * - **The ground-truth-free part of §3.6/§3.7** — the plant-span histogram before and after, and
 *   how many of the generator's authored `pays_off` edges survived onto Scene Cards.
 *
 * Everything else in §3.5–§3.7 is reported as `null` with the reason attached, per §5's rule that
 * a metric that cannot be computed is said so rather than approximated.
 *
 * `--model` is here for the reason `AGENTS.md` gives and no other.
 */

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local; the key may still be in the environment.
}

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { liveClient } from '../src/arc/generator';
import { plantSpans, scoreMechanicalPackage, spanHistogram } from '../src/arc/rubric';
import { ExtractionModel } from '../src/extraction/call';
import { readFabulaArc } from '../src/schema/fabula';
import { parseStoryPackage, type StoryPackage } from '../src/schema/story-package';
import {
  segmentFabulaPackage,
  segmentMechanically,
  type SegmentationReport,
} from '../src/segmentation/segment';
import { WRITER_MODEL, isSelectableWriterModel } from '../src/writer/model-client';

const ARCS_DIR = 'prototypes/arc-generation';
const DEFAULT_OUT = 'prototypes/segmentation/generated';

/**
 * Two arcs from each of #119's three configurations.
 *
 * `arc_free_text_2` is deliberately left out of the judged sample and segmented mechanically only:
 * it already fails G0 at #119's own layer (`unknown_entity` on `char_stoddard.location_id`), so a
 * model run over it would spend real money to re-measure an upstream defect. It is still read by
 * `--mechanical`, which is where that propagation is checked.
 */
const DEFAULT_SAMPLE = [
  'arc_structured_kiln',
  'arc_structured_ferry',
  'arc_free_text_1',
  'arc_free_text_3',
  'arc_no_span_guidance_kiln',
  'arc_no_span_guidance_orchard',
] as const;

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  return process.argv[at + 1] ?? '';
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** §3.5–§3.7 entries this run structurally cannot compute, each with the reason it cannot. */
export const UNSCOREABLE_WITHOUT_GROUND_TRUTH: Record<string, string> = {
  'boundary precision/recall (§3.5)':
    'needs a fixture segmentation of the same story and source offsets to place it in; a ' +
    'generated arc is the only authoring of itself and has no source text',
  'required_beats coverage (§3.5)':
    "judged against a fixture scene's beats; there is no fixture scene",
  'beat invention rate (§3.5)':
    'judged against the source the beat claims to come from; there is no source',
  'pov/location accuracy (§3.5)': 'agreement with a fixture; there is no fixture',
  'source coverage (§3.5)': 'the fraction of a source text assigned to a scene; there is no source',
  'reveal-order fidelity (§3.6)': 'pairwise against the fixture order; there is no fixture order',
  'premature reveal count (§3.6)':
    'a reveal is premature relative to where the source discloses it; there is no source',
  'must_stay_hidden recall (§3.6)': "recall against the fixture's withholding; there is no fixture",
  'plant/payoff pair recall (§3.7)':
    "against the fixture's graph — but see pairs_from_generator below, which is the same question " +
    "asked against the generator's own authored graph, and is answerable",
};

interface ArcScore {
  readonly story_id: string;
  readonly segmenter_models: readonly string[];
  readonly events: number;
  readonly scenes: number;
  readonly events_per_scene: number;
  readonly telling_order_basis: string;
  readonly telling_order_displaced: number;
  readonly self_consistency: number | null;
  readonly signals_available: unknown;
  /** §4.1, over the real Story Package the segmentation produced. */
  readonly mechanical: unknown;
  /** §4.1 as #119 reported it over the same arc, for the before/after comparison. */
  readonly generator_all_gates_passed: boolean | null;
  readonly plant_edges: {
    readonly authored_by_generator: number;
    readonly authored_seed_grounded: number;
    readonly carried_onto_scenes: number;
    readonly dangling: number;
    readonly proposed_by_segmentation: number;
    readonly verified: number;
    readonly unrepresentable: number;
    readonly on_scene_cards: number;
  };
  readonly span_histogram_after: unknown;
  readonly unscoreable: Record<string, string>;
}

function scoreOne(
  storyId: string,
  segmented: StoryPackage,
  report: SegmentationReport,
  envelope: unknown,
  generatorGates: boolean | null,
): ArcScore {
  const { arc } = readFabulaArc(envelope);
  const authored = arc.events.flatMap((event) => event.pays_off);

  return {
    story_id: storyId,
    segmenter_models: report.models_used,
    events: report.events,
    scenes: report.scenes,
    events_per_scene: report.events_per_scene,
    telling_order_basis: report.telling_order.basis,
    telling_order_displaced: report.telling_order.displaced,
    self_consistency: report.boundaries.self_consistency,
    signals_available: report.signals_available,
    mechanical: scoreMechanicalPackage(segmented, arc, storyId, 'segmented_scenes'),
    generator_all_gates_passed: generatorGates,
    plant_edges: {
      authored_by_generator: authored.length,
      authored_seed_grounded: authored.filter((entry) => entry.plant === null).length,
      carried_onto_scenes: report.plants.carried_from_fabula,
      dangling: report.plants.dangling_plants,
      proposed_by_segmentation: report.plants.proposed,
      verified: report.plants.verified,
      unrepresentable: report.plants.seed_grounded_unrepresentable,
      on_scene_cards: plantSpans(segmented).length,
    },
    span_histogram_after: spanHistogram(segmented, 'segmented_scenes'),
    unscoreable: UNSCOREABLE_WITHOUT_GROUND_TRUTH,
  };
}

function summarize(report: SegmentationReport): string[] {
  const lines = [
    `  ${report.events} events → ${report.scenes} scenes (${report.events_per_scene.toFixed(1)} per scene), ` +
      `drawn in ${report.telling_order.basis} order`,
    `  boundaries: ${report.boundaries.decisions.filter((d) => d.decision === 'new_scene').length} judged new_scene, ` +
      `${report.boundaries.fell_back_to_signals} fell back to signals, ` +
      `self-consistency ${report.boundaries.self_consistency === null ? 'n/a' : report.boundaries.self_consistency.toFixed(2)}`,
    `  forced splits: ${report.grouping.forced_by_plant_span} by a plant span, ${report.grouping.forced_by_size} by the size guardrail`,
    `  substitutions: pov ${report.substitutions.pov_from_candidates}+${report.substitutions.pov_from_seed}, ` +
      `location ${report.substitutions.location_from_candidates}+${report.substitutions.location_from_seed}, ` +
      `beats ${report.substitutions.beats_from_events}`,
    `  plants: ${report.plants.carried_from_fabula} carried from the arc, ${report.plants.proposed} proposed, ` +
      `${report.plants.verified} verified, ${report.plants.seed_grounded_unrepresentable} unrepresentable, ` +
      `${report.plants.dangling_plants} dangling`,
    `  told-ledger: ${report.told_ledger.facts} facts, ${report.told_ledger.withheld_scene_entries} must_stay_hidden entries added`,
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

async function generatorGatesFor(storyId: string): Promise<boolean | null> {
  try {
    const saved = JSON.parse(
      await readFile(path.join(ARCS_DIR, `${storyId}.score.json`), 'utf8'),
    ) as { score?: { all_gates_passed?: boolean } };
    return saved.score?.all_gates_passed ?? null;
  } catch {
    return null;
  }
}

async function everyArc(): Promise<string[]> {
  const files = await readdir(ARCS_DIR);
  return files
    .filter((file) => file.endsWith('.package.json'))
    .map((file) => file.replace('.package.json', ''))
    .sort();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flagValues = new Set(
    argv.flatMap((argument, index) => (argument.startsWith('--') ? [argv[index + 1] ?? ''] : [])),
  );
  const named = argv.filter((argument) => !argument.startsWith('--') && !flagValues.has(argument));

  const model = flag('model') ?? WRITER_MODEL;
  if (!isSelectableWriterModel(model)) {
    throw new Error(`--model ${model} is not one of the project's selectable models.`);
  }
  const outDir = flag('out') ?? DEFAULT_OUT;

  const wanted =
    named.length > 0 ? named : has('mechanical') ? await everyArc() : [...DEFAULT_SAMPLE];

  let spent = 0;

  for (const storyId of wanted) {
    const inPath = path.join(ARCS_DIR, `${storyId}.package.json`);
    const envelope = JSON.parse(await readFile(inPath, 'utf8')) as unknown;
    const outStory = path.join(outDir, storyId);
    const packagePath = path.join(outStory, 'package.json');

    console.log(`\n=== ${storyId} ===`);

    if (has('mechanical')) {
      const result = segmentMechanically(envelope);
      console.log(
        `  mechanical baseline: ${result.package.scene_cards.length} scenes, ` +
          `lint ${result.lint.publishable ? 'PASS' : 'FAIL'} ` +
          `(${result.lint.errors.length} errors, ${result.lint.warnings.length} warnings)`,
      );
      for (const error of result.lint.errors) {
        console.log(`  !! ${error.code} ${error.path}: ${error.message}`);
      }
      continue;
    }

    let segmented: unknown;
    let report: SegmentationReport;

    if (has('rescore')) {
      segmented = JSON.parse(await readFile(packagePath, 'utf8')) as unknown;
      report = JSON.parse(
        await readFile(path.join(outStory, 'segmentation.json'), 'utf8'),
      ) as SegmentationReport;
      console.log(`  re-scoring the saved run (${report.models_used.join(', ')})`);
    } else {
      await mkdir(outStory, { recursive: true });
      const extraction = new ExtractionModel(liveClient(), model);
      const result = await segmentFabulaPackage(envelope, extraction, {
        onProgress: (message) => console.log(`    ${message}`),
      });
      segmented = result.package;
      report = result.report;
      spent += result.report.cost_usd;
      await writeFile(packagePath, `${JSON.stringify(result.package, null, 2)}\n`);
      await writeFile(
        path.join(outStory, 'segmentation.json'),
        `${JSON.stringify(result.report, null, 2)}\n`,
      );
      for (const line of summarize(result.report)) console.log(line);
    }

    const score = scoreOne(
      storyId,
      parseStoryPackage(segmented),
      report,
      envelope,
      await generatorGatesFor(storyId),
    );
    await writeFile(path.join(outStory, 'score.json'), `${JSON.stringify(score, null, 2)}\n`);

    const mechanical = score.mechanical as {
      all_gates_passed: boolean;
      g0: { passed: boolean };
      payoff_reachability: { reachable: number; total: number };
      causal_reachability: { reachable: number; total: number };
      required_beats: { empty: string[] };
      unpaid_facts: { facts: string[] };
    };
    console.log(
      `  §4.1 over the segmented package: gates ${mechanical.all_gates_passed ? 'PASS' : 'FAIL'} ` +
        `(generator's own §4.1 was ${score.generator_all_gates_passed === null ? 'n/a' : score.generator_all_gates_passed ? 'PASS' : 'FAIL'}); ` +
        `payoff ${mechanical.payoff_reachability.reachable}/${mechanical.payoff_reachability.total}, ` +
        `causal ${mechanical.causal_reachability.reachable}/${mechanical.causal_reachability.total}, ` +
        `empty beats ${mechanical.required_beats.empty.length}, unpaid ${mechanical.unpaid_facts.facts.length}`,
    );
    console.log(
      `  plant edges: ${score.plant_edges.authored_by_generator} authored ` +
        `(${score.plant_edges.authored_seed_grounded} seed-grounded) → ` +
        `${score.plant_edges.on_scene_cards} on Scene Cards ` +
        `(${score.plant_edges.carried_onto_scenes} carried, ${score.plant_edges.verified} added by segmentation, ` +
        `${score.plant_edges.unrepresentable} unrepresentable)`,
    );
  }

  if (spent > 0) console.log(`\ntotal spend this run: $${spent.toFixed(4)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
