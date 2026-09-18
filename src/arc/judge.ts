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

/**
 * The causal verdicts, unchanged — and #147 deliberately did **not** add a fourth.
 *
 * The first attempt did: a `discontinuity` verdict for a seam where the telling jumps in story
 * time, meant to stop *A Christmas Carol*'s Stave seams from being counted as causal misses. It
 * made the fixture worse, 0.63 → 0.38, and three repeat runs showed that was a stable measurement
 * rather than noise (the judge reproduces within ±0.08, with the same 6 seams found every time).
 *
 * The reason is worth keeping, because it is not obvious: a seam can be **both** a story-time jump
 * and genuinely causal. The Ghost showing Scrooge his own past is a jump of decades *and* the
 * cause of everything he does next. Offering discontinuity as a competing verdict made the judge
 * spend it on pairs it had rated `causes`, throwing away the real causal evidence the criterion
 * exists to collect.
 *
 * So the jump is recorded *alongside* the verdict instead, and the two are crossed in `summarize`.
 */
export const CAUSAL_VERDICTS = ['causes', 'merely_follows', 'contradicts'] as const;

export const PAYOFF_VERDICTS = ['earned', 'linked_only'] as const;

/**
 * The closed inventory of stock shapes, and the reason non-genericity needs one.
 *
 * The criterion used to ask the judge to *name the closest stock shape it can* and then rate
 * adherence to that self-supplied label. The label was derived from the arc, so adherence was
 * maximal for any clean instance of anything nameable: the judge labelled Cinderella
 * "Cinderella-type rags-to-recognition" and scored it 5/5, while nine generated arcs drew genre
 * labels ("industrial accident inquiry whodunnit") that nothing can fully adhere to and scored
 * 2–3. It was measuring how specific a label the judge happened to choose.
 *
 * A fixed list the judge must pick from restores the comparison. The list is deliberately coarse
 * and deliberately short: these are shapes, not genres, and a shape that can be tailored to the
 * arc is the failure this replaces.
 */
/**
 * How many load-bearing particulars rescue a close-fitting arc from the generic verdict.
 *
 * Provisional, and set from a 12-package run rather than from theory — per the rubric's §5, a bar
 * stated so the next measurement has something to argue with. It is the number that separates the
 * three fixtures from a deliberately inert arc in the only corpus that exists.
 */
export const NON_GENERICITY_MIN_PARTICULARS = 2;

export const STOCK_SHAPES = [
  'rags to recognition — a slighted figure is raised by a test they alone can pass',
  'redemption — a hardened figure is confronted with themselves and changes',
  'the quest — a journey undertaken for an object or goal, against obstacles',
  'whodunnit — a wrong is uncovered by investigation, and the culprit revealed',
  'tragedy — a flaw carries a figure to a ruin the story makes inevitable',
  'rise and fall — an ascent that produces the conditions of its own collapse',
  'the return — a figure comes back to a world that has moved on without them',
  'forbidden bond — a tie that the surrounding order will not permit',
  'the reckoning — a buried past resurfaces and demands payment',
  'survival — a figure endures a hostile situation and is changed by enduring it',
  'none of these — the arc does not reduce to any shape on this list',
] as const;

