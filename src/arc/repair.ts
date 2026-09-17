/**
 * Bounded, atomic repair of a generated arc.
 *
 * The shape is `llm-arc-generation-prior-art.md` §6's, which is PLOTTER's graph-editing framing in
 * this repo's schema: when validation fails, the fix is an **atomic edit** to the structure — add
 * the `fact_ref` to an earlier event's reveals, re-point the plant, drop the payoff — never a
 * whole-arc regeneration and never a "look again and fix it" prompt with no error code in it.
 *
 * The loop's oracle is `lintPackage`, and that is what keeps it outside Huang et al.'s
 * self-correction result: the feedback is an external mechanical verdict with a code and a field
 * path, not the model re-reading its own draft.
 *
 * Two phases, in this order, and the split is the interesting part:
 *
 * - **Mechanical** (`mechanicalRepairs`). Exactly one error code has a uniquely determined fix:
 *   `plant_not_declared`, where the generator has already *chosen* the link — this event pays off
 *   `f`, that earlier event planted it — and the only thing missing is the earlier event declaring
 *   `f` in its own reveals. Installing that declaration is §6's "editing the skeleton to install a
 *   plant is authoring, and is legitimate". It is emphatically *not* the thing ADR 0004 decision 2
 *   forbids, which is **inferring which existing scene must have been the plant**. Nothing is
 *   inferred here; the plant was named by the generator in the same pass that named the payoff.
 *
 * - **Model** (`repairPrompt` / `applyEdits`). Everything else — a plant that does not exist, a
 *   plant that comes after its payoff, a seed-grounded payoff with nothing seeded under it, a
 *   revealed fact nothing ever pays off. Each of those needs an authoring decision, so it goes
 *   back to the generator, once, with the linter's codes and paths in hand and a **closed edit
 *   vocabulary** to answer in. One pass. If it still fails, the arc is reported as failing, which
 *   is the honest outcome and the one the rubric asks for ("report the codes and stop").
 */

import { z } from 'zod';

import { lintPackage } from '../authoring/lint';
import { provisionalPackage } from '../authoring/lint-fabula';
import { eventsInOrder, type FabulaArc, type FabulaEvent } from '../schema/fabula';

