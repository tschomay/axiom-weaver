/**
 * The writer's output schema (ADR 0012 decision 1).
 *
 * `prose -> scene_digest -> state_updates -> diagnostics`, pinned with `propertyOrdering`.
 * `prose` is first for a load-bearing reason: it is what streams to the reader, and a reader who
 * has to wait for the digest to be written before seeing a word is a reader watching a blank page
 * (Gemini research §1/§3).
 *
 * Expressed as `responseJsonSchema` with `$defs`/`$ref` rather than the deprecated
 * `responseSchema` OpenAPI subset — the digest reuses shapes across several fields, and only the
 * JSON Schema dialect honours `$defs`. Two constraints from the discovery document bound what can
 * be written here: a `$ref` sub-schema may carry no sibling properties except `$`-prefixed ones,
 * and cyclic references may only appear in non-required properties (there are none here).
 *
 * The schema is billed as input on every single call and is **not cacheable** (research finding
 * #4), so every field earns its place the same way ADR 0003's digest fields did. It is
 * deliberately lean, and nothing decorative belongs in it.
 */

import { z } from 'zod';
import { REANCHOR_BANDS, SceneDigestSchema } from '../digest/scene-digest';
import { ANCHOR_TEXT_CHARS, IMAGERY_SIGNATURE_CAP, TWO_SENTENCE_CHARS } from '../digest/scene-digest';

/**
 * The only two diagnostics the *writer* self-reports (ADR 0012 decision 1).
 *
 * Everything else in the taxonomy is the compiler grading the writer's other outputs after the
 * call returns. Giving those a schema field would pay schema-token cost on every call for
 * something a self-report cannot make more reliable.
 */
export const WRITER_DIAGNOSTIC_TYPES = ['beat_unsatisfied', 'missing_fact'] as const;
export type WriterDiagnosticType = (typeof WRITER_DIAGNOSTIC_TYPES)[number];

export const WriterDiagnosticSchema = z.object({
  type: z.enum(WRITER_DIAGNOSTIC_TYPES),
  detail: z.string(),
});

/**
 * `state_updates`: the writer proposes values only, never a tier.
 *
 * Tier is looked up from the column name at validation time (ADR 0001/0005), so asking the writer
 * to reason about it would be redundant schema weight — and a tier the writer guessed wrong would
 * have to be overridden anyway.
 */
export const WriterStateUpdatesSchema = z.object({
  updates: z
    .array(
      z.object({
        entity_id: z.string().min(1),
        column: z.string().min(1),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      }),
    )
    .default([]),
  new_relationships: z
    .array(
      z.object({
        from_id: z.string().min(1),
        to_id: z.string().min(1),
        kind: z.string().min(1),
        sentiment: z.string().nullable().default(null),
      }),
    )
    .default([]),
  new_character_knowledge: z
    .array(
      z.object({
        character_id: z.string().min(1),
        fact_ref: z.string().min(1),
      }),
    )
    .default([]),
});

export const WriterResponseSchema = z.object({
  prose: z.string(),
  scene_digest: SceneDigestSchema,
  state_updates: WriterStateUpdatesSchema.default({
    updates: [],
    new_relationships: [],
    new_character_knowledge: [],
  }),
  diagnostics: z.array(WriterDiagnosticSchema).default([]),
});

export type WriterStateUpdates = z.infer<typeof WriterStateUpdatesSchema>;
export type WriterDiagnostic = z.infer<typeof WriterDiagnosticSchema>;
export type WriterResponse = z.infer<typeof WriterResponseSchema>;

/** The field order, in one place. The wire schema and the contract prose both read it. */
export const RESPONSE_PROPERTY_ORDER = [
  'prose',
  'scene_digest',
  'state_updates',
  'diagnostics',
] as const;

/**
 * The wire schema handed to `responseJsonSchema`.
 *
 * Kept as a plain object literal rather than generated from the Zod schemas: the two dialects
 * disagree about enough (`propertyOrdering` is non-standard, `additionalProperties` behaviour
 * differs, and the API rejects complexity the Zod schema is happy with) that a generator would be
 * a second thing to get wrong. The Zod schemas above validate what comes *back*, which is the
 * client-side validation Google's own guidance calls mandatory.
 */