export const JudgeResponseSchema = z.object({
  causal_pairs: z
    .array(
      z.object({
        pair: z.string(),
        verdict: z.enum(CAUSAL_VERDICTS),
        /** Whether the telling jumps story time across this seam. Crossed with, not instead of, the verdict. */
        story_time_jump: z.boolean().default(false),
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
  /**
   * #147's replacement question: what does this arc have that the label does not supply?
   * `load_bearing` is whether the arc's own causal chain runs through it, which is what separates
   * a particularised story from a decorated one.
   */
  particulars: z
    .array(
      z.object({
        element: z.string(),
        load_bearing: z.boolean(),
        why: z.string().default(''),
      }),
    )
    .default([]),
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
    /** `causes` ÷ pairs, over every pair. The number #119 published, still comparable. */
    causes_share: number | null;
    /** Seams where the telling jumps story time. Reported; see `continuous` for what it is for. */
    story_time_jumps: number;
    /**
     * The same criterion restricted to pairs the telling does **not** jump across — #147's
     * replacement for a bar that punished Syuzhet structure.
     *
     * §4.2 asks whether each scene's outcome causes what follows. Across a flashback seam that
     * question is partly unanswerable and partly unfair, but it is *not* meaningless, which is why
     * the jump pairs are still judged and still reported rather than discarded: `share` here is
     * what the bar applies to, and the two numbers together say whether the arc's causality is
     * genuinely thin or merely interrupted.
     */
    continuous: { pairs: number; causes: number; share: number | null };
    passed: boolean;
  };
  readonly payoff_earned: {
    pairs: number;
    earned: number;
    linked_only: number;
    /** #124's number: does a `pays_off` edge need an explicit trigger term? Bar: ≥ 0.70. */
    earned_share: number | null;
    passed: boolean;
    /**
     * #148's retarget. §6 of the approach doc found the ticket's original comparison — 37%
     * seed-grounded here versus ~20% in the fixtures — unreadable at a 5-edge fixture denominator.
     * The signal that survives is *within* this corpus: seed-grounded edges (`plant: null`) earn
     * their verdict far less often than planted ones (0.45 vs 0.88 across the nine generated arcs).
     * Reported for context, never gated — §7 adds no new bar.
     */
    seed_grounded: { pairs: number; earned: number; share: number | null };
    planted: { pairs: number; earned: number; share: number | null };
  };
  /**
   * #147's rebuild. `adherence` is now rated against a label from `STOCK_SHAPES` the judge could
   * not tailor, and the criterion is *passed* on particularisation rather than on adherence alone:
   * being the canonical instance of a shape and being generic are not the same thing, and the old
   * form could not tell them apart.
   */
  readonly non_genericity: {
    closest_stock_shape: string;
    adherence: number;
    /** Elements a reader knowing only the label could not predict, and which carry the causality. */
    load_bearing_particulars: number;
    particulars: number;
    passed: boolean;
  };
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
/** `fact_ref`s whose `pays_off` edge is seed-grounded (`plant: null`) rather than planted. */
export function seedGroundedFactRefs(pkg: StoryPackage): ReadonlySet<string> {
  const refs = new Set<string>();
  for (const scene of scenesInOrder(pkg)) {
    for (const payoff of scene.pays_off) {
      if (payoff.plant === null) refs.add(payoff.fact_ref);
    }
  }
  return refs;
}

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
    'Then, SEPARATELY and for the same pair, set story_time_jump: true when the telling jumps in',
    'story time across this seam — the later event belongs to a different time from the earlier one',
    'because a memory or flashback begins or ends, a vision of the future begins or ends, or the',
    'story cuts across a long gap. This is not a fourth verdict and it does not replace the one you',
    'just gave: a seam can be a jump of decades AND be the direct cause of what follows. Judge the',
    'causation on its own merits first, then say whether the story jumped.',
    'Set it false for an ordinary scene change, a change of location, or a pair you merely find',
    'weakly connected.',
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
    'NON-GENERICITY, in two parts.',
    '',
    'First, pick the closest shape from THIS LIST and copy it verbatim. Do not invent a label, do',
    'not qualify one, do not combine two. If none fits, pick the last entry.',
    ...STOCK_SHAPES.map((shape) => `  - ${shape}`),
    '',
    'Then rate adherence 1–5 against the shape you picked:',
    '  1 — resembles the shape only at the highest level; the events are its own.',
    '  2 — recognisably the shape, with substantial material the shape does not supply.',
    '  3 — the shape, competently particularised.',
    '  4 — the shape with names substituted and little else.',
    '  5 — the shape and nothing but; every event is predictable from the label.',
    '',
    'Then — and this is the part that decides the criterion — list the PARTICULARS: things in this',
    'arc that a reader who knew only the label could NOT have predicted. For each, say whether it',
    'is load_bearing: does the arc\'s own chain of cause and effect actually run through it, or is',
    'it decoration that could be removed without changing what happens? A specific object, rule,',
    'condition or relationship that the plot turns on is load-bearing; a colourful detail that',
    'nothing depends on is not. List at most eight, and list none rather than pad the list.',
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
            story_time_jump: {
              type: 'boolean',
              description: 'Does the telling jump story time here? Independent of the verdict.',
            },
            why: { type: 'string' },
          },
          required: ['pair', 'verdict', 'story_time_jump', 'why'],
          propertyOrdering: ['pair', 'verdict', 'story_time_jump', 'why'],
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
      closest_stock_shape: {
        type: 'string',
        enum: [...STOCK_SHAPES],
        description: 'Copied verbatim from the offered list.',
      },
      stock_adherence: { type: 'integer' },
      particulars: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            element: { type: 'string', description: 'What the label does not predict.' },
            load_bearing: {
              type: 'boolean',
              description: "True when the arc's causal chain runs through it.",
            },
            why: { type: 'string' },
          },
          required: ['element', 'load_bearing', 'why'],
          propertyOrdering: ['element', 'load_bearing', 'why'],
        },
      },
      thematic_coherence: { type: 'integer' },
      engagement: { type: 'integer' },
      notes: { type: 'string', description: 'Anything a score hides. Two sentences at most.' },
    },
    required: [
      'causal_pairs',
      'payoffs',
      'closest_stock_shape',
      'stock_adherence',
      'particulars',
      'thematic_coherence',
      'engagement',
      'notes',
    ],
    propertyOrdering: [
      'causal_pairs',
      'payoffs',
      'closest_stock_shape',
      'stock_adherence',
      'particulars',
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
  return summarize(raw, label, response.model, seedGroundedFactRefs(pkg));
}

