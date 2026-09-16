/**
 * The judged half of `docs/agents/story-authoring-eval.md` §4.2, and §4.3's calibration.
 *
 * Four rules from the rubric's judge protocol, all of them structural here rather than
 * aspirational:
 *
 * - **Judge the package, never compiled prose.** Nothing in this module can reach the compiler.
 * - **`WRITER_MODEL`, never the lite model.** The caller passes the model and the result records
 *   it; `scripts/score-arc.ts` refuses the lite model outright.
 * - **Blind to provenance.** One renderer produces the view, fed either by a fixture's Scene Cards
 *   or by a generated arc's provisional projection, and it relabels ids to `E01…` and drops the
 *   title so the two are not distinguishable by shape. The honest limit, stated rather than hidden:
 *   a judge may still *recognise* Cinderella or the *Carol* from their content, and recognition
 *   inflates. That is the direction that makes §4.3 useful — a judge that cannot clear its bars on
 *   material it may well recognise is decisively miscalibrated.
 * - **Per-criterion scores, never a mean.** `JudgeScore` has no composite field, on purpose.
 *
 * The 1–5 scales are **anchored**, cribbing the one published protocol that judges a plan rather
 * than prose (`llm-arc-generation-prior-art.md` §5, arXiv:2608.26177). An unanchored 1–5 from an
 * LLM judge is a vibe with a number on it.
 */

import { z } from 'zod';

import { scenesInOrder, type StoryPackage } from '../schema/story-package';
import type { ModelClient } from '../writer/model-client';

export const CAUSAL_VERDICTS = ['causes', 'merely_follows', 'contradicts'] as const;
export const PAYOFF_VERDICTS = ['earned', 'linked_only'] as const;

export const JudgeResponseSchema = z.object({
  causal_pairs: z
    .array(
      z.object({
        pair: z.string(),
        verdict: z.enum(CAUSAL_VERDICTS),
        why: z.string().default(''),
      }),
    )
    .default([]),
  payoffs: z
    .array(
      z.object({
        fact_ref: z.string(),
        verdict: z.enum(PAYOFF_VERDICTS),
        why: z.string().default(''),
      }),
    )
    .default([]),
  closest_stock_shape: z.string().default(''),
  stock_adherence: z.number().int().min(1).max(5),
  thematic_coherence: z.number().int().min(1).max(5),
  engagement: z.number().int().min(1).max(5),
  notes: z.string().default(''),
});

export type JudgeResponse = z.infer<typeof JudgeResponseSchema>;

export interface JudgeScore {
  readonly label: string;
  /** The judge model that produced this. Per AGENTS.md, a score without it is not a measurement. */
  readonly judge_model: string;
  readonly causal: {
    pairs: number;
    causes: number;
    merely_follows: number;
    contradicts: number;
    /** `causes` ÷ pairs. Bar: ≥ 0.70, with `contradicts` at 0. */
    causes_share: number | null;
    passed: boolean;
  };
  readonly payoff_earned: {
    pairs: number;
    earned: number;
    linked_only: number;
    /** #124's number: does a `pays_off` edge need an explicit trigger term? Bar: ≥ 0.70. */
    earned_share: number | null;
    passed: boolean;
  };
  readonly non_genericity: { closest_stock_shape: string; adherence: number; passed: boolean };
  readonly thematic_coherence: { score: number; passed: boolean };
  readonly engagement: { score: number; passed: boolean };
  readonly notes: string;
  readonly raw: JudgeResponse;
}

const JUDGE_SYSTEM_INSTRUCTION = `You are evaluating the SKELETON of a story — its world, its events in chronological order, and its declared setup/payoff links. You are not evaluating prose, and there is no prose to evaluate. Do not reward or penalise anything about wording, imagery or style.

Judge what is in front of you, strictly. These skeletons come from several sources and you are not told which; guessing at the source is not part of the task and speculating about it will make your scores worse.

Score every criterion separately. Do not average anything, and do not let a strong criterion soften a weak one.`;

/**
 * Render a package as the blind structural view both entry points are judged in.
 *
 * Ids are relabelled `E01…`, which is not cosmetic: a fixture's `scene_04_sisters_depart` and a
 * generated `ev_04_…` would otherwise tell the judge exactly what it is not supposed to know.
 */
