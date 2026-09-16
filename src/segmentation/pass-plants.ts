/**
 * Pass 3 — the plant/payoff graph and the told-ledger, which are the same problem twice.
 *
 * ADR 0004's `pays_off` entry is `{fact_ref, plant}`, and the walk it feeds rejects a package
 * unless the plant scene *strictly precedes* the payoff and *independently declares the fact* in
 * its own `reader_must_learn`. So a plant/payoff edge is never only an edge: it is a claim about
 * what the reader knows, and when.
 *
 * ## Two inputs, two jobs
 *
 * **Generated input already has the graph.** #119's events carry `pays_off` edges naming *event*
 * ids, and `reveals`/`conceals` per event. All of that is carried forward mechanically — plant
 * event id rewritten to the scene that swallowed it — by `carryForward` below. No model is called
 * for an arc that already told us.
 *
 * **Extracted input has none of it.** #117 emits `pays_off: []` on every event and lists
 * `reveals`/`conceals` under `fields_not_recovered`, because — per
 * `docs/research/narrative-extraction-prior-art.md` §4.7 — *"the told-ledger cannot be extracted;
 * it has to be derived"*, from Scene Cards that did not exist until this ticket drew them. So this
 * is the pass that derives it, and it runs over Scene Cards exactly as §4.7 says it must.
 *
 * ## Propose → verify → filter, which is not a shape invented here
 *
 * `narrative-extraction-prior-art.md` §4.6 reports CFPG, the one published foreshadow/payoff
 * dataset, built by *candidate identification → payoff alignment verification → rubric-based
 * filtering*, and notes R² reaching the same verify-then-filter conclusion independently. §10 of
 * the same document leans on that agreement. This pass is those three steps:
 *
 * 1. **Propose** over the scene list, with every earlier scene visible as a one-liner so a
 *    long-range pair is reachable — the *Carol*'s "surplus population" plant crosses 7 scenes, and
 *    §3.7 scores long-range recall separately precisely because short pairs would carry the
 *    aggregate otherwise.
 * 2. **Verify** each proposal against the two scenes' own beats, one batched call, rejecting a
 *    pair whose plant scene does not actually establish the fact.
 * 3. **Filter** mechanically against ADR 0004's rules, before the linter ever sees it.
 *
 * ## What this pass refuses to do
 *
 * A `plant: null` payoff means "grounded in the World Model seed", and `walkPlantObligations`
 * checks it against `character_knowledge` rows with `learned_at_scene: null`. Producing such a
 * payoff therefore requires *writing a seed row* — asserting that some character knew the fact
 * before the story opened. That is a World Model claim, and #117 declined to make it on cited
 * grounds (research §4: nothing recovers character knowledge from prose; "populating it would be
 * invention dressed as extraction"). Segmentation does not overrule a sibling pipeline's decision
 * about its own deliverable, so a seed-grounded proposal over a seed with no matching row is
 * **rejected and counted** as `seed_grounded_unrepresentable` rather than quietly seeded. See the
 * open question in the ticket report: the *Carol*'s `corpse_is_scrooge` is exactly this case, and
 * it is not reachable today by any automated path.
 */

import { z } from 'zod';

import { ExtractionCallError, type ExtractionModel } from '../extraction/call';
import type { FabulaEvent } from '../schema/fabula';
import { seedKnownFacts } from '../plants/obligation-walk';
import type { StoryPackage } from '../schema/story-package';

/** Payoff-candidate scenes per proposal call. Every earlier scene is visible either way. */
export const PLANT_WINDOW_SCENES = 20;

export interface SceneSketch {
  readonly id: string;
  readonly order: number;
  readonly dramatic_function: string;
  readonly required_beats: readonly string[];
}

export interface PlantPair {
  readonly fact_ref: string;
  /** Scene id, or `null` for a claimed seed-grounded payoff. */
  readonly plant: string | null;
  readonly payoff: string;
  readonly why: string;
}

const PLANT_SLUG = /^[a-z0-9]+(_[a-z0-9]+)*$/;

