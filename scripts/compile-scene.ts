/**
 * Compile a single scene from a fixture, end to end, and print the debug view.
 *
 *   npm run compile-scene                       # both fixtures, recorded stubs or live
 *   npm run compile-scene -- cinderella         # one fixture
 *   npm run compile-scene -- cinderella --verbose
 *
 * With `GEMINI_API_KEY` set this makes a real writer call. Without one it replays the recorded
 * fixture-stub under `fixtures/recorded/`, and says so on every run — issue #40's definition of
 * done asks for exactly that distinction to be called out rather than silently skipped.
 *
 * Unlike `npm run dev`/`build`, this script runs under `tsx` directly, which does not auto-load
 * `.env.local` the way Next.js does — so `GEMINI_API_KEY` in `.env.local` would otherwise be
 * silently invisible here. `process.loadEnvFile` (Node >=20.6) closes that gap without a new
 * dependency; it is a no-op, not an error, when the file does not exist.
 */

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local — recorded fixtures still work without one.
}

import { readFixturePackage } from '../src/fixtures/load';
import { parseVoiceCard } from '../src/voice/voice-card';
import { walkPlantObligations } from '../src/plants/obligation-walk';
import { replayTo } from '../src/writer/run-state';
import { compileScene } from '../src/writer/compile-scene';
import { GeminiClient, type ModelClient } from '../src/writer/model-client';
import { clientFor, readRecordedFixture } from '../src/writer/recorded-fixture';
import { renderCompiledSceneReport } from '../src/writer/debug-view';
import { scenesInOrder } from '../src/schema/story-package';

/** Which recorded fixture stands in for each story's writer call. */
const RECORDINGS: Record<string, string> = {
  cinderella: 'cinderella-scene-13',
  'a-christmas-carol': 'a-christmas-carol-scene-08',
};

async function compileOne(fixture: string, recordingName: string, verbose: boolean): Promise<void> {
  const pkg = await readFixturePackage(fixture);
  const recording = await readRecordedFixture(recordingName);
  const voiceCard = parseVoiceCard(pkg.voice_card);

  const walk = walkPlantObligations(pkg);
  if (walk.errors.length > 0) {
    // ADR 0004 decision 4: hard failures, before generation, never silently patched.
    console.error(`\n${fixture}: plant-obligation walk rejected the package:`);
    for (const error of walk.errors) console.error(`  [${error.code}] ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const live = GeminiClient.fromEnv();
  const client: ModelClient = live ?? clientFor(recording);

  const state = await replayTo(pkg, recording.target_scene_id, recording.prior_digests, {
    window: recording.window,
  });
  const scene = scenesInOrder(pkg).find((card) => card.id === recording.target_scene_id);
  if (scene === undefined) throw new Error(`No scene "${recording.target_scene_id}" in ${fixture}`);

  const compiled = await compileScene({
    pkg,
    scene,
    model: state.model,
    voiceCard,
    hierarchy: state.hierarchy,
    ledger: state.ledger,
    plantWalk: walk,
    client,
    imageryHistory: state.imageryHistory,
    previousParagraph: recording.previous_paragraph ?? state.previousParagraph,
    occasion: 'read_time',
  });

  // The digest and state updates go through ticket 1's validator, which is what the definition of
  // done means by "pass ticket 1's validator" — the writer's proposals are not trusted on sight.
  const validation = state.commitWriterUpdates(scene, compiled.response.state_updates, 'read_time');

  console.log(`\n${'#'.repeat(78)}`);
  console.log(`# ${fixture} — ${scene.id} (order ${scene.order})`);
  console.log(
    `# writer call: ${live === null ? `RECORDED STUB (fixtures/recorded/${recordingName}.json) — no GEMINI_API_KEY set, so no model was called` : 'LIVE Gemini call'}`,
  );
  console.log(`${'#'.repeat(78)}\n`);

  console.log(renderCompiledSceneReport(compiled, { verbose }));

  console.log(`\n${'='.repeat(78)}\nSTATE-UPDATE VALIDATION (ticket 1's validator)\n${'='.repeat(78)}`);
  for (const verdict of validation.verdicts) {
    console.log(
      `  ${verdict.outcome.padEnd(9)} ${verdict.entity_id}.${verdict.column} (tier ${verdict.tier ?? '-'})`,
    );
  }
  if (validation.verdicts.length === 0) console.log('  (no state updates proposed)');
  for (const diagnostic of validation.diagnostics) {
    console.log(`  [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
  }

  if (verbose) {
    console.log(`\n${'='.repeat(78)}\nPROSE\n${'='.repeat(78)}\n`);
    console.log(compiled.prose);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const named = args.filter((arg) => !arg.startsWith('--'));
  const fixtures = named.length > 0 ? named : Object.keys(RECORDINGS);

  for (const fixture of fixtures) {
    const recording = RECORDINGS[fixture];
    if (recording === undefined) {
      console.error(`No recorded scene for fixture "${fixture}"`);
      process.exitCode = 1;
      continue;
    }
    await compileOne(fixture, recording, verbose);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