export function blindArcView(pkg: StoryPackage): string {
  const scenes = scenesInOrder(pkg);
  const label = new Map(scenes.map((scene, index) => [scene.id, `E${String(index + 1).padStart(2, '0')}`]));
  const seed = pkg.world_model_seed;

  // Entity ids are relabelled for the same reason scene ids are: `char_cinderella` announces the
  // provenance a `char_inspector` does not. It removes one channel; it cannot remove the names
  // themselves, which the judge needs, so a famous fixture may still be recognised. §4.3's value
  // survives that, because recognition inflates — a judge that cannot clear its bars on material
  // it may well recognise is decisively miscalibrated.
  const entity = new Map<string, string>();
  const relabel = (id: string, prefix: string): string => {
    const existing = entity.get(id);
    if (existing !== undefined) return existing;
    const next = `${prefix}${String([...entity.values()].filter((v) => v.startsWith(prefix)).length + 1).padStart(2, '0')}`;
    entity.set(id, next);
    return next;
  };
  for (const row of seed.characters) relabel(row.id, 'C');
  for (const row of seed.locations) relabel(row.id, 'L');
  for (const row of seed.objects) relabel(row.id, 'O');
  const show = (id: string): string => entity.get(id) ?? id;

  const seedLines = [
    'CAST',
    ...seed.characters.map(
      (row) =>
        `  ${show(row.id)} — ${row.name}` +
        (row.goal === null ? '' : `; wants: ${row.goal}`) +
        (row.status === null ? '' : `; ${row.status}`),
    ),
    'PLACES',
    ...seed.locations.map((row) => `  ${show(row.id)} — ${row.name}`),
  ];
  if (seed.objects.length > 0) {
    seedLines.push('THINGS', ...seed.objects.map((row) => `  ${show(row.id)} — ${row.name}`));
  }
  if (seed.relationships.length > 0) {
    seedLines.push(
      'TIES',
      ...seed.relationships.map((row) => `  ${show(row.from_id)} → ${show(row.to_id)}: ${row.kind}`),
    );
  }
  const seeded = seed.character_knowledge.filter((row) => row.learned_at_scene === null);
  if (seeded.length > 0) {
    seedLines.push(
      'TRUE BEFORE THE STORY OPENS',
      ...seeded.map((row) => `  ${row.fact_ref} (known by ${show(row.character_id)})`),
    );
  }

  const eventLines = scenes.flatMap((scene) => {
    const lines = [
      `${label.get(scene.id)} @ ${show(scene.location_id)}, following ${show(scene.pov)}` +
        ` — ${scene.dramatic_function}`,
    ];
    for (const beat of scene.required_beats) lines.push(`    · ${beat}`);
    if (scene.reader_must_learn.length > 0) {
      lines.push(`    reader learns: ${scene.reader_must_learn.join(', ')}`);
    }
    if (scene.must_stay_hidden.length > 0) {
      lines.push(`    withheld: ${scene.must_stay_hidden.join(', ')}`);
    }
    for (const payoff of scene.pays_off) {
      const from = payoff.plant === null ? 'SEED' : (label.get(payoff.plant) ?? payoff.plant);
      lines.push(`    PAYS OFF: ${payoff.fact_ref}  (planted in ${from})`);
    }
    return lines;
  });

  return ['WORLD AS THE STORY OPENS', ...seedLines, '', 'EVENTS, IN ORDER', ...eventLines].join('\n');
}

function judgePrompt(view: string): string {
  return [
    view,
    '',
    '---',
    '',
    'CAUSAL FOLLOW-THROUGH. For every consecutive pair of events (E01→E02, E02→E03, and so on),',
    'decide one of:',
    '  causes — the earlier event\'s outcome is why the later one happens as it does.',
    '  merely_follows — the later event happens after, and would happen much the same without it.',
    '  contradicts — the later event is inconsistent with what the earlier one established.',
    'Name every pair. Do not skip any.',
    '',
    'PAYOFF EARNED-NESS. For every "PAYS OFF" line above, decide one of:',
    '  earned — by the time the payoff lands, the planting event has done enough work that a reader',
    '    would feel the setup pay out. The plant sat there doing other business and this collects it.',
    '  linked_only — the link is declared and consistent, but the planting event does not actually',
    '    set anything up. The reader would not feel a debt being repaid. A plant one event ahead of',
    '    its payoff, or a plant that exists only to be paid off, is linked_only.',
    'Judge each on its own. A valid link is not the same thing as an earned one, and most of the',
    'value of this question is in refusing to conflate them.',
    '',
    'NON-GENERICITY. Name the closest stock story shape you can (be specific: "Cinderella-type',
    'rags-to-recognition", "locked-room whodunnit", "redemption via supernatural visitation").',
    'Then rate adherence 1–5:',
    '  1 — resembles the shape only at the highest level; the events are its own.',
    '  2 — recognisably the shape, with substantial material the shape does not supply.',
    '  3 — the shape, competently particularised.',
    '  4 — the shape with names substituted and little else.',
    '  5 — the shape and nothing but; every event is predictable from the label.',
    '',
    'THEMATIC COHERENCE, 1–5:',
    '  1 — no recognizable concern; events are a sequence.',
    '  3 — one concern is visible and mostly held.',
    '  5 — one concern is stated, tested and answered by the arc\'s own events.',
    '',
    'ENGAGEMENT, 1–5:',
    '  1 — nothing here makes a reader want the next event.',
    '  3 — a reader would keep going without enthusiasm.',
    '  5 — the arc creates specific questions a reader wants answered.',
  ].join('\n');
}

