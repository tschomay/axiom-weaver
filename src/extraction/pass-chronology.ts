/**
 * Pass 4 — put the event list in Fabula order.
 *
 * The Fabula is chronological; the Syuzhet is the arrangement (`CONTEXT.md`, The three layers).
 * Everything up to here has been reading in narrated order, so this is the step that actually
 * produces the deliverable the ticket names: *a chronological Fabula event list*.
 *
 * It runs over event summaries and their `story_time` buckets — never over prose. That is §5's
 * conclusion applied one more time, and it is also what makes this pass cheap enough to check:
 * the input is a few thousand tokens of structure rather than a novel.
 *
 * **The bucket sort is the answer; the model only orders within a bucket.** Asking a model to
 * totally order 150 events in one response invites two failures at once — dropped ids and an
 * inverted past/present relation — and only one of them is detectable. Splitting it means a
 * failure inside one bucket costs that bucket, the cross-bucket relations (which are the pairs
 * rubric §3.3 actually cares about, the ones the source narrates out of order) come from a rule
 * rather than from a sample, and a bucket whose call fails falls back to narrated order, which
 * for a realist 19th-century source is a strong prior rather than a coin flip.
 *
 * The rule is `past < present < future`, and it is a *rule*, stated here so it can be argued
 * with: it is right for both fixtures and it is not right in general — a frame narrative told
 * from the future would break it, and so would any story whose opening situation is itself a
 * flash-forward.
 */

import { z } from 'zod';

import type { ExtractionModel } from './call';
import { ExtractionCallError } from './call';
import { STORY_TIMES, type StoryTime, type ExtractedEvent } from './pass-events';

const BUCKET_RANK: Record<StoryTime, number> = { past: 0, present: 1, future: 2 };

export const OrderResponseSchema = z.object({
  ordered_event_ids: z.array(z.string()).default([]),
});

export interface ChronologyResult {
  /** Event ids, earliest first. Every input event appears exactly once. */
  readonly order: string[];
  /** Buckets whose ordering call failed or returned an unusable list. */
  readonly fallback_buckets: StoryTime[];
  /** Ids the model omitted and this pass had to re-insert, per bucket. */
  readonly repaired_ids: number;
  /** Ids the model repeated or invented, dropped by the validator. */
  readonly rejected_ids: number;
}

const SYSTEM = `You are given events from one story, all of which happen in the same broad
story-time band. Put them in the order they HAPPEN, earliest first — not the order the story
tells them in.

Use the time anchors and the content. Events that plainly happen at the same moment may go in
any order relative to each other; keep them adjacent.

Return every event id you were given, exactly once, and nothing else.`;

function jsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      ordered_event_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Every given event id, exactly once, earliest happening first.',
      },
    },
    required: ['ordered_event_ids'],
  };
}

export async function orderChronologically(
  model: ExtractionModel,
  events: readonly ExtractedEvent[],
): Promise<ChronologyResult> {
  const order: string[] = [];
  const fallback: StoryTime[] = [];
  let repaired = 0;
  let rejected = 0;

  for (const bucket of [...STORY_TIMES].sort((a, b) => BUCKET_RANK[a] - BUCKET_RANK[b])) {
    const inBucket = events.filter((event) => event.story_time === bucket);
    if (inBucket.length === 0) continue;
    if (inBucket.length === 1) {
      order.push(inBucket[0]!.id);
      continue;
    }

    const listing = inBucket
      .map(
        (event) =>
          `${event.id} | ${event.time_anchor === '' ? 'no anchor' : event.time_anchor} | ${event.summary}`,
      )
      .join('\n');

    let proposed: string[] | null = null;
    try {
      const response = await model.json(OrderResponseSchema, {
        pass: 'chronology',
        label: `${bucket} (${inBucket.length} events)`,
        systemInstruction: SYSTEM,
        contents: `STORY-TIME BAND: ${bucket}\n\nEVENTS (in the order the story narrates them):\n${listing}`,
        responseJsonSchema: jsonSchema(),
        maxOutputTokens: 4096,
        thinkingLevel: 'MEDIUM',
      });
      proposed = response.ordered_event_ids;
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      proposed = null;
    }

    if (proposed === null) {
      fallback.push(bucket);
      order.push(...inBucket.map((event) => event.id));
      continue;
    }

    const repair = repairOrder(
      proposed,
      inBucket.map((event) => event.id),
    );
    repaired += repair.appended;
    rejected += repair.rejected;
    if (repair.appended === inBucket.length) fallback.push(bucket);
    order.push(...repair.order);
  }

  return { order, fallback_buckets: fallback, repaired_ids: repaired, rejected_ids: rejected };
}

/**
 * Make a proposed ordering total and injective over `expected`, keeping narrated order for
 * whatever the model left out.
 *
 * Reported rather than smoothed over: `appended` is how much of the ordering the model did not
 * actually produce, and a bucket where it equals the bucket size means the call contributed
 * nothing at all.
 */
export function repairOrder(
  proposed: readonly string[],
  expected: readonly string[],
): { order: string[]; appended: number; rejected: number } {
  const allowed = new Set(expected);
  const placed = new Set<string>();
  const order: string[] = [];
  let rejected = 0;

  for (const id of proposed) {
    if (!allowed.has(id) || placed.has(id)) {
      rejected += 1;
      continue;
    }
    placed.add(id);
    order.push(id);
  }

  let appended = 0;
  for (const id of expected) {
    if (placed.has(id)) continue;
    order.push(id);
    appended += 1;
  }

  return { order, appended, rejected };
}