const ProposalSchema = z.object({
  pairs: z
    .array(
      z.object({
        fact_ref: z.string().default(''),
        plant_scene: z.string().default(''),
        payoff_scene: z.string().default(''),
        what_is_planted: z.string().default(''),
      }),
    )
    .default([]),
});

const PROPOSE_SYSTEM = `You are finding PLANT / PAYOFF pairs in a story that is already broken
into scenes.

A plant/payoff pair is one specific fact the story ESTABLISHES in an earlier scene and COLLECTS in
a later one — a condition stated and later broken, an object acquired and later produced, a remark
made and later thrown back. The distance matters: the reader has to have met the fact before the
later scene uses it.

For each pair, give:
- "fact_ref": a short lower_snake_case slug naming the fact itself, descriptive enough to act on
  ("midnight_condition", "kept_second_slipper"), never "fact_1".
- "plant_scene": the scene id where the reader first learns it. MUST be a scene id from the list.
- "payoff_scene": the scene id where the story collects it. MUST be a LATER scene id.
- "what_is_planted": one clause saying what the reader takes away from the plant scene.

Rules:
- The plant scene must come STRICTLY BEFORE the payoff scene.
- Only name a pair where the plant scene's own beats establish the fact. If the plant is only
  implied, skip it.
- Do not report a pair whose two ends are the same scene.
- Do not invent facts. Every pair must be readable off the beats shown.
- Prefer few, real pairs over many weak ones. A story of this length typically has a handful.`;

function proposalJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      pairs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fact_ref: { type: 'string', description: 'lower_snake_case slug.' },
            plant_scene: { type: 'string' },
            payoff_scene: { type: 'string' },
            what_is_planted: { type: 'string' },
          },
          required: ['fact_ref', 'plant_scene', 'payoff_scene', 'what_is_planted'],
          propertyOrdering: ['fact_ref', 'plant_scene', 'payoff_scene', 'what_is_planted'],
        },
      },
    },
    required: ['pairs'],
  };
}

const VERDICTS = ['valid', 'plant_does_not_establish_it', 'payoff_does_not_collect_it'] as const;

const VerifySchema = z.object({
  verdicts: z
    .array(
      z.object({
        fact_ref: z.string(),
        verdict: z.enum(VERDICTS),
        why: z.string().default(''),
      }),
    )
    .default([]),
});

const VERIFY_SYSTEM = `For each proposed plant/payoff pair you are shown the PLANT scene's beats
and the PAYOFF scene's beats, and nothing else.

Answer, per pair:
- "valid" — the plant scene's beats genuinely establish the fact for the reader, AND the payoff
  scene's beats genuinely depend on or collect it.
- "plant_does_not_establish_it" — the plant scene never actually shows the reader this fact.
- "payoff_does_not_collect_it" — the payoff scene does not use it; it merely comes later.

Be strict. Judge only the beats in front of you, never your own knowledge of the story. A pair
that is merely thematically related is not valid.`;

function verifyJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fact_ref: { type: 'string', description: 'Copied from the item, verbatim.' },
            verdict: { type: 'string', enum: [...VERDICTS] },
            why: { type: 'string' },
          },
          required: ['fact_ref', 'verdict', 'why'],
          propertyOrdering: ['fact_ref', 'verdict', 'why'],
        },
      },
    },
    required: ['verdicts'],
  };
}

const HiddenSchema = z.object({
  facts: z
    .array(
      z.object({
        fact_ref: z.string(),
        withheld_in: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

const HIDDEN_SYSTEM = `You are marking where a story DELIBERATELY WITHHOLDS a fact from the reader.

For each fact you are given the scene where the reader finally learns it, and the scenes that come
before it. Name the scenes in which the story is ALREADY CIRCLING that fact while keeping the
reader from it — scenes the fact is present in, unspoken.

Rules:
- Only list scenes STRICTLY BEFORE the scene where the reader learns it.
- Only list a scene where the withholding is doing work: the scene touches the matter and refuses
  to say it. A scene that simply has not got there yet is NOT withholding anything.
- Most facts withhold nothing. Returning an empty list for a fact is the normal answer.`;

function hiddenJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fact_ref: { type: 'string', description: 'Copied from the item, verbatim.' },
            withheld_in: { type: 'array', items: { type: 'string' } },
          },
          required: ['fact_ref', 'withheld_in'],
          propertyOrdering: ['fact_ref', 'withheld_in'],
        },
      },
    },
    required: ['facts'],
  };
}

