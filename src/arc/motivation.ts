/**
 * The motivation gate (#199): a decisive act in a generated arc must have a reason the arc states.
 *
 * Panel batch 2026-09-29's character reviewer found the same top finding in all five stories: a
 * key decision made between scenes or with no visible reason. In `03`, Hettie trips the scour
 * right after the only two events before it argue against it; `ev_11` is `caused_by` both, so the
 * causal link exists and the motive does not. The judge already asks this question (#192's
 * unmotivated-actions criterion, `judge.ts`), but only after the fact, about a finished package.
 *
 * This asks it at generation time, of the events where it matters most — the final phase, where
 * the climax is, and any event whose summary or beats turn on a decision — and repairs in the same
 * call: for each unmotivated act, a beat that stages the reason on the page, just before it.
 * Nothing is inferred mechanically; the reason has to come from the arc's own people and events.
 */

import { z } from 'zod';

import { provisionalPackage } from '../authoring/lint-fabula';
import { eventsInOrder, type FabulaArc, type FabulaEvent } from '../schema/fabula';
import { blindArcView } from './judge';
import { isDecisionText } from './decision-text';
import { ARC_SYSTEM_INSTRUCTION, phaseEventCounts } from './prompt';
import type { GenerationCall } from './generator';
import type { ModelClient } from '../writer/model-client';

export { DECISION_PATTERN, isDecisionText } from './decision-text';

/**
 * The events the gate asks about: every event of the brief's last phase, plus any event whose
 * summary or beats turn on a decision. Phases are recovered by count, as `solutionEventIds` does.
 */
export function motivationCandidates(arc: FabulaArc, phaseShares: readonly number[]): FabulaEvent[] {
  const events = eventsInOrder(arc);
  const counts = phaseShares.length === 0 ? [] : phaseEventCounts(phaseShares, events.length);
  const finalCount = counts[counts.length - 1] ?? 0;
  const finalIds = new Set(events.slice(events.length - finalCount).map((event) => event.id));
  return events.filter(
    (event) =>
      finalIds.has(event.id) ||
      isDecisionText(event.summary) ||
      event.beats.some((beat) => isDecisionText(beat)),
  );
}

export const MotivationResponseSchema = z.object({
  unmotivated: z
    .array(
      z.object({
        event: z.string(),
        action: z.string().default(''),
        why_missing: z.string().default(''),
        motive_beat: z.string().default(''),
      }),
    )
    .default([]),
});

export type MotivationResponse = z.infer<typeof MotivationResponseSchema>;

export function motivationResponseJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      unmotivated: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            event: { type: 'string', description: 'The E-number, e.g. "E07".' },
            action: { type: 'string', description: 'Who does what.' },
            why_missing: { type: 'string', description: 'The reason the skeleton never gives.' },
            motive_beat: {
              type: 'string',
              description:
                'One beat, staged on the page just before the act, that gives this character a ' +
                'reason to do it now — built only from people, facts and events already in the arc.',
            },
          },
          required: ['event', 'action', 'why_missing', 'motive_beat'],
          propertyOrdering: ['event', 'action', 'why_missing', 'motive_beat'],
        },
      },
    },
    required: ['unmotivated'],
    propertyOrdering: ['unmotivated'],
  };
}

/** E-number of an event in the blind view, which labels events by position. */
function labelOf(arc: FabulaArc): Map<string, string> {
  return new Map(
    eventsInOrder(arc).map((event, index) => [`E${String(index + 1).padStart(2, '0')}`, event.id]),
  );
}

export function motivationPrompt(arc: FabulaArc, storyId: string, candidates: readonly FabulaEvent[]): string {
  const byId = new Map([...labelOf(arc)].map(([label, id]) => [id, label]));
  const asked = candidates.map((event) => byId.get(event.id)).filter((label) => label !== undefined);
  return [
    blindArcView(provisionalPackage(arc, storyId)),
    '',
    `DECISIVE ACTS. Look only at these events: ${asked.join(', ')}. In each, find the DELIBERATE`,
    'act a character commits that the story turns on — a choice, a confession, a betrayal, a',
    'reversal, a refusal. Ask: does the skeleton show, BEFORE the act, a reason for this character',
    'to do it NOW? Do not supply one yourself. If the events just before it argue against the act,',
    'or the reason only arrives afterwards, or you would have to guess, the act is unmotivated.',
    'Accidents and forces of nature are not acts. For each unmotivated act, write motive_beat: one',
    'beat to stage on the page just before the act that gives the reason — pressure, a discovery, a',
    'cost, a person — using only people, facts and events already in the skeleton. List none rather',
    'than pad the list.',
  ].join('\n');
}

