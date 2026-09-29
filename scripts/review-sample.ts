/**
 * Generate a sample of random stories end to end, for the Story Review Panel to read.
 *
 *   env -u BLOB_READ_WRITE_TOKEN npm run review-sample
 *   env -u BLOB_READ_WRITE_TOKEN npm run review-sample -- --events 5,8,12,16,22
 *   env -u BLOB_READ_WRITE_TOKEN npm run review-sample -- --out prototypes/story-review/my-batch
 *
 * One story per `--events` entry, each from a different `RANDOM_PREMISES` entry (the Generate
 * tab's "surprise me" list), taken through the same three stages an author's phone would drive:
 * `generateArc` → `segmentFabulaPackage` → publish → `runTelling`. Nothing here is a new
 * mechanism; it is the app's own path, run unattended, with the prose written out as Markdown a
 * person — or a reviewer agent — can read top to bottom.
 *
 * **Local only, and it refuses otherwise.** `createBlobStore()` picks Vercel Blob whenever
 * `BLOB_READ_WRITE_TOKEN` is set, and that token is production's (`CLAUDE.md`). A sampling run
 * is an experiment, so this script exits before making a single call if the token is present,
 * rather than trusting whoever ran it to remember `env -u`.
 *
 * Writes, per story, into `<out>/<NN>-<story_id>/`: `story.md` (the prose, for reading),
 * `package.json` (the published Story Package, so a reviewer's finding can be traced to the
 * Fabula, the Scene Card, or the Performance), and `run.json` (models, cost, diagnostics).
 * See `docs/agents/story-review-panel.md` for what reads them next.
 */

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local; the key may still be in the environment.
}

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { materializeBrief } from '../src/arc/brief';
import { draftPackage } from '../src/arc/fabula';
import { generateArc, liveClient } from '../src/arc/generator';
import { RANDOM_PREMISES } from '../src/arc/random-premises';
import { lintPackage } from '../src/authoring/lint';
import { costOfGenerationCalls } from '../src/authoring/generate-run';
import { costForScenes } from '../src/edition/run-report';
import { runTelling } from '../src/edition/run-loop';
import { ExtractionModel } from '../src/extraction/call';
import { storyRepository } from '../src/persistence';
import { parseStoryPackage, scenesInOrder } from '../src/schema/story-package';
import { segmentFabulaPackage } from '../src/segmentation/segment';
import { WRITER_MODEL, writerModelFromEnv } from '../src/writer/model-client';

const DEFAULT_EVENTS = [5, 8, 12, 16, 22];

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