export function writerResponseJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    $defs: {
      factRef: {
        type: 'string',
        description:
          'A fact_ref slug, copied verbatim from the Scene Card wherever one is given (the ' +
          'reader-must-learn list, must-stay-hidden, and the plant and payoff instructions, ' +
          'which open with the slug). For a fact the card did not name, coin a short ' +
          'lower_snake_case slug. Never a sentence.',
      },
      entityRef: {
        type: 'string',
        description:
          'A World Model entity id exactly as it appears in the payload (char_…, loc_…, obj_…) ' +
          '— never a display name.',
      },
      imagerySignature: {
        type: 'object',
        properties: {
          image: {
            type: 'string',
            description: 'The concrete image as it appears in the prose, not the domain label.',
          },
          domain: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description:
              'The Voice Card imagery domain this image was drawn from, copied verbatim from ' +
              'that list, or null for an image outside it. The domain is the category; the ' +
              'image is the concrete phrasing you actually wrote — they are never the same text.',
          },
        },
        required: ['image', 'domain'],
        propertyOrdering: ['image', 'domain'],
      },
      sceneDigest: {
        type: 'object',
        properties: {
          event_summary: {
            type: 'string',
            maxLength: TWO_SENTENCE_CHARS,
            description: 'At most two sentences.',
          },
          entities_on_stage: { type: 'array', items: { $ref: '#/$defs/entityRef' } },
          facts_revealed: { type: 'array', items: { $ref: '#/$defs/factRef' } },
          plants_opened: { type: 'array', items: { $ref: '#/$defs/factRef' } },
          payoffs_closed: { type: 'array', items: { $ref: '#/$defs/factRef' } },
          imagery_signature: {
            type: 'array',
            maxItems: IMAGERY_SIGNATURE_CAP,
            items: { $ref: '#/$defs/imagerySignature' },
          },
          closing_situation: {
            type: 'string',
            maxLength: TWO_SENTENCE_CHARS,
            description:
              'Where the scene leaves things, physically and emotionally. At most two sentences.',
          },
          reanchor_used: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                entity_id: { $ref: '#/$defs/entityRef' },
                band: { type: 'string', enum: [...REANCHOR_BANDS] },
                anchor_text: {
                  anyOf: [{ type: 'string', maxLength: ANCHOR_TEXT_CHARS }, { type: 'null' }],
                  description:
                    'The distinguishing clause you actually wrote to place this entity — copied ' +
                    'from the prose, not paraphrased. null if band is "assume" (nothing was ' +
                    'written to anchor it).',
                },
              },
              required: ['entity_id', 'band', 'anchor_text'],
              propertyOrdering: ['entity_id', 'band', 'anchor_text'],
            },
          },
          grounded_claims: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                entity_id: { $ref: '#/$defs/entityRef' },
                column: {
                  type: 'string',
                  description: 'A World Model column name, exactly as it appears in the payload.',
                },
                asserted_value: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'boolean' },
                    { type: 'null' },
                  ],
                  description: 'The value the prose asserts for this column, as of scene close.',
                },
              },
              required: ['entity_id', 'column', 'asserted_value'],
              propertyOrdering: ['entity_id', 'column', 'asserted_value'],
            },
            description:
              'Physical/epistemic-tier facts the prose states or implies about entities present ' +
              'in the scene that the World Model already tracks — only ones the prose actually ' +
              'touches, not a restatement of everything you know. Leave empty if the prose makes ' +
              'no such claims.',
          },
        },
        required: [
          'event_summary',
          'entities_on_stage',
          'facts_revealed',
          'plants_opened',
          'payoffs_closed',
          'imagery_signature',
          'closing_situation',
          'reanchor_used',
          'grounded_claims',
        ],
        propertyOrdering: [
          'event_summary',
          'entities_on_stage',
          'facts_revealed',
          'plants_opened',
          'payoffs_closed',
          'imagery_signature',
          'closing_situation',
          'reanchor_used',
          'grounded_claims',
        ],
      },
      stateUpdates: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                entity_id: { $ref: '#/$defs/entityRef' },
                column: { type: 'string' },
                value: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'boolean' },
                    { type: 'null' },
                  ],
                },
              },
              required: ['entity_id', 'column', 'value'],
              propertyOrdering: ['entity_id', 'column', 'value'],
            },
          },
          new_relationships: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from_id: { $ref: '#/$defs/entityRef' },
                to_id: { $ref: '#/$defs/entityRef' },
                kind: { type: 'string' },
                sentiment: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
              required: ['from_id', 'to_id', 'kind', 'sentiment'],
              propertyOrdering: ['from_id', 'to_id', 'kind', 'sentiment'],
            },
          },
          new_character_knowledge: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                character_id: { $ref: '#/$defs/entityRef' },
                fact_ref: { $ref: '#/$defs/factRef' },
              },
              required: ['character_id', 'fact_ref'],
              propertyOrdering: ['character_id', 'fact_ref'],
            },
          },
        },
        required: ['updates', 'new_relationships', 'new_character_knowledge'],
        propertyOrdering: ['updates', 'new_relationships', 'new_character_knowledge'],
      },
    },
    properties: {
      prose: { type: 'string', description: 'The scene, performed. Written first, and streamed.' },
      scene_digest: { $ref: '#/$defs/sceneDigest' },
      state_updates: { $ref: '#/$defs/stateUpdates' },
      diagnostics: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...WRITER_DIAGNOSTIC_TYPES] },
            detail: { type: 'string' },
          },
          required: ['type', 'detail'],
          propertyOrdering: ['type', 'detail'],
        },
      },
    },
    required: [...RESPONSE_PROPERTY_ORDER],
    propertyOrdering: [...RESPONSE_PROPERTY_ORDER],
  };
}

/**
 * The narrowed schema for the digest-only fallback call (ADR 0012 decision 5).
 *
 * `diagnostics` is dropped: the writer never finished the call those diagnostics would have come
 * from, so asking a second, cheaper model to invent them would be fabricating a self-report. The
 * compiler injects its own `truncated_scene` entry instead.
 */
export function fallbackResponseJsonSchema(): Record<string, unknown> {
  const full = writerResponseJsonSchema();
  return {
    type: 'object',
    $defs: full['$defs'],
    properties: {
      scene_digest: { $ref: '#/$defs/sceneDigest' },
      state_updates: { $ref: '#/$defs/stateUpdates' },
    },
    required: ['scene_digest', 'state_updates'],
    propertyOrdering: ['scene_digest', 'state_updates'],
  };
}

export const FallbackResponseSchema = z.object({
  scene_digest: SceneDigestSchema,
  state_updates: WriterStateUpdatesSchema,
});

export type FallbackResponse = z.infer<typeof FallbackResponseSchema>;