export interface CarriedGraph {
  /** Scene id → `pays_off` entries, plant already rewritten to a scene id. */
  readonly paysOff: Map<string, Array<{ fact_ref: string; plant: string | null }>>;
  readonly reveals: Map<string, string[]>;
  readonly conceals: Map<string, string[]>;
  /** Edges whose plant event named nothing in the list — left untouched for the linter to report. */
  readonly dangling_plants: number;
}

/**
 * Rewrite a Fabula-layer graph onto scenes. Mechanical; no model, no judgment.
 *
 * `grouping.ts` has already guaranteed no plant and its payoff share a scene, so an edge that
 * survives here is one ADR 0004 can still express.
 */
export function carryForward(
  scenes: ReadonlyArray<{ id: string; events: readonly FabulaEvent[] }>,
): CarriedGraph {
  const sceneOfEvent = new Map<string, string>();
  for (const scene of scenes) {
    for (const event of scene.events) sceneOfEvent.set(event.id, scene.id);
  }

  const paysOff = new Map<string, Array<{ fact_ref: string; plant: string | null }>>();
  const reveals = new Map<string, string[]>();
  const conceals = new Map<string, string[]>();
  let dangling = 0;

  for (const scene of scenes) {
    for (const event of scene.events) {
      for (const payoff of event.pays_off) {
        let plant: string | null = null;
        if (payoff.plant !== null) {
          const at = sceneOfEvent.get(payoff.plant);
          if (at === undefined) {
            dangling += 1;
            plant = payoff.plant;
          } else {
            plant = at;
          }
        }
        const list = paysOff.get(scene.id) ?? [];
        if (!list.some((entry) => entry.fact_ref === payoff.fact_ref && entry.plant === plant)) {
          list.push({ fact_ref: payoff.fact_ref, plant });
        }
        paysOff.set(scene.id, list);
      }
      if (event.reveals.length > 0) {
        reveals.set(scene.id, [...new Set([...(reveals.get(scene.id) ?? []), ...event.reveals])]);
      }
      if (event.conceals.length > 0) {
        conceals.set(scene.id, [...new Set([...(conceals.get(scene.id) ?? []), ...event.conceals])]);
      }
    }
  }

  return { paysOff, reveals, conceals, dangling_plants: dangling };
}

function renderSketch(sketch: SceneSketch, full: boolean): string {
  if (!full) return `  ${sketch.id} — ${sketch.dramatic_function}`;
  return [
    `  ${sketch.id} — ${sketch.dramatic_function}`,
    ...sketch.required_beats.map((beat) => `      · ${beat}`),
  ].join('\n');
}

export interface ProposalResult {
  readonly pairs: readonly PlantPair[];
  readonly failed_batches: number;
  readonly rejected_malformed: number;
}

/**
 * Step 1: propose pairs, windowed by *payoff* scene with every earlier scene in view.
 *
 * This is what "global means sees the accumulated state, never one unbounded call" buys here: a
 * window's payoff candidates come with their beats, while everything before them is compressed to
 * one line each. A pair that spans the whole story is still reachable, and the call size grows
 * linearly in scene count rather than in event count.
 */