/** Turn a judge's raw verdicts into the per-criterion result, with each bar applied separately. */
export function summarize(
  raw: JudgeResponse,
  label: string,
  judgeModel: string,
  seedGrounded: ReadonlySet<string> = new Set(),
): JudgeScore {
  const causes = raw.causal_pairs.filter((row) => row.verdict === 'causes').length;
  const merely = raw.causal_pairs.filter((row) => row.verdict === 'merely_follows').length;
  const contradicts = raw.causal_pairs.filter((row) => row.verdict === 'contradicts').length;
  const pairs = raw.causal_pairs.length;
  const causesShare = pairs === 0 ? null : causes / pairs;

  const jumps = raw.causal_pairs.filter((row) => row.story_time_jump);
  const continuousPairs = raw.causal_pairs.filter((row) => !row.story_time_jump);
  const continuousCauses = continuousPairs.filter((row) => row.verdict === 'causes').length;
  const continuousShare =
    continuousPairs.length === 0 ? null : continuousCauses / continuousPairs.length;

  const loadBearing = raw.particulars.filter((row) => row.load_bearing).length;

  const earned = raw.payoffs.filter((row) => row.verdict === 'earned').length;
  const linkedOnly = raw.payoffs.filter((row) => row.verdict === 'linked_only').length;
  const payoffPairs = raw.payoffs.length;
  const earnedShare = payoffPairs === 0 ? null : earned / payoffPairs;

  const seedGroundedPayoffs = raw.payoffs.filter((row) => seedGrounded.has(row.fact_ref));
  const plantedPayoffs = raw.payoffs.filter((row) => !seedGrounded.has(row.fact_ref));
  const seedGroundedEarned = seedGroundedPayoffs.filter((row) => row.verdict === 'earned').length;
  const plantedEarned = plantedPayoffs.filter((row) => row.verdict === 'earned').length;

  return {
    label,
    judge_model: judgeModel,
    causal: {
      pairs,
      causes,
      merely_follows: merely,
      contradicts,
      causes_share: causesShare,
      story_time_jumps: jumps.length,
      continuous: {
        pairs: continuousPairs.length,
        causes: continuousCauses,
        share: continuousShare,
      },
      // The bar reads the continuous share; `contradicts` is scored over EVERY pair, jumps
      // included. A contradiction across a flashback seam is still a contradiction — the reader
      // meets those two scenes back to back whatever the chronology — so the zero-tolerance half
      // of this row must never be excludable.
      passed: continuousShare !== null && continuousShare >= 0.7 && contradicts === 0,
    },
    payoff_earned: {
      pairs: payoffPairs,
      earned,
      linked_only: linkedOnly,
      earned_share: earnedShare,
      passed: earnedShare !== null && earnedShare >= 0.7,
      seed_grounded: {
        pairs: seedGroundedPayoffs.length,
        earned: seedGroundedEarned,
        share: seedGroundedPayoffs.length === 0 ? null : seedGroundedEarned / seedGroundedPayoffs.length,
      },
      planted: {
        pairs: plantedPayoffs.length,
        earned: plantedEarned,
        share: plantedPayoffs.length === 0 ? null : plantedEarned / plantedPayoffs.length,
      },
    },
    non_genericity: {
      closest_stock_shape: raw.closest_stock_shape,
      adherence: raw.stock_adherence,
      load_bearing_particulars: loadBearing,
      particulars: raw.particulars.length,
      // An arc fails only when it is BOTH a close fit to a shape it could not tailor AND has
      // nothing load-bearing the shape does not supply. Cinderella is a 5-adherence instance of
      // "rags to recognition" and is not generic, because the irony gap and the midnight condition
      // are its own and the plot turns on them. That pair of facts is what the old single number
      // could not express.
      passed: raw.stock_adherence <= 3 || loadBearing >= NON_GENERICITY_MIN_PARTICULARS,
    },
    thematic_coherence: { score: raw.thematic_coherence, passed: raw.thematic_coherence >= 3 },
    engagement: { score: raw.engagement, passed: raw.engagement >= 3 },
    notes: raw.notes,
    raw,
  };
}
