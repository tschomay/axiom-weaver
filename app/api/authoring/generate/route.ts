import { NextResponse } from 'next/server';
import { bearerToken, isAuthorizedAuthorRequest } from '@/admin/authorize';
import { storyRepository } from '@/persistence';
import {
  PLANT_DENSITIES,
  PLOT_SHAPE_IDS,
  materializeBrief,
  type BriefInput,
  type PlantPolicy,
  type Premise,
  type PremiseModules,
} from '@/arc/brief';
import { liveClient } from '@/arc/generator';
import { runGenerate } from '@/authoring/generate-run';
import { mintAuthoringRunId } from '@/authoring/run';
import { isSelectableWriterModel, writerModelFromEnv } from '@/writer/model-client';

export const dynamic = 'force-dynamic';

function parsePremise(body: Record<string, unknown>): Premise | { error: string } {
  const premise = body.premise;
  if (typeof premise !== 'object' || premise === null) {
    return { error: 'premise must be an object with a logline' };
  }
  const { logline, modules } = premise as Record<string, unknown>;
  if (typeof logline !== 'string' || logline.trim() === '') {
    return { error: 'premise.logline is required' };
  }
  if (modules === null || modules === undefined) {
    return { logline: logline.trim(), modules: null };
  }
  if (typeof modules !== 'object') {
    return { error: 'premise.modules must be an object or null' };
  }
  const fields: (keyof PremiseModules)[] = [
    'theme',
    'setting_time',
    'setting_place',
    'protagonist',
    'protagonist_want',
    'antagonism',
    'complication',
    'ending_shape',
  ];
  const built: Partial<Record<keyof PremiseModules, string>> = {};
  for (const field of fields) {
    const value = (modules as Record<string, unknown>)[field];
    if (typeof value !== 'string' || value.trim() === '') {
      return { error: `premise.modules.${field} is required once premise.modules is given` };
    }
    built[field] = value.trim();
  }
  return { logline: logline.trim(), modules: built as PremiseModules };
}

/**
 * "Generate a new story from a premise" (ADR 0021, #172).
 *
 * The same mint-id / start-un-awaited / `202` shape the tellings route established
 * (`app/api/stories/[storyId]/tellings/route.ts`): this handler mints an Authoring run id,
 * starts `runGenerate` without awaiting it, and hands the id back immediately so the caller polls
 * `GET /api/authoring/generate/{runId}` for stage-based progress (ADR 0021 decision 5).
 *
 * The cost guard is this route itself: an explicit POST is the confirm action (the form never
 * submits on its own), and `model` is restricted to `SELECTABLE_WRITER_MODELS` the same way the
 * tellings route restricts it. Unlike tellings, there is no `stand_in` arm — arc generation has no
 * recorded stand-in (`liveClient`'s own comment), so a missing key fails the request outright
 * rather than silently substituting anything.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null) {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title === '') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const premise = parsePremise(body);
  if ('error' in premise) {
    return NextResponse.json({ error: premise.error }, { status: 400 });
  }

  const plotShapePreset = typeof body.plot_shape_preset === 'string' ? body.plot_shape_preset : '';
  if (!PLOT_SHAPE_IDS.includes(plotShapePreset)) {
    return NextResponse.json(
      { error: `plot_shape_preset must be one of ${PLOT_SHAPE_IDS.join(', ')}` },
      { status: 400 },
    );
  }

  const eventCount = body.event_count;
  if (eventCount !== undefined && (typeof eventCount !== 'number' || !Number.isInteger(eventCount))) {
    return NextResponse.json({ error: 'event_count must be an integer' }, { status: 400 });
  }

  const plantDensity = body.plant_density;
  if (plantDensity !== undefined && !PLANT_DENSITIES.includes(plantDensity as PlantPolicy['density'])) {
    return NextResponse.json(
      { error: `plant_density must be one of ${PLANT_DENSITIES.join(', ')}` },
      { status: 400 },
    );
  }

  const spanGuidance = body.span_guidance;
  if (spanGuidance !== undefined && typeof spanGuidance !== 'boolean') {
    return NextResponse.json({ error: 'span_guidance must be a boolean' }, { status: 400 });
  }

  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || !isSelectableWriterModel(body.model)) {
      return NextResponse.json(
        { error: `"${String(body.model)}" is not a writer model this deployment will call` },
        { status: 400 },
      );
    }
  }
  const model = typeof body.model === 'string' ? body.model : writerModelFromEnv();

  let client;
  try {
    client = liveClient();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'arc generation is not configured' },
      { status: 503 },
    );
  }

  const runId = mintAuthoringRunId();
  const briefInput: BriefInput = {
    story_id: runId,
    title,
    premise,
    plot_shape_preset: plotShapePreset,
    event_count: eventCount as number | undefined,
    plant_density: plantDensity as PlantPolicy['density'] | undefined,
    span_guidance: spanGuidance as boolean | undefined,
    premise_preset: null,
  };
  const brief = materializeBrief(briefInput);
  const repository = storyRepository();

  void runGenerate({ brief, client, repository, runId, model }).catch((error: unknown) => {
    // The run's own failure path has already marked the manifest `failed` and flushed it; this is
    // only so a crash outside that path is not silent in the server log.
    console.error(`authoring run ${runId} stopped:`, error);
  });

  return NextResponse.json(
    { run_id: runId, model, status_path: `/api/authoring/generate/${runId}` },
    { status: 202 },
  );
}