export interface MotivationRepair {
  readonly arc: FabulaArc;
  /** One line per beat installed, for the run report. */
  readonly applied: string[];
}

/** Install each motive beat first among its event's beats, so the reason is staged before the act. */
export function applyMotiveBeats(arc: FabulaArc, response: MotivationResponse): MotivationRepair {
  const labels = labelOf(arc);
  const applied: string[] = [];
  const beatsFor = new Map<string, string[]>();
  for (const entry of response.unmotivated) {
    const id = labels.get(entry.event.trim().toUpperCase()) ?? (arc.events.some((e) => e.id === entry.event) ? entry.event : undefined);
    const beat = entry.motive_beat.trim();
    if (id === undefined || beat === '') continue;
    beatsFor.set(id, [...(beatsFor.get(id) ?? []), beat]);
    applied.push(`motivation: ${id} gained a motive beat for "${entry.action}"`);
  }
  if (beatsFor.size === 0) return { arc, applied };
  return {
    arc: {
      ...arc,
      events: arc.events.map((event) => {
        const beats = beatsFor.get(event.id);
        return beats === undefined ? event : { ...event, beats: [...beats, ...event.beats] };
      }),
    },
    applied,
  };
}

export interface MotivationGateResult extends MotivationRepair {
  /** Candidate events asked about. */
  readonly checked: number;
  /** Acts the answer found unmotivated. */
  readonly unmotivated: number;
  /** The call made, for the generation report; `null` when none was needed or it failed. */
  readonly call: GenerationCall | null;
}

/**
 * Ask about the candidates and install the motive beats, in one call. A failed call or an
 * unparseable answer leaves the arc exactly as it was — which is what it would have been without
 * the gate — rather than failing a generation that otherwise passed.
 */
export async function motivationGate(
  arc: FabulaArc,
  options: {
    readonly storyId: string;
    readonly phaseShares: readonly number[];
    readonly client: ModelClient;
    readonly model: string;
  },
): Promise<MotivationGateResult> {
  const unchanged = { arc, applied: [], checked: 0, unmotivated: 0, call: null };
  const candidates = motivationCandidates(arc, options.phaseShares);
  if (candidates.length === 0) return unchanged;

  const startedAt = Date.now();
  const response = await options.client
    .generate({
      model: options.model,
      systemInstruction: ARC_SYSTEM_INSTRUCTION,
      contents: motivationPrompt(arc, options.storyId, candidates),
      responseJsonSchema: motivationResponseJsonSchema(),
      maxOutputTokens: MOTIVATION_MAX_OUTPUT_TOKENS,
      thinkingLevel: 'MEDIUM',
    })
    .catch(() => null);
  if (response === null) return { ...unchanged, checked: candidates.length };

  const call: GenerationCall = {
    stage: 'motivation',
    model: response.model,
    finish_reason: response.finish_reason,
    prompt_tokens: response.usage.prompt_tokens,
    output_tokens: response.usage.output_tokens,
    thoughts_tokens: response.usage.thoughts_tokens,
    ms: Date.now() - startedAt,
  };
  let parsed: MotivationResponse | null = null;
  if (response.finish_reason === 'STOP') {
    try {
      const text = response.text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
      const result = MotivationResponseSchema.safeParse(JSON.parse(text));
      if (result.success) parsed = result.data;
    } catch {
      parsed = null;
    }
  }
  if (parsed === null) return { ...unchanged, checked: candidates.length, call };

  const repaired = applyMotiveBeats(arc, parsed);
  return {
    ...repaired,
    checked: candidates.length,
    unmotivated: parsed.unmotivated.length,
    call,
  };
}

export const MOTIVATION_MAX_OUTPUT_TOKENS = 4_000;
