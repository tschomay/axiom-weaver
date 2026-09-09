/**
 * Loading a recorded writer response so a scene can compile without API credentials.
 *
 * Issue #40's definition of done allows "a recorded fixture-stub standing in for the model
 * response — call this out explicitly rather than silently skipping it". This module is that
 * path, and it is deliberately a *separate* client implementation rather than a flag inside the
 * real one: nothing about a recorded run should be able to leak into a live call, and a reader of
 * a run report should be able to tell which one produced it.
 *
 * The recorded prior digests are what makes a *mid-book* scene compilable — reaching scene 13
 * otherwise means generating twelve scenes first, which no test and no offline session can pay
 * for. See `replayTo` for what they are replayed into.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { SceneDigestSchema, type SceneDigest } from '../digest/scene-digest';
import { WriterResponseSchema, type WriterResponse } from './response-schema';
import { RecordedClient, type ModelResponse } from './model-client';

const RecordedFixtureSchema = z.looseObject({
  story_id: z.string().min(1),
  target_scene_id: z.string().min(1),
  window: z.number().int().positive().default(4),
  prior_digests: z.record(z.string(), SceneDigestSchema).default({}),
  /**
   * The verbatim tail (ADR 0008 §3) — the final paragraph of the previous scene's actual prose.
   *
   * Recorded separately because replaying prior scenes from their digests reconstructs everything
   * *except* this: a digest is a summary, and the verbatim tail exists precisely because a summary
   * is not the words the reader just read.
   */
  previous_paragraph: z.string().nullable().default(null),
  response: WriterResponseSchema,
});

export interface RecordedFixture {
  readonly story_id: string;
  readonly target_scene_id: string;
  readonly window: number;
  readonly prior_digests: Map<string, SceneDigest>;
  readonly previous_paragraph: string | null;
  readonly response: WriterResponse;
}

export function recordedFixturePath(name: string, root = process.cwd()): string {
  return join(root, 'fixtures', 'recorded', `${name}.json`);
}

export async function readRecordedFixture(
  name: string,
  root = process.cwd(),
): Promise<RecordedFixture> {
  const body = await readFile(recordedFixturePath(name, root), 'utf8');
  const parsed = RecordedFixtureSchema.parse(JSON.parse(body));
  return {
    story_id: parsed.story_id,
    target_scene_id: parsed.target_scene_id,
    window: parsed.window,
    prior_digests: new Map(Object.entries(parsed.prior_digests)),
    previous_paragraph: parsed.previous_paragraph,
    response: parsed.response,
  };
}

/**
 * A client that will replay this fixture's recorded response for its target scene.
 *
 * `finish_reason: STOP` and zero usage: a recording carries no billing information, and reporting
 * invented token counts would put fiction into the same run report a real run writes real numbers
 * into.
 */
export function clientFor(fixture: RecordedFixture): RecordedClient {
  const response: ModelResponse = {
    text: JSON.stringify(fixture.response),
    finish_reason: 'STOP',
    usage: { prompt_tokens: 0, output_tokens: 0, cached_tokens: 0 },
  };
  return new RecordedClient({ [fixture.target_scene_id]: [response] });
}
