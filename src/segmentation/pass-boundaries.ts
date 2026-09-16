/**
 * Pass 1 — where do the scenes end?
 *
 * The one judgment `signals.ts` cannot make: Zehe's fourth clause, *"the narration focuses on one
 * action"*. Everything else about a boundary (space, cast, story time) is already on the table as
 * evidence when this pass runs; what it adds is whether the evidence adds up to a new scene.
 *
 * ## Bounded windows, and the trap #117 walked into
 *
 * The event list is read in overlapping windows of `WINDOW_EVENTS`, never in one call.
 * `docs/research/narrative-extraction-prior-art.md` §5 is the argument — *Same Task, More Tokens*
 * measures degradation beginning at 3,000 tokens, and *Lost in the Middle* puts the loss in the
 * middle of the context, which is precisely where the middle of a novel's event list would sit —
 * and #117's own `MAX_TOKENS` finding is the operational half: a truncated response under a
 * response schema is unparseable with no partial recovery.
 *
 * #117 also left a warning worth heeding in a module that does its own chunking. Its windowing
 * silently collapsed to a single window because CRLF line endings defeated a paragraph split,
 * *while still reporting a window count and looking fine*. This pass windows over an array rather
 * than over text, so that exact failure cannot recur — but the shape of it can, so
 * `BoundaryPassResult.windows` is asserted against the event count by `assertWindowed` and a run
 * that produced one window over a long list is a reported defect rather than a silent one.
 *
 * "Global" here means *sees the accumulated state*, never *one unbounded call*: each window is
 * preceded by a one-line recap of the scene the previous window left open, so the model can tell a
 * continuation from an opening without being handed the whole story.
 *
 * ## Overlap is a free stability number
 *
 * Windows overlap by `WINDOW_OVERLAP` events, so interior adjacencies are judged more than once.
 * The votes are reconciled by majority and the disagreements are counted. §3.5 of the rubric
 * suggests running the pipeline twice over the same source to get a self-consistency number that
 * needs no ground truth; the overlap gives a cheaper version of the same thing inside a single
 * run, and a pass that disagrees with itself on a third of its adjacencies has not earned any of
 * its other numbers.
 */

import { z } from 'zod';

import { ExtractionCallError, type ExtractionModel } from '../extraction/call';
import type { FabulaEvent } from '../schema/fabula';
import { extrasOf, type Adjacency } from './signals';
import { mechanicalBoundaries } from './grouping';

/** Events per window. Small enough that the whole window sits at the front of the context. */
export const WINDOW_EVENTS = 24;
/** How many events two consecutive windows share, so every interior adjacency is judged twice. */
export const WINDOW_OVERLAP = 6;

export const BOUNDARY_DECISIONS = ['same_scene', 'new_scene'] as const;
export type BoundaryDecision = (typeof BOUNDARY_DECISIONS)[number];

const BoundaryResponseSchema = z.object({
  decisions: z
    .array(
      z.object({
        after_event_id: z.string(),
        decision: z.enum(BOUNDARY_DECISIONS),
        why: z.string().default(''),
      }),
    )
    .default([]),
});

const BOUNDARY_SYSTEM = `You are marking SCENE BOUNDARIES in a chronological list of story events.

A SCENE is a stretch of story where the narration stays on ONE action, in ONE place, with the
same people, and story time runs continuously. A new scene starts when any of those genuinely
breaks — the action completes and a different one begins, time skips, or the people on stage
change over.

For each numbered event AFTER the first one in the window, answer whether it belongs to the SAME
scene as the event before it, or STARTS A NEW one.

Judge like an editor cutting a film, not like a tagger:

- Moving through connected spaces on one continuous errand is ONE scene (a character crosses a
  yard, climbs a stair and enters a room). A named location change is evidence, not a verdict.
- A conversation, an arrival, and the argument that follows are usually ONE scene.
- A jump in time ("the next morning", "years later"), a cut to different people elsewhere, or the
  completion of the thing the scene was about — those START a new scene.
- A montage of glimpses that belong to one sweep of narration is ONE scene, even across places.

You are shown the mechanical evidence for each gap. Use it. Disagree with it when the prose-level
sense of the events says otherwise; that is why you are being asked.

Err toward FEWER, larger scenes. Over-segmentation is the documented failure mode of automated
scene detection: mark a new scene when you can say what changed, not merely when something did.`;

function boundaryJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            after_event_id: {
              type: 'string',
              description: 'The id of the LATER event of the gap, copied verbatim.',
            },
            decision: { type: 'string', enum: [...BOUNDARY_DECISIONS] },
            why: { type: 'string', description: 'One short clause naming what changed, or held.' },
          },
          required: ['after_event_id', 'decision', 'why'],
          propertyOrdering: ['after_event_id', 'decision', 'why'],
        },
      },
    },
    required: ['decisions'],
  };
}

export interface EventWindow {
  readonly index: number;
  /** Inclusive start, exclusive end, into the ordered event list. */
  readonly start: number;
  readonly end: number;
}

/** Overlapping windows over the event list. Never one window over a list longer than one window. */
export function eventWindows(
  eventCount: number,
  size = WINDOW_EVENTS,
  overlap = WINDOW_OVERLAP,
): EventWindow[] {
  const step = Math.max(1, size - overlap);
  const windows: EventWindow[] = [];
  for (let start = 0; start < eventCount; start += step) {
    const end = Math.min(eventCount, start + size);
    windows.push({ index: windows.length, start, end });
    if (end === eventCount) break;
  }
  return windows;
}

/**
 * The invariant #117's CRLF bug would have caught: a long list must produce more than one window.
 *
 * Returned as a problem string rather than thrown, because a run that windows wrongly should still
 * finish and say so — a diagnostic in the report is worth more than an exception at hour two.
 */
export function assertWindowed(eventCount: number, windows: readonly EventWindow[]): string[] {
  const problems: string[] = [];
  if (eventCount > WINDOW_EVENTS && windows.length < 2) {
    problems.push(
      `${eventCount} events collapsed into ${windows.length} window(s) — the boundary pass would ` +
        'have been one unbounded call over the whole list',
    );
  }
  const covered = new Set<number>();
  for (const window of windows) {
    for (let index = window.start; index < window.end; index += 1) covered.add(index);
  }
  if (covered.size !== eventCount) {
    problems.push(`windows cover ${covered.size} of ${eventCount} events`);
  }
  return problems;
}

function renderEvent(event: FabulaEvent, position: number): string {
  const extras = extrasOf(event);
  const parts = [
    `${position}. [${event.id}] ${event.summary}`,
    `   where: ${event.location_id ?? '(not named)'}`,
    `   who: ${event.characters_present.length === 0 ? '(nobody named)' : event.characters_present.join(', ')}`,
  ];
  if (event.dramatic_function !== undefined) parts.push(`   function: ${event.dramatic_function}`);
  if (extras.time_anchor !== null && extras.time_anchor !== '') {
    parts.push(`   time cue: "${extras.time_anchor}"`);
  }
  return parts.join('\n');
}

function renderGap(adjacency: Adjacency, afterId: string): string {
  const evidence =
    adjacency.reasons.length === 0 ? 'nothing obvious changes' : adjacency.reasons.join('; ');
  return `   ...gap before [${afterId}] — mechanical evidence: ${evidence}`;
}

export interface BoundaryPassResult {
  /** Adjacency indices judged to open a new scene. */
  readonly boundaries: ReadonlySet<number>;
  readonly windows: readonly EventWindow[];
  readonly window_problems: readonly string[];
  readonly failed_windows: readonly number[];
  /** Adjacencies no window successfully judged, resolved from the mechanical score instead. */
  readonly fell_back_to_signals: number;
  /** Adjacencies judged more than once where the judgments differed. */
  readonly disagreements: number;
  readonly judged_adjacencies: number;
  /** disagreements ÷ adjacencies judged more than once. The run's own stability number. */
  readonly self_consistency: number | null;
  readonly decisions: ReadonlyArray<{
    index: number;
    after_event_id: string;
    decision: BoundaryDecision;
    votes: number;
    why: string;
    from_signals: boolean;
  }>;
}

