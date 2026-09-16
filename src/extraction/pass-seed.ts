/**
 * Pass 5 — the World Model **seed**: state at the story's start, not at its end.
 *
 * This pass exists as a pass, rather than as a field on pass 1, because of the one number in
 * `docs/research/narrative-extraction-prior-art.md` §2.4 that most directly threatens this
 * deliverable: TimeChara puts GPT-4o at 64.5% average spatiotemporal consistency when asked to
 * hold a character at a point in the narrative, and at **46.0% on future-context** — worst
 * precisely at refusing knowledge that does not yet apply. The World Model seed is "ground truth
 * at the current moment" with the moment fixed at *before scene 1* (ADR 0001), and a source text
 * states most attributes long after that. Rubric §3.2 names the resulting failure explicitly and
 * asks for it to be counted on its own line as **seed-time attribute error count**, rather than
 * folded into the contradiction rate.
 *
 * Three things follow, and all three are in the prompt below:
 *
 * 1. The pass is shown the story's **opening window** as prose and the **chronologically
 *    earliest events** as structure. It is not shown the rest of the book, so a late-story value
 *    is not there to be copied.
 * 2. `null` is the required answer for anything the opening does not establish. A seed column
 *    guessed from later in the book is the exact defect being measured.
 * 3. Every non-null value carries a verbatim quote, so the seed is span-grounded like everything
 *    else — and so a seed-time error is legible to a human as "that quote is from Stave IV".
 *
 * The `bag` is open by design (`CONTEXT.md`, The two memories: "fixed core columns plus an open
 * key-value bag for author-invented attributes"), and Principle 4 keeps its values flat scalars.
 * `fixtures/authoring-notes.md` §5 is the reason the prompt asks for restraint rather than
 * richness: deciding what *not* to model was real authoring effort, and an extractor that fills
 * every bag it can invent is producing work for the author to delete.
 */

import { z } from 'zod';

import type { ExtractionModel } from './call';
import { ExtractionCallError } from './call';
import type { CanonicalEntity } from './pass-reconcile';
import type { ExtractedEvent } from './pass-events';

export const SeedRowSchema = z.object({
  id: z.string().min(1),
  location_id: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  goal: z.string().nullable().default(null),
  bag: z
    .array(
      z.object({
        key: z.string().min(1),
        value: z.string(),
      }),
    )
    .default([]),
  quote: z.string().default(''),
});

export const SeedResponseSchema = z.object({
  rows: z.array(SeedRowSchema).default([]),
});

export type SeedRow = z.infer<typeof SeedRowSchema>;

const SYSTEM = `You state each entity's condition AT THE MOMENT THE STORY OPENS — before its first
event happens.

This is the hardest instruction in this pipeline and the one most often got wrong, so read it
twice: you are NOT summarising what is true of this entity across the story. You are stating what
is true of it on the story's first page.

- If the opening does not establish a value, answer null. null is the correct, expected answer for
  most fields. A value taken from later in the story is the specific error being measured here.
- location_id: where the entity is when the story opens, as an entity id from the roster, or null.
  An entity not yet present, not yet created, or nowhere in particular is null.
- status: a short word for physical condition at the opening — "alive", "dead", "whole",
  "not_yet_created". Not a mood, not a role.
- goal: what this character is pursuing at the opening, in a short phrase, or null. Most
  characters have none stated.
- bag: at most three author-style extra attributes that the opening genuinely establishes and
  that no core column holds — an epithet, a role, a temperament. Flat string values only. Prefer
  fewer. Leave it empty rather than inventing structure.
- quote: one short VERBATIM span from the opening excerpt supporting this row, copied
  character-for-character. Empty only if every field is null.`;

function jsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'An id from the roster, verbatim.' },
            location_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            status: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            goal: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            bag: {
              type: 'array',
              maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string', description: 'lower_snake_case.' },
                  value: { type: 'string' },
                },
                required: ['key', 'value'],
                propertyOrdering: ['key', 'value'],
              },
            },
            quote: { type: 'string', description: 'Verbatim from the opening excerpt.' },
          },
          required: ['id', 'location_id', 'status', 'goal', 'bag', 'quote'],
          propertyOrdering: ['id', 'location_id', 'status', 'goal', 'bag', 'quote'],
        },
      },
    },
    required: ['rows'],
  };
}

/** How many of the chronologically earliest events the seed pass is shown. */
export const SEED_EVENT_HORIZON = 12;

export async function extractSeedState(
  model: ExtractionModel,
  entities: readonly CanonicalEntity[],
  openingText: string,
  earliestEvents: readonly ExtractedEvent[],
  options: { batchSize?: number } = {},
): Promise<{ rows: SeedRow[]; failed_batches: number }> {
  const batchSize = options.batchSize ?? 12;
  const rows: SeedRow[] = [];
  let failed = 0;

  const known = new Set(entities.map((entity) => entity.id));
  const earliest = earliestEvents
    .slice(0, SEED_EVENT_HORIZON)
    .map((event, index) => `${index + 1}. ${event.summary}`)
    .join('\n');

  for (let start = 0; start < entities.length; start += batchSize) {
    const batch = entities.slice(start, start + batchSize);
    const listing = batch
      .map(
        (entity) =>
          `${entity.id} [${entity.kind}] = ${entity.name}${entity.note === '' ? '' : ` — ${entity.note}`}`,
      )
      .join('\n');

    const contents = [
      'THE STORY\'S OPENING, VERBATIM:',
      '"""',
      openingText,
      '"""',
      '',
      'THE STORY\'S EARLIEST EVENTS, IN THE ORDER THEY HAPPEN:',
      earliest === '' ? '(none extracted)' : earliest,
      '',
      'FULL ENTITY ROSTER (for resolving location ids):',
      entities.map((entity) => `${entity.id} [${entity.kind}] = ${entity.name}`).join('\n'),
      '',
      'STATE THE OPENING CONDITION OF THESE ENTITIES ONLY:',
      listing,
    ].join('\n');

    try {
      const response = await model.json(SeedResponseSchema, {
        pass: 'seed',
        label: `entities ${start}–${start + batch.length - 1}`,
        systemInstruction: SYSTEM,
        contents,
        responseJsonSchema: jsonSchema(),
        maxOutputTokens: 6144,
        thinkingLevel: 'MEDIUM',
      });
      const allowed = new Set(batch.map((entity) => entity.id));
      for (const row of response.rows) {
        if (!allowed.has(row.id)) continue;
        rows.push({
          ...row,
          location_id:
            row.location_id !== null && known.has(row.location_id) ? row.location_id : null,
        });
      }
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      failed += 1;
    }
  }

  return { rows, failed_batches: failed };
}