/** A defect worth repairing: lint errors, plus the two warnings §4.1 promotes for generated arcs. */
export interface RepairTarget {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** The warnings `story-authoring-eval.md` §4.1 promotes to gates for a *generated* arc. */
const PROMOTED_WARNINGS = new Set(['unpaid_fact', 'no_required_beats']);

export function repairTargets(arc: FabulaArc, storyId: string): RepairTarget[] {
  const lint = lintPackage(provisionalPackage(arc, storyId));
  return [
    ...lint.errors,
    ...lint.warnings.filter((warning) => PROMOTED_WARNINGS.has(warning.code)),
  ].map(({ code, path, message }) => ({ code, path, message }));
}

// --- Phase 1: the one mechanical repair ---------------------------------------------------

export interface MechanicalRepairResult {
  readonly arc: FabulaArc;
  /** One line per edit applied, for the run report. Empty when nothing needed doing. */
  readonly applied: string[];
}

/**
 * Install declarations for plants the generator named but did not declare.
 *
 * Only applied where the named plant event exists *and* strictly precedes the payoff — if either
 * is false the link itself is wrong, which is an authoring question and belongs to the model pass.
 */
export function mechanicalRepairs(arc: FabulaArc): MechanicalRepairResult {
  const events = eventsInOrder(arc);
  const byId = new Map(events.map((event) => [event.id, event]));
  const install = new Map<string, Set<string>>();

  for (const event of events) {
    for (const payoff of event.pays_off) {
      if (payoff.plant === null) continue;
      const plant = byId.get(payoff.plant);
      if (plant === undefined || plant.sequence >= event.sequence) continue;
      if (plant.reveals.includes(payoff.fact_ref)) continue;
      const pending = install.get(plant.id) ?? new Set<string>();
      pending.add(payoff.fact_ref);
      install.set(plant.id, pending);
    }
  }

  if (install.size === 0) return { arc, applied: [] };

  const applied: string[] = [];
  const repaired = events.map((event) => {
    const pending = install.get(event.id);
    if (pending === undefined) return event;
    for (const fact of pending) {
      applied.push(`declare_fact_at_event: "${fact}" installed in ${event.id}.reveals`);
    }
    return { ...event, reveals: [...event.reveals, ...pending] };
  });

  return { arc: { ...arc, events: repaired }, applied };
}

// --- Phase 2: the bounded model pass ------------------------------------------------------

/**
 * The closed vocabulary the repair pass may answer in.
 *
 * Closed on purpose. An open-ended "return a fixed arc" would be a second generation of the whole
 * structure, which discards everything the first pass got right and reintroduces the fixation the
 * research warns about. Each edit names one field of one event.
 */
export const ARC_EDIT_KINDS = [
  'declare_fact_at_event',
  'repoint_plant',
  'drop_payoff',
  'add_payoff',
  'drop_reveal',
  'add_beat',
  'seed_fact',
] as const;

export const ArcEditSchema = z.object({
  kind: z.enum(ARC_EDIT_KINDS),
  /** The event the edit lands on, or the payoff event for the payoff edits. */
  event_id: z.string().default(''),
  fact_ref: z.string().default(''),
  /** For `repoint_plant` / `add_payoff`: the planting event, or '' for a seed-grounded payoff. */
  plant_event_id: z.string().default(''),
  /** For `add_beat`. */
  text: z.string().default(''),
  /** For `seed_fact`. */
  character_id: z.string().default(''),
  /** Why, in one clause. Read by a human in the run report, never by the code. */
  because: z.string().default(''),
});

export const ArcRepairResponseSchema = z.object({ edits: z.array(ArcEditSchema).default([]) });

export type ArcEdit = z.infer<typeof ArcEditSchema>;

export function arcRepairResponseJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...ARC_EDIT_KINDS] },
            event_id: { type: 'string' },
            fact_ref: { type: 'string' },
            plant_event_id: {
              type: 'string',
              description: 'Empty string means seed-grounded (plant: null).',
            },
            text: { type: 'string' },
            character_id: { type: 'string' },
            because: { type: 'string' },
          },
          required: ['kind', 'event_id', 'fact_ref', 'plant_event_id', 'text', 'character_id', 'because'],
          propertyOrdering: [
            'kind',
            'event_id',
            'fact_ref',
            'plant_event_id',
            'text',
            'character_id',
            'because',
          ],
        },
      },
    },
    required: ['edits'],
    propertyOrdering: ['edits'],
  };
}

export function repairPrompt(arc: FabulaArc, targets: readonly RepairTarget[]): string {
  const events = eventsInOrder(arc).map((event) =>
    [
      `${event.sequence}. ${event.id} — ${event.summary}`,
      `   reveals: [${event.reveals.join(', ')}]`,
      `   pays_off: [${event.pays_off.map((p) => `${p.fact_ref} <- ${p.plant ?? 'SEED'}`).join(', ')}]`,
      `   beats: ${event.beats.length}`,
    ].join('\n'),
  );

  const seeded = arc.world_model_seed.character_knowledge
    .filter((row) => row.learned_at_scene === null)
    .map((row) => `${row.fact_ref} (known by ${row.character_id})`);

  return [
    'A validator rejected this arc. Its verdict is mechanical and final — these are not opinions,',
    'and each one names the exact field that is wrong.',
    '',
    'PROBLEMS',
    ...targets.map((target) => `  [${target.code}] ${target.path} — ${target.message}`),
    '',
    'THE ARC, as it stands',
    ...events,
    '',
    `Facts known from the seed (the only ones a plant_event_id of "" may rest on): ${
      seeded.length === 0 ? 'none' : seeded.join(', ')
    }`,
    '',
    'Answer with the SMALLEST set of atomic edits that clears every problem above. Do not rewrite',
    'the arc; do not touch anything a problem does not name. Prefer, in this order:',
    '  1. declare_fact_at_event — plant the fact properly in an EARLIER event that is already',
    '     doing something the fact can ride along with. This is the repair that keeps the story.',
    '  2. repoint_plant — the payoff is right but the plant you named is wrong or too late.',
    '  3. add_payoff — a revealed fact nothing collects; give it a later event that collects it.',
    '  4. seed_fact — the fact was always true; seed it and use a seed-grounded payoff.',
    '  5. drop_payoff / drop_reveal — last resorts. These remove story rather than fixing it.',
    'add_beat is only for an event with no beats at all.',
  ].join('\n');
}