export function judgeResponseJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      causal_pairs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            pair: { type: 'string', description: 'e.g. "E03→E04"' },
            verdict: { type: 'string', enum: [...CAUSAL_VERDICTS] },
            why: { type: 'string' },
          },
          required: ['pair', 'verdict', 'why'],
          propertyOrdering: ['pair', 'verdict', 'why'],
        },
      },
      payoffs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fact_ref: { type: 'string' },
            verdict: { type: 'string', enum: [...PAYOFF_VERDICTS] },
            why: { type: 'string' },
          },
          required: ['fact_ref', 'verdict', 'why'],
          propertyOrdering: ['fact_ref', 'verdict', 'why'],
        },
      },
      closest_stock_shape: { type: 'string' },
      stock_adherence: { type: 'integer' },
      thematic_coherence: { type: 'integer' },
      engagement: { type: 'integer' },
      notes: { type: 'string', description: 'Anything a score hides. Two sentences at most.' },
    },
    required: [
      'causal_pairs',
      'payoffs',
      'closest_stock_shape',
      'stock_adherence',
      'thematic_coherence',
      'engagement',
      'notes',
    ],
    propertyOrdering: [
      'causal_pairs',
      'payoffs',
      'closest_stock_shape',
      'stock_adherence',
      'thematic_coherence',
      'engagement',
      'notes',
    ],
  };
}

export const JUDGE_MAX_OUTPUT_TOKENS = 16_000;

export async function judgePackage(
  pkg: StoryPackage,
  label: string,
  options: { client: ModelClient; model: string },
): Promise<JudgeScore> {
  const response = await options.client.generate({
    model: options.model,
    systemInstruction: JUDGE_SYSTEM_INSTRUCTION,
    contents: judgePrompt(blindArcView(pkg)),
    responseJsonSchema: judgeResponseJsonSchema(),
    maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
    thinkingLevel: 'MEDIUM',
  });

  if (response.finish_reason !== 'STOP') {
    throw new Error(`judge finished ${response.finish_reason} for "${label}"`);
  }

  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(response.text);
  const raw = JudgeResponseSchema.parse(JSON.parse(fenced?.[1] ?? response.text));
  return summarize(raw, label, response.model);
}

/** Turn a judge's raw verdicts into the per-criterion result, with each bar applied separately. */
export function summarize(raw: JudgeResponse, label: string, judgeModel: string): JudgeScore {
  const causes = raw.causal_pairs.filter((row) => row.verdict === 'causes').length;
  const merely = raw.causal_pairs.filter((row) => row.verdict === 'merely_follows').length;
  const contradicts = raw.causal_pairs.filter((row) => row.verdict === 'contradicts').length;
  const pairs = raw.causal_pairs.length;
  const causesShare = pairs === 0 ? null : causes / pairs;

  const earned = raw.payoffs.filter((row) => row.verdict === 'earned').length;
  const linkedOnly = raw.payoffs.filter((row) => row.verdict === 'linked_only').length;
  const payoffPairs = raw.payoffs.length;
  const earnedShare = payoffPairs === 0 ? null : earned / payoffPairs;

  return {
    label,
    judge_model: judgeModel,
    causal: {
      pairs,
      causes,
      merely_follows: merely,
      contradicts,
      causes_share: causesShare,
      passed: causesShare !== null && causesShare >= 0.7 && contradicts === 0,
    },
    payoff_earned: {
      pairs: payoffPairs,
      earned,
      linked_only: linkedOnly,
      earned_share: earnedShare,
      passed: earnedShare !== null && earnedShare >= 0.7,
    },
    non_genericity: {
      closest_stock_shape: raw.closest_stock_shape,
      adherence: raw.stock_adherence,
      passed: raw.stock_adherence <= 3,
    },
    thematic_coherence: { score: raw.thematic_coherence, passed: raw.thematic_coherence >= 3 },
    engagement: { score: raw.engagement, passed: raw.engagement >= 3 },
    notes: raw.notes,
    raw,
  };
}