export async function findBoundaries(
  model: ExtractionModel,
  events: readonly FabulaEvent[],
  adjacencies: readonly Adjacency[],
  options: { windowSize?: number; overlap?: number; onProgress?: (message: string) => void } = {},
): Promise<BoundaryPassResult> {
  const progress = options.onProgress ?? ((): void => {});
  const windows = eventWindows(events.length, options.windowSize, options.overlap);
  const windowProblems = assertWindowed(events.length, windows);

  const votes = new Map<number, Array<{ decision: BoundaryDecision; why: string }>>();
  const failed: number[] = [];
  const indexOf = new Map(events.map((event, index) => [event.id, index]));

  for (const window of windows) {
    const slice = events.slice(window.start, window.end);
    if (slice.length < 2) continue;

    // The accumulated state, bounded to one line: what scene the previous window left open.
    const preceding = window.start === 0 ? null : events[window.start - 1]!;
    const lines: string[] = [];
    if (preceding !== null) {
      lines.push(
        `PRECEDING EVENT (already assigned; shown so you can tell a continuation from an opening):`,
        `   [${preceding.id}] ${preceding.summary}`,
        '',
      );
    }
    lines.push('EVENTS:');
    slice.forEach((event, offset) => {
      if (offset > 0) {
        const adjacency = adjacencies[window.start + offset - 1];
        if (adjacency !== undefined) lines.push(renderGap(adjacency, event.id));
      }
      lines.push(renderEvent(event, offset + 1));
    });

    progress(`boundary window ${window.index + 1}/${windows.length} (events ${window.start + 1}–${window.end})`);

    try {
      const response = await model.json(BoundaryResponseSchema, {
        pass: 'segmentation.boundaries',
        label: `window ${window.index} (${window.start}–${window.end})`,
        systemInstruction: BOUNDARY_SYSTEM,
        contents: lines.join('\n'),
        responseJsonSchema: boundaryJsonSchema(),
        maxOutputTokens: 4096,
      });
      for (const decision of response.decisions) {
        const at = indexOf.get(decision.after_event_id);
        if (at === undefined || at === 0) continue;
        if (at <= window.start || at >= window.end) continue;
        const list = votes.get(at - 1) ?? [];
        list.push({ decision: decision.decision, why: decision.why });
        votes.set(at - 1, list);
      }
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      failed.push(window.index);
    }
  }

  const signalBoundaries = mechanicalBoundaries(adjacencies);
  const boundaries = new Set<number>();
  const decisions: Array<BoundaryPassResult['decisions'][number]> = [];
  let disagreements = 0;
  let multiplyJudged = 0;
  let fellBack = 0;

  for (const adjacency of adjacencies) {
    const cast = votes.get(adjacency.index) ?? [];
    if (cast.length === 0) {
      fellBack += 1;
      const fromSignals = signalBoundaries.has(adjacency.index);
      if (fromSignals) boundaries.add(adjacency.index);
      decisions.push({
        index: adjacency.index,
        after_event_id: adjacency.after_id,
        decision: fromSignals ? 'new_scene' : 'same_scene',
        votes: 0,
        why: adjacency.reasons.join('; '),
        from_signals: true,
      });
      continue;
    }

    if (cast.length > 1) {
      multiplyJudged += 1;
      if (new Set(cast.map((vote) => vote.decision)).size > 1) disagreements += 1;
    }

    const newScene = cast.filter((vote) => vote.decision === 'new_scene').length;
    // A tie goes to `same_scene`: over-segmentation is the documented failure mode
    // (`narrative-extraction-prior-art.md` §3.1), so the ambiguous case keeps the story running.
    const decision: BoundaryDecision = newScene * 2 > cast.length ? 'new_scene' : 'same_scene';
    if (decision === 'new_scene') boundaries.add(adjacency.index);
    decisions.push({
      index: adjacency.index,
      after_event_id: adjacency.after_id,
      decision,
      votes: cast.length,
      why: cast.find((vote) => vote.decision === decision)?.why ?? '',
      from_signals: false,
    });
  }

  return {
    boundaries,
    windows,
    window_problems: windowProblems,
    failed_windows: failed,
    fell_back_to_signals: fellBack,
    disagreements,
    judged_adjacencies: adjacencies.length - fellBack,
    self_consistency: multiplyJudged === 0 ? null : 1 - disagreements / multiplyJudged,
    decisions,
  };
}