export async function proposePairs(
  model: ExtractionModel,
  sketches: readonly SceneSketch[],
  options: { windowScenes?: number; onProgress?: (message: string) => void } = {},
): Promise<ProposalResult> {
  const windowScenes = options.windowScenes ?? PLANT_WINDOW_SCENES;
  const progress = options.onProgress ?? ((): void => {});
  const byId = new Map(sketches.map((sketch) => [sketch.id, sketch]));
  const seen = new Set<string>();
  const pairs: PlantPair[] = [];
  let failed = 0;
  let malformed = 0;

  for (let start = 0; start < sketches.length; start += windowScenes) {
    const window = sketches.slice(start, start + windowScenes);
    const earlier = sketches.slice(0, start);
    progress(`plant proposals for scenes ${start + 1}–${start + window.length}`);

    const contents = [
      earlier.length === 0
        ? ''
        : ['EARLIER SCENES (available as plants):', ...earlier.map((s) => renderSketch(s, false)), ''].join(
            '\n',
          ),
      'SCENES IN FOCUS (find pairs whose PAYOFF is one of these; the plant may be any scene above or among these):',
      ...window.map((sketch) => renderSketch(sketch, true)),
    ]
      .filter((part) => part !== '')
      .join('\n');

    try {
      const response = await model.json(ProposalSchema, {
        pass: 'segmentation.plant_proposals',
        label: `scenes ${start + 1}–${start + window.length}`,
        systemInstruction: PROPOSE_SYSTEM,
        contents,
        responseJsonSchema: proposalJsonSchema(),
        maxOutputTokens: 3072,
      });

      for (const raw of response.pairs) {
        const factRef = raw.fact_ref.trim().toLowerCase();
        const plant = raw.plant_scene.trim();
        const payoff = raw.payoff_scene.trim();
        const plantScene = byId.get(plant);
        const payoffScene = byId.get(payoff);

        if (
          !PLANT_SLUG.test(factRef) ||
          payoffScene === undefined ||
          plantScene === undefined ||
          plantScene.order >= payoffScene.order
        ) {
          malformed += 1;
          continue;
        }
        const key = `${factRef}|${plant}|${payoff}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ fact_ref: factRef, plant, payoff, why: raw.what_is_planted });
      }
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      failed += 1;
    }
  }

  return { pairs, failed_batches: failed, rejected_malformed: malformed };
}

export interface VerificationResult {
  readonly accepted: readonly PlantPair[];
  readonly rejected: ReadonlyArray<{ pair: PlantPair; verdict: string; why: string }>;
  readonly unverified: readonly PlantPair[];
  readonly failed_batches: number;
}

/** Step 2: verify each proposal against the two scenes' beats alone. */
export async function verifyPairs(
  model: ExtractionModel,
  pairs: readonly PlantPair[],
  sketches: readonly SceneSketch[],
  options: { batchSize?: number; onProgress?: (message: string) => void } = {},
): Promise<VerificationResult> {
  const batchSize = options.batchSize ?? 6;
  const progress = options.onProgress ?? ((): void => {});
  const byId = new Map(sketches.map((sketch) => [sketch.id, sketch]));
  const accepted: PlantPair[] = [];
  const rejected: Array<{ pair: PlantPair; verdict: string; why: string }> = [];
  const unverified: PlantPair[] = [];
  let failed = 0;

  for (let start = 0; start < pairs.length; start += batchSize) {
    const batch = pairs.slice(start, start + batchSize);
    progress(`verifying pairs ${start + 1}–${start + batch.length} of ${pairs.length}`);
    const contents = batch
      .map((pair) => {
        const plant = pair.plant === null ? undefined : byId.get(pair.plant);
        const payoff = byId.get(pair.payoff);
        return [
          `PAIR fact_ref: ${pair.fact_ref}`,
          `claimed: ${pair.why}`,
          `PLANT SCENE (${pair.plant ?? 'seed'}):`,
          ...(plant?.required_beats ?? ['(none)']).map((beat) => `  · ${beat}`),
          `PAYOFF SCENE (${pair.payoff}):`,
          ...(payoff?.required_beats ?? ['(none)']).map((beat) => `  · ${beat}`),
        ].join('\n');
      })
      .join('\n\n---\n\n');

    try {
      const response = await model.json(VerifySchema, {
        pass: 'segmentation.plant_verification',
        label: `pairs ${start + 1}–${start + batch.length}`,
        systemInstruction: VERIFY_SYSTEM,
        contents,
        responseJsonSchema: verifyJsonSchema(),
        maxOutputTokens: 2048,
      });
      const byFact = new Map(response.verdicts.map((entry) => [entry.fact_ref, entry]));
      for (const pair of batch) {
        const verdict = byFact.get(pair.fact_ref);
        if (verdict === undefined) {
          unverified.push(pair);
        } else if (verdict.verdict === 'valid') {
          accepted.push(pair);
        } else {
          rejected.push({ pair, verdict: verdict.verdict, why: verdict.why });
        }
      }
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      failed += 1;
      unverified.push(...batch);
    }
  }

  return { accepted, rejected, unverified, failed_batches: failed };
}

export interface WithholdingResult {
  /** Scene id → fact_refs that scene must keep from the reader. */
  readonly hidden: Map<string, string[]>;
  readonly failed_batches: number;
  readonly rejected_out_of_range: number;
}

/**
 * Step 3, and the only part of the told-ledger with no mechanical shadow at all.
 *
 * `reader_must_learn` falls out of the plant graph — the scene that plants a fact is by definition
 * the scene the reader learns it in. `must_stay_hidden` does not: it is a claim about scenes that
 * *do not* state something, and §3.6 of the rubric scores it precisely because a candidate that
 * recovers no withholding at all "has extracted a plot summary, not a Syuzhet". A scene named
 * outside the fact's own prehistory is discarded rather than trusted.
 */
export async function findWithholding(
  model: ExtractionModel,
  revealedAt: ReadonlyMap<string, string>,
  sketches: readonly SceneSketch[],
  options: { batchSize?: number; onProgress?: (message: string) => void } = {},
): Promise<WithholdingResult> {
  const batchSize = options.batchSize ?? 4;
  const progress = options.onProgress ?? ((): void => {});
  const order = new Map(sketches.map((sketch) => [sketch.id, sketch.order]));
  const hidden = new Map<string, string[]>();
  const facts = [...revealedAt.entries()];
  let failed = 0;
  let outOfRange = 0;

  for (let start = 0; start < facts.length; start += batchSize) {
    const batch = facts.slice(start, start + batchSize);
    progress(`withholding for facts ${start + 1}–${start + batch.length} of ${facts.length}`);

    const contents = batch
      .map(([factRef, revealScene]) => {
        const revealOrder = order.get(revealScene) ?? sketches.length + 1;
        const before = sketches.filter((sketch) => sketch.order < revealOrder);
        return [
          `FACT: ${factRef}`,
          `the reader learns it in: ${revealScene}`,
          'SCENES BEFORE IT:',
          ...before.map((sketch) => renderSketch(sketch, true)),
        ].join('\n');
      })
      .join('\n\n---\n\n');

    try {
      const response = await model.json(HiddenSchema, {
        pass: 'segmentation.withholding',
        label: `facts ${start + 1}–${start + batch.length}`,
        systemInstruction: HIDDEN_SYSTEM,
        contents,
        responseJsonSchema: hiddenJsonSchema(),
        maxOutputTokens: 2048,
      });
      for (const entry of response.facts) {
        const revealScene = revealedAt.get(entry.fact_ref);
        if (revealScene === undefined) continue;
        const revealOrder = order.get(revealScene) ?? -1;
        for (const sceneId of entry.withheld_in) {
          const at = order.get(sceneId);
          if (at === undefined || at >= revealOrder) {
            outOfRange += 1;
            continue;
          }
          const list = hidden.get(sceneId) ?? [];
          if (!list.includes(entry.fact_ref)) list.push(entry.fact_ref);
          hidden.set(sceneId, list);
        }
      }
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      failed += 1;
    }
  }

  return { hidden, failed_batches: failed, rejected_out_of_range: outOfRange };
}

/**
 * The final mechanical filter, run over an assembled package: ADR 0004's own rules, applied
 * before the linter sees them, so a rejection is a counted decision and not a lint error.
 */
export function unfoundedSeedPayoffs(pkg: StoryPackage): string[] {
  const known = seedKnownFacts(pkg);
  const unfounded: string[] = [];
  for (const scene of pkg.scene_cards) {
    for (const payoff of scene.pays_off) {
      if (payoff.plant === null && !known.has(payoff.fact_ref)) unfounded.push(payoff.fact_ref);
    }
  }
  return unfounded;
}
