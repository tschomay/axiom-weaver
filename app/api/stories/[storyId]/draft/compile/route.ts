import { NextResponse } from 'next/server';
import { bearerToken, isAuthorizedAuthorRequest } from '@/admin/authorize';
import { storyRepository } from '@/persistence';
import { compileSceneIntoDraft } from '@/draft/draft-compile';
import { surfacesFor } from '@/validator/diagnostics';
import {
  GeminiClient,
  dailyQuotaFailure,
  isSelectableWriterModel,
  quotaOffer,
  writerModelFromEnv,
} from '@/writer/model-client';
import { SyntheticWriterClient } from '@/writer/synthetic-client';
import { PlantWalkRejectedError } from '@/plants/obligation-walk';

export const dynamic = 'force-dynamic';
/** A live writer call for one scene can outrun the default serverless ceiling. */
export const maxDuration = 300;

/**
 * Compile one Scene Card into the Working Draft — the action behind ADR 0016 §1's scene compile
 * view, and the only thing an author does one card at a time (`CONTEXT.md`, Compile occasions).
 *
 * What comes back is scoped to the card just compiled, because that is what the surface shows:
 * the diagnostics ADR 0016 §4 sends to the scene compile view at author-time (`error` and `warn`;
 * `info` is run-report-only and is filtered out here rather than shown quietly), the volitional
 * proposals this card left pending, and the staleness the recompile propagated forward.
 *
 * Author-gated like every other write surface (ADR 0015 §5).
 */
export async function POST(request: Request, { params }: { params: Promise<{ storyId: string }> }) {
  if (!isAuthorizedAuthorRequest(bearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { storyId } = await params;
  const repository = storyRepository();

  const body = (await request.json().catch(() => null)) as
    | { scene_id?: unknown; writer?: unknown; model?: unknown }
    | null;
  const sceneId = typeof body?.scene_id === 'string' ? body.scene_id : null;
  if (sceneId === null) {
    return NextResponse.json({ error: 'Expected a JSON body with a scene_id' }, { status: 400 });
  }
  if (body?.writer !== undefined && body.writer !== 'live' && body.writer !== 'stand_in') {
    return NextResponse.json({ error: 'writer must be "live" or "stand_in"' }, { status: 400 });
  }
  const requestedWriter = body?.writer === 'stand_in' ? 'stand_in' : 'live';

  // A named model is how an author takes up the offer a spent daily quota produces below. It is
  // always their choice and never a default: nothing here reaches for a cheaper model on its own.
  if (body?.model !== undefined) {
    if (typeof body.model !== 'string' || !isSelectableWriterModel(body.model)) {
      return NextResponse.json({ error: `"${String(body.model)}" is not a writer model this deployment will call` }, { status: 400 });
    }
  }
  const writerModel = typeof body?.model === 'string' ? body.model : writerModelFromEnv();

  const pkg = await repository.getCurrentPackage(storyId);
  if (pkg === null) {
    return NextResponse.json({ error: `No package retained for "${storyId}"` }, { status: 404 });
  }

  // The stand-in composes every scene from its own Scene Card, which exercises the whole
  // author-time path — validation, continuity pass, staleness — without spending one of a
  // rate-limited key's requests. On the project's free-tier key a single telling exhausts the
  // day's writer allowance (AGENTS.md, The Gemini API key), so an author proving the *mechanism*
  // needs to be able to ask for it while a key is configured, not only by unsetting one.
  //
  // It is a choice the caller makes and never one made for them: the writer that actually wrote
  // the scene is reported back either way, because a compile that does not say which model wrote
  // it is worse than a compile that did not happen.
  const live = requestedWriter === 'live' ? GeminiClient.fromEnv() : null;
  const client = live ?? new SyntheticWriterClient(pkg);

  let result;
  try {
    result = await compileSceneIntoDraft({ pkg, sceneId, client, repository, writerModel });
  } catch (error) {
    if (error instanceof PlantWalkRejectedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    // The day's allowance is spent. The client has already tried the capacity fallback, so no
    // retry on this model will do anything before midnight Pacific — but a model with its own,
    // larger allowance would. Hand the surface what it needs to *ask*, rather than degrading the
    // writer quietly, which would put a scene in the draft nobody chose the model for.
    const quota = dailyQuotaFailure(error, writerModel);
    if (quota !== null) {
      return NextResponse.json(
        {
          error: `${quota.model} has no requests left today.`,
          quota: quotaOffer(quota.model, quota.detail, quota.retry_after_ms),
        },
        { status: 429 },
      );
    }

    // A scene whose predecessors are not in the draft cannot be compiled, and `replayTo` says so
    // rather than compiling against an empty history. That is a request problem, not a crash.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 409 },
    );
  }

  const scene = result.compiled;
  const sceneIndex = pkg.scene_cards.find((card) => card.id === sceneId)?.order ?? 0;
  const log = await repository.getDraftStateLog(storyId);

  return NextResponse.json({
    story_id: storyId,
    scene_id: sceneId,
    scene_index: sceneIndex,
    package_version: pkg.package_version,
    writer: {
      live: live !== null,
      requested: requestedWriter,
      model:
        live !== null
          ? writerModel
          : requestedWriter === 'stand_in'
            ? 'stand-in writer — composed from the Scene Card, no model called'
            : 'stand-in writer — no GEMINI_API_KEY configured, so no model was called',
      calls: scene.calls.length,
    },
    prose: result.pass.prose,
    digest: result.pass.digest,
    diagnostics: result.diagnostics
      .filter((entry) => surfacesFor(entry.severity, 'author_time').includes('scene_compile_view'))
      .map((entry) => ({
        code: entry.code,
        severity: entry.severity,
        entity_id: entry.entity_id,
        column: entry.column,
        message: entry.message,
      })),
    proposals: log
      .forScene(sceneIndex)
      .filter((entry) => entry.status === 'proposed')
      .map((entry) => ({
        sequence: entry.sequence,
        entity_id: entry.entity_id,
        table: entry.table,
        column: entry.column,
        tier: entry.tier,
        previous_value: entry.previous_value,
        new_value: entry.new_value,
      })),
    staleness: {
      diff: result.diff,
      newly_stale: result.newly_stale,
    },
  });
}