/** Apply a repair pass's edits. Unknown ids are skipped rather than throwing: the re-lint decides. */
export function applyEdits(arc: FabulaArc, edits: readonly ArcEdit[]): MechanicalRepairResult {
  const applied: string[] = [];
  let events: FabulaEvent[] = eventsInOrder(arc).map((event) => ({
    ...event,
    reveals: [...event.reveals],
    beats: [...event.beats],
    pays_off: event.pays_off.map((payoff) => ({ ...payoff })),
  }));
  let seed = arc.world_model_seed;

  const find = (id: string): FabulaEvent | undefined => events.find((event) => event.id === id);

  for (const edit of edits) {
    const target = find(edit.event_id);
    const note = (what: string) => applied.push(`${edit.kind}: ${what}`);

    switch (edit.kind) {
      case 'declare_fact_at_event': {
        if (target === undefined || edit.fact_ref === '') break;
        if (!target.reveals.includes(edit.fact_ref)) {
          target.reveals.push(edit.fact_ref);
          note(`"${edit.fact_ref}" installed in ${target.id}.reveals`);
        }
        break;
      }
      case 'repoint_plant': {
        if (target === undefined) break;
        const payoff = target.pays_off.find((row) => row.fact_ref === edit.fact_ref);
        if (payoff === undefined) break;
        const next = edit.plant_event_id === '' ? null : edit.plant_event_id;
        target.pays_off = target.pays_off.map((row) =>
          row.fact_ref === edit.fact_ref ? { ...row, plant: next } : row,
        );
        note(`${target.id} pays off "${edit.fact_ref}" from ${next ?? 'SEED'}`);
        break;
      }
      case 'drop_payoff': {
        if (target === undefined) break;
        const before = target.pays_off.length;
        target.pays_off = target.pays_off.filter((row) => row.fact_ref !== edit.fact_ref);
        if (target.pays_off.length !== before) note(`${target.id} no longer pays off "${edit.fact_ref}"`);
        break;
      }
      case 'add_payoff': {
        if (target === undefined || edit.fact_ref === '') break;
        if (target.pays_off.some((row) => row.fact_ref === edit.fact_ref)) break;
        target.pays_off.push({
          fact_ref: edit.fact_ref,
          plant: edit.plant_event_id === '' ? null : edit.plant_event_id,
        });
        note(`${target.id} now pays off "${edit.fact_ref}"`);
        break;
      }
      case 'drop_reveal': {
        if (target === undefined) break;
        const before = target.reveals.length;
        target.reveals = target.reveals.filter((fact) => fact !== edit.fact_ref);
        if (target.reveals.length !== before) note(`${target.id} no longer reveals "${edit.fact_ref}"`);
        break;
      }
      case 'add_beat': {
        if (target === undefined || edit.text === '') break;
        target.beats.push(edit.text);
        note(`${target.id} gained a beat`);
        break;
      }
      case 'seed_fact': {
        if (edit.fact_ref === '' || edit.character_id === '') break;
        if (seed.character_knowledge.some((row) => row.fact_ref === edit.fact_ref)) break;
        seed = {
          ...seed,
          character_knowledge: [
            ...seed.character_knowledge,
            {
              id: `ck_${edit.fact_ref}`,
              character_id: edit.character_id,
              fact_ref: edit.fact_ref,
              learned_at_scene: null,
              bag: {},
            },
          ],
        };
        note(`"${edit.fact_ref}" seeded as known by ${edit.character_id}`);
        break;
      }
    }
  }

  events = events.map((event) => ({ ...event }));
  return { arc: { ...arc, world_model_seed: seed, events }, applied };
}
