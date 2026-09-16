/**
 * Pass 1 — World Model rows over bounded windows, with a gleaning re-ask.
 *
 * `docs/research/narrative-extraction-prior-art.md` §10's first pass, minus BookNLP (a Python
 * dependency this prototype does not need to learn its own failure modes). §7 is why the re-ask
 * exists at all: GraphRAG ships `CONTINUE_PROMPT` — *"MANY entities and relationships were missed
 * in the last extraction"* — and runs it up to `max_gleanings` times, because a single call
 * under-extracts. That is a **recall** fix and nothing else; precision is the reconcile pass's
 * problem (§7 again: the two optimise opposite errors, so they are separate passes).
 *
 * What this pass deliberately does *not* do:
 *
 * - **It does not assign ids.** A slug minted per window would collide across windows and, worse,
 *   would fix an identity decision before anything has seen the whole cast. ADR 0001's slug
 *   identity is unrecoverable once wrong (§2.2), so id assignment waits for reconcile.
 * - **It does not state attributes.** A window in the middle of the book knows Scrooge's
 *   `location_id` *there*, which is exactly the seed-time error §2.4 predicts. Seed state is its
 *   own pass, over the opening of the story.
 */

import { z } from 'zod';

import type { ExtractionModel } from './call';
import { ExtractionCallError } from './call';
import type { ReadingWindow } from './windows';

export const ENTITY_KINDS = ['character', 'location', 'object'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const EntityProposalSchema = z.object({
  kind: z.enum(ENTITY_KINDS),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  note: z.string().default(''),
  quote: z.string().default(''),
});

export const RelationshipProposalSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.string().min(1),
  sentiment: z.string().nullable().default(null),
  quote: z.string().default(''),
});

export const EntityPassResponseSchema = z.object({
  entities: z.array(EntityProposalSchema).default([]),
  relationships: z.array(RelationshipProposalSchema).default([]),
});

export type EntityProposal = z.infer<typeof EntityProposalSchema> & { window: number };
export type RelationshipProposal = z.infer<typeof RelationshipProposalSchema> & { window: number };

export interface EntityPassResult {
  readonly entities: EntityProposal[];
  readonly relationships: RelationshipProposal[];
  /** Windows whose call failed outright — a recall hole, reported rather than hidden. */
  readonly failed_windows: number[];
  readonly gleaned_entities: number;
  readonly gleaned_relationships: number;
}

const SYSTEM = `You extract World Model rows from one window of a story's prose.

You are reading an excerpt, not the whole story. Report only what THIS excerpt shows or states.
Never fill in what you know about the story from elsewhere — if the excerpt does not say it, it
does not go in your answer.

Rules:
- characters: any person, ghost, spirit or animal that acts or is addressed. A group acting as one
  ("the two portly gentlemen", "the miners") is one row; say so in the note.
- locations: places where something happens or that are named as settings.
- objects: physical things that matter to the story — something possessed, given, lost, broken,
  transformed or looked at. Not scenery nouns.
- relationships: a standing connection between two named entities (kinship, employment,
  ownership, betrothal, partnership). Not a one-off action.
- Use the name the excerpt uses. Put other forms in aliases.
- Every row carries \`quote\`: a short VERBATIM span copied character-for-character out of the
  excerpt that shows this entity or relationship. Copy it; do not retype it from memory. Keep it
  under 25 words. A row whose quote is not really in the excerpt is worse than a missing row.`;

function jsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...ENTITY_KINDS] },
            name: { type: 'string', description: 'As the excerpt names it.' },
            aliases: { type: 'array', items: { type: 'string' } },
            note: { type: 'string', description: 'One short line: who or what this is, here.' },
            quote: { type: 'string', description: 'Verbatim from the excerpt. Under 25 words.' },
          },
          required: ['kind', 'name', 'aliases', 'note', 'quote'],
          propertyOrdering: ['kind', 'name', 'aliases', 'note', 'quote'],
        },
      },
      relationships: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'An entity name from your entities list.' },
            to: { type: 'string', description: 'An entity name from your entities list.' },
            kind: {
              type: 'string',
              description: 'lower_snake_case, read from the subject: father_of, employer_of.',
            },
            sentiment: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            quote: { type: 'string', description: 'Verbatim from the excerpt. Under 25 words.' },
          },
          required: ['from', 'to', 'kind', 'sentiment', 'quote'],
          propertyOrdering: ['from', 'to', 'kind', 'sentiment', 'quote'],
        },
      },
    },
    required: ['entities', 'relationships'],
    propertyOrdering: ['entities', 'relationships'],
  };
}

/** GraphRAG's `CONTINUE_PROMPT`, re-aimed at this schema. §7 quotes the original verbatim. */
function gleaningPrompt(window: ReadingWindow, found: readonly string[]): string {
  return [
    `EXCERPT (window ${window.index + 1}):`,
    '"""',
    window.text,
    '"""',
    '',
    'A previous extraction over this same excerpt found:',
    found.length === 0 ? '(nothing)' : found.map((name) => `- ${name}`).join('\n'),
    '',
    'MANY entities and relationships were missed in the last extraction. Add the ones that were',
    'missed, in the same format. Do not repeat anything already listed above. If nothing was',
    'missed, return empty arrays.',
  ].join('\n');
}

export async function extractEntities(
  model: ExtractionModel,
  windows: readonly ReadingWindow[],
  options: { maxGleanings?: number } = {},
): Promise<EntityPassResult> {
  const maxGleanings = options.maxGleanings ?? 1;
  const entities: EntityProposal[] = [];
  const relationships: RelationshipProposal[] = [];
  const failed: number[] = [];
  let gleanedEntities = 0;
  let gleanedRelationships = 0;

  for (const window of windows) {
    let windowEntities: EntityProposal[] = [];
    let windowRelationships: RelationshipProposal[] = [];

    try {
      const first = await model.json(EntityPassResponseSchema, {
        pass: 'entities',
        label: `window ${window.index}`,
        systemInstruction: SYSTEM,
        contents: `EXCERPT (window ${window.index + 1} of ${windows.length}):\n"""\n${window.text}\n"""`,
        responseJsonSchema: jsonSchema(),
        maxOutputTokens: 4096,
      });
      windowEntities = first.entities.map((entity) => ({ ...entity, window: window.index }));
      windowRelationships = first.relationships.map((edge) => ({ ...edge, window: window.index }));
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      failed.push(window.index);
      continue;
    }

    for (let round = 0; round < maxGleanings; round += 1) {
      const found = [
        ...windowEntities.map((entity) => `${entity.kind}: ${entity.name}`),
        ...windowRelationships.map((edge) => `${edge.from} ${edge.kind} ${edge.to}`),
      ];
      try {
        const more = await model.json(EntityPassResponseSchema, {
          pass: 'entities.gleaning',
          label: `window ${window.index} round ${round + 1}`,
          systemInstruction: SYSTEM,
          contents: gleaningPrompt(window, found),
          responseJsonSchema: jsonSchema(),
          maxOutputTokens: 3072,
        });
        if (more.entities.length === 0 && more.relationships.length === 0) break;
        gleanedEntities += more.entities.length;
        gleanedRelationships += more.relationships.length;
        windowEntities.push(
          ...more.entities.map((entity) => ({ ...entity, window: window.index })),
        );
        windowRelationships.push(
          ...more.relationships.map((edge) => ({ ...edge, window: window.index })),
        );
      } catch (error) {
        // A failed gleaning is a smaller loss than a failed first pass: the window still
        // contributed. Record nothing beyond the call log and move on.
        if (!(error instanceof ExtractionCallError)) throw error;
        break;
      }
    }

    entities.push(...windowEntities);
    relationships.push(...windowRelationships);
  }

  return {
    entities,
    relationships,
    failed_windows: failed,
    gleaned_entities: gleanedEntities,
    gleaned_relationships: gleanedRelationships,
  };
}
