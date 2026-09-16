/**
 * Pass 3 — the Fabula event list, per window, with a source span and a story-time bucket on
 * every event.
 *
 * `docs/research/narrative-extraction-prior-art.md` §10: *"pass 2 — a chronological event list
 * with per-event source spans, which is where the seed splits from the change list so the World
 * Model is never flattened to an end-state"*. That split is the reason `state_updates` is
 * extracted here and the seed is extracted separately: §2.4 records that a novel hands you a
 * sequence of assertions, most of them true only for a stretch, and TimeChara measures GPT-4o at
 * 64.5% when asked to hold a character at a point in the narrative. An event list plus a seed is
 * the only shape that survives that; a flat World Model does not.
 *
 * `story_time` exists because the Fabula is chronological and the Syuzhet is not — the *Carol*
 * is almost entirely flashback and conditional flash-forward, which is exactly the structure
 * rubric §3.3 says is worth testing. Bucketing here, in the window that read the prose, is far
 * cheaper and far more reliable than asking a later global pass to infer it from summaries.
 */

import { z } from 'zod';

import type { ExtractionModel } from './call';
import { ExtractionCallError } from './call';
import type { CanonicalEntity } from './pass-reconcile';
import type { ReadingWindow } from './windows';

export const STORY_TIMES = ['past', 'present', 'future'] as const;
export type StoryTime = (typeof STORY_TIMES)[number];

export const StateUpdateProposalSchema = z.object({
  entity_id: z.string().min(1),
  column: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  quote: z.string().default(''),
});

export const EventProposalSchema = z.object({
  summary: z.string().min(1),
  quote: z.string().default(''),
  story_time: z.enum(STORY_TIMES),
  time_anchor: z.string().default(''),
  participants: z.array(z.string()).default([]),
  location_id: z.string().nullable().default(null),
  state_updates: z.array(StateUpdateProposalSchema).default([]),
});

export const EventPassResponseSchema = z.object({
  events: z.array(EventProposalSchema).default([]),
});

export type EventProposal = z.infer<typeof EventProposalSchema>;
export type StateUpdateProposal = z.infer<typeof StateUpdateProposalSchema>;

export interface ExtractedEvent extends EventProposal {
  readonly id: string;
  readonly window: number;
  /** Position in the order the story *narrates* events — the Syuzhet index. */
  readonly narrated_index: number;
}

export interface EventPassResult {
  readonly events: ExtractedEvent[];
  readonly failed_windows: number[];
  /** `state_updates` naming an entity id the seed does not carry. Dropped, and counted. */
  readonly dropped_state_updates: number;
  /**
   * Participants that named an object or a location rather than a character. Dropped, and
   * counted, because `characters_present` is characters-only and the cross-reference pass says
   * so with `wrong_entity_table`.
   *
   * This was measured, not anticipated: the first run whose events were linted through #119's
   * provisional projection produced 25 of these on Cinderella alone — the pumpkin, the wand, the
   * rat-trap and the garden all listed as participants in the transformation scene. The model is
   * not wrong that they are *involved*; it is answering a question the schema does not ask, and
   * their involvement is already carried by `state_updates` and `location_id`.
   */
  readonly dropped_participants: number;
}

const SYSTEM = `You extract the Fabula event list from one window of a story's prose.

An event is one thing that HAPPENS or CHANGES: an action, an arrival, a decision made aloud, a
death, a transformation, a promise. Not a description, not a mood, not a standing fact.

You are reading an excerpt, not the whole story. Extract only events this excerpt narrates.
Never add an event you know from the story but cannot see here.

For each event:
- summary: one sentence, concrete, naming who does what.
- quote: a short VERBATIM span copied character-for-character out of the excerpt. Under 25 words.
  Copy it; do not retype it from memory. An event whose quote is not really in the excerpt is
  worse than a missing event.
- story_time: WHEN THE EVENT ITSELF HAPPENS, not when the story tells you about it.
  * "past" — it happened before the story's opening situation (a memory, a flashback, backstory
    stated in passing).
  * "present" — it happens in the story's own running present.
  * "future" — it has not happened yet at the story's present: a vision, a prophecy, a
    conditional or foretold future.
  A scene in which a character is SHOWN a memory contains both: the showing is "present", the
  remembered happening is "past". Extract the remembered happening as its own "past" event.
- time_anchor: the story's own words for when it happens ("seven years ago tonight", "Christmas
  morning", "some time hence"), or "" if the excerpt gives none.
- participants: the CHARACTERS who act or are acted on, as char_ ids from the roster, or [].
  Characters only — never an object and never a place, however central it is to the event. A
  pumpkin that becomes a coach is not a participant; record that as a state_update.
- location_id: the loc_ id where it happens, or null. Never a character, never an object.
- state_updates: World Model column writes this event makes. Use only these columns:
  location_id, status, goal, name. Value must be an entity id for location_id, otherwise a short
  string. Each carries its own verbatim quote. Omit anything the excerpt does not actually
  assert — a guessed state change is worse than none.`;

function jsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'One concrete sentence.' },
            quote: { type: 'string', description: 'Verbatim from the excerpt. Under 25 words.' },
            story_time: { type: 'string', enum: [...STORY_TIMES] },
            time_anchor: { type: 'string' },
            participants: { type: 'array', items: { type: 'string' } },
            location_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            state_updates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  entity_id: { type: 'string' },
                  column: { type: 'string', enum: ['location_id', 'status', 'goal', 'name'] },
                  value: {
                    anyOf: [
                      { type: 'string' },
                      { type: 'number' },
                      { type: 'boolean' },
                      { type: 'null' },
                    ],
                  },
                  quote: { type: 'string', description: 'Verbatim from the excerpt.' },
                },
                required: ['entity_id', 'column', 'value', 'quote'],
                propertyOrdering: ['entity_id', 'column', 'value', 'quote'],
              },
            },
          },
          required: [
            'summary',
            'quote',
            'story_time',
            'time_anchor',
            'participants',
            'location_id',
            'state_updates',
          ],
          propertyOrdering: [
            'summary',
            'quote',
            'story_time',
            'time_anchor',
            'participants',
            'location_id',
            'state_updates',
          ],
        },
      },
    },
    required: ['events'],
  };
}

function roster(entities: readonly CanonicalEntity[]): string {
  return entities
    .map(
      (entity) =>
        `${entity.id} [${entity.kind}] = ${entity.name}${entity.aliases.length > 0 ? ` (${entity.aliases.join(', ')})` : ''}`,
    )
    .join('\n');
}

/**
 * Which of the four offered columns actually exist on the entity's own table.
 *
 * `src/schema/tiers.ts` is the authority, and the cross-reference pass rejects anything else with
 * `unknown_column`. Catching it here rather than letting it reach the linter is the one case
 * where this pipeline pre-empts a check it also runs: an `object.goal` is not an interesting
 * finding about the source, it is the model answering a question the schema does not ask.
 */
const COLUMNS_BY_KIND: Record<string, ReadonlySet<string>> = {
  character: new Set(['location_id', 'status', 'goal', 'name']),
  location: new Set(['name']),
  object: new Set(['location_id', 'status', 'name']),
};

export async function extractEvents(
  model: ExtractionModel,
  windows: readonly ReadingWindow[],
  entities: readonly CanonicalEntity[],
): Promise<EventPassResult> {
  const known = new Set(entities.map((entity) => entity.id));
  const kindOf = new Map(entities.map((entity) => [entity.id, entity.kind as string]));
  const events: ExtractedEvent[] = [];
  const failed: number[] = [];
  let dropped = 0;
  let droppedParticipants = 0;
  let narrated = 0;

  const entityBlock = `ENTITY ROSTER (use these ids, never a name):\n${roster(entities)}`;

  for (const window of windows) {
    let response: z.infer<typeof EventPassResponseSchema>;
    try {
      response = await model.json(EventPassResponseSchema, {
        pass: 'events',
        label: `window ${window.index}`,
        systemInstruction: SYSTEM,
        contents: `${entityBlock}\n\nEXCERPT (window ${window.index + 1} of ${windows.length}):\n"""\n${window.text}\n"""`,
        responseJsonSchema: jsonSchema(),
        maxOutputTokens: 8192,
      });
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      failed.push(window.index);
      continue;
    }

    for (const event of response.events) {
      const updates = event.state_updates.filter((update) => {
        const kind = kindOf.get(update.entity_id);
        const ok =
          kind !== undefined &&
          (COLUMNS_BY_KIND[kind]?.has(update.column) ?? false) &&
          (update.column !== 'location_id' ||
            update.value === null ||
            (typeof update.value === 'string' && known.has(update.value)));
        if (!ok) dropped += 1;
        return ok;
      });
      const participants = event.participants.filter((id) => {
        const ok = kindOf.get(id) === 'character';
        if (!ok) droppedParticipants += 1;
        return ok;
      });

      events.push({
        ...event,
        participants,
        location_id:
          event.location_id !== null && kindOf.get(event.location_id) === 'location'
            ? event.location_id
            : null,
        state_updates: updates,
        id: `ev_${String(events.length + 1).padStart(4, '0')}`,
        window: window.index,
        narrated_index: narrated++,
      });
    }
  }

  return {
    events,
    failed_windows: failed,
    dropped_state_updates: dropped,
    dropped_participants: droppedParticipants,
  };
}

/**
 * Drop events an overlapping window extracted twice.
 *
 * Windows overlap by a paragraph on purpose (`windows.ts`), so the seam is read twice and the
 * same happening arrives as two events. Matched on the resolved span rather than on the summary:
 * two calls phrase a summary differently but quote the same sentence, and a span is the one part
 * of an event that is the source's text rather than the model's.
 */
export function dedupeBySpan<T extends { id: string; summary: string }>(
  events: readonly T[],
  spanOf: (event: T) => { start: number; end: number } | null,
): { kept: T[]; removed: T[] } {
  const seen = new Map<string, T>();
  const kept: T[] = [];
  const removed: T[] = [];
  for (const event of events) {
    const span = spanOf(event);
    if (span === null) {
      kept.push(event);
      continue;
    }
    const key = `${span.start}:${span.end}`;
    const previous = seen.get(key);
    if (previous === undefined) {
      seen.set(key, event);
      kept.push(event);
      continue;
    }
    removed.push(event);
  }
  return { kept, removed };
}