async function main(): Promise<void> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    console.error(
      'BLOB_READ_WRITE_TOKEN is set — that is the production store (CLAUDE.md). ' +
        'Re-run as: env -u BLOB_READ_WRITE_TOKEN npm run review-sample',
    );
    process.exit(2);
  }

  const events = (option('events') ?? DEFAULT_EVENTS.join(','))
    .split(',')
    .map((value) => Number.parseInt(value, 10));
  if (events.length > RANDOM_PREMISES.length) {
    throw new Error(`at most ${RANDOM_PREMISES.length} stories per batch, one per premise`);
  }
  const batch = new Date().toISOString().slice(0, 10);
  const outDir = option('out') ?? join('prototypes', 'story-review', batch);
  const model = writerModelFromEnv();
  const client = liveClient();
  const repository = storyRepository();
  const picks = shuffled(RANDOM_PREMISES).slice(0, events.length);

  await mkdir(outDir, { recursive: true });
  const index: Array<Record<string, unknown>> = [];

  for (const [n, pick] of picks.entries()) {
    const eventCount = events[n]!;
    const storyId = `review-${slug(pick.title)}`;
    const label = `${String(n + 1).padStart(2, '0')}-${storyId}`;
    const dir = join(outDir, label);
    await mkdir(dir, { recursive: true });
    console.log(`\n[${label}] "${pick.title}" — ${pick.plot_shape_preset}, ${eventCount} events`);

    try {
      const brief = materializeBrief({
        story_id: storyId,
        title: pick.title,
        premise: pick.premise,
        plot_shape_preset: pick.plot_shape_preset,
        event_count: eventCount,
        premise_preset: pick.title,
      });

      const generated = await generateArc(brief, { client, model });
      console.log(`  arc: ${generated.arc.events.length} events (${generated.model})`);
      const draft = draftPackage(generated.arc, storyId, {
        generator: 'scripts/review-sample.ts',
        model: generated.model,
        generated_at: new Date().toISOString(),
        brief,
        repairs: generated.repairs,
      });

      const extraction = new ExtractionModel(client, model);
      const segmentation = await segmentFabulaPackage(draft, extraction, {
        onProgress: (text) => console.log(`  segment: ${text}`),
      });

      const candidate = { ...segmentation.package, story_id: storyId, package_version: 1 };
      const lint = lintPackage(candidate);
      if (!lint.publishable) {
        throw new Error(`lint refused the package: ${lint.errors.map((e) => e.code).join(', ')}`);
      }
      const pkg = parseStoryPackage(candidate);
      await writeFile(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
      // Each batch starts its story ids over in the local store, so a rerun republishes v1.
      await repository.putPackage(pkg).catch(() => undefined);

      const { manifest, report } = await runTelling({
        pkg,
        client,
        repository,
        writerModel: model,
        onProgress: (event) => {
          if (event.type === 'scene_completed') console.log(`  scene ${event.scene_number}/${event.scene_count} written`);
        },
      });
      const scenes = await repository.getEditionScenes(manifest.run_id);
      const cards = scenesInOrder(pkg);
      const words = scenes.reduce((sum, s) => sum + s.prose.split(/\s+/).filter(Boolean).length, 0);
      const cost =
        costOfGenerationCalls(generated.calls) +
        extraction.costUsd +
        costForScenes(report.scenes).total_usd;

      const md = [
        `# ${pick.title}`,
        '',
        `> ${pick.premise.logline}`,
        '',
        `*${pick.plot_shape_preset} · ${eventCount} events requested · ${scenes.length} scenes · ` +
          `${words} words · run \`${manifest.run_id}\`*`,
        '',
        ...scenes.flatMap((scene) => [
          `## Scene ${scene.scene_index}`,
          `<!-- card: ${cards[scene.scene_index - 1]?.id ?? scene.scene_id} -->`,
          '',
          scene.prose.trim(),
          '',
        ]),
      ].join('\n');
      await writeFile(join(dir, 'story.md'), md);
      await writeFile(
        join(dir, 'run.json'),
        `${JSON.stringify(
          {
            title: pick.title,
            plot_shape_preset: pick.plot_shape_preset,
            premise: pick.premise,
            event_count_requested: eventCount,
            arc_events: generated.arc.events.length,
            scenes: scenes.length,
            words,
            run_id: manifest.run_id,
            models: {
              arc: generated.model,
              segmentation: extraction.modelsUsed,
              writer: [...new Set(report.scenes.flatMap((s) => s.calls.map((c) => c.model)))],
            },
            cost_usd: Number(cost.toFixed(4)),
            lint_warnings: lint.warnings.map((w) => w.code),
            degraded_scenes: report.scenes.filter((s) => s.degraded).map((s) => s.scene_id),
            diagnostics: report.scenes.flatMap((s) =>
              s.diagnostics.map((d) => ({ scene: s.scene_id, ...d })),
            ),
          },
          null,
          2,
        )}\n`,
      );
      console.log(`  → ${dir}/story.md (${scenes.length} scenes, ${words} words, $${cost.toFixed(3)})`);
      index.push({ label, title: pick.title, events: eventCount, scenes: scenes.length, words });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.log(`  FAILED — ${detail}`);
      index.push({ label, title: pick.title, events: eventCount, failed: detail });
    }
  }

  await writeFile(join(outDir, 'index.json'), `${JSON.stringify({ model, writer_default: WRITER_MODEL, stories: index }, null, 2)}\n`);
  console.log(`\nbatch written to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
