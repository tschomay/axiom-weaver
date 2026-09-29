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
import { hiddenAccountProblems, provisionalPackage } from '../authoring/lint-fabula';
import { eventsInOrder, hiddenAccountFacts, type FabulaArc, type FabulaEvent } from '../schema/fabula';
import { mergeHiddenAccount, reachesThroughCauses } from '../schema/facts';
import type { Fact } from '../schema/story-package';

/** A defect worth repairing: lint errors, plus the two warnings §4.1 promotes for generated arcs. */
export interface RepairTarget {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** The warnings `story-authoring-eval.md` §4.1 promotes to gates for a *generated* arc. */
const PROMOTED_WARNINGS = new Set(['unpaid_fact', 'no_required_beats']);

/**
 * Promoted only for a mystery (#180): "the true account, assembled only from what the reader has
 * already been shown" is that shape's whole point, so a concealed fact nothing ever reveals is a
 * missing solution there. In another shape a withheld fact left withheld can be a choice.
 */
const MYSTERY_PROMOTED_WARNINGS = new Set(['concealed_never_revealed']);

export interface RepairTargetOptions {
  /** The brief's plot shape, when known. Decides which warnings are gates. */
  readonly plotShapeId?: string;
}

export function repairTargets(
  arc: FabulaArc,
  storyId: string,
  options: RepairTargetOptions = {},
): RepairTarget[] {
  const lint = lintPackage(provisionalPackage(arc, storyId));
  const promoted = (code: string): boolean =>
    PROMOTED_WARNINGS.has(code) ||
    (options.plotShapeId === 'mystery' && MYSTERY_PROMOTED_WARNINGS.has(code));
  return [
    ...lint.errors,
    ...hiddenAccountProblems(arc).filter((problem) => problem.severity === 'error'),
    ...lint.warnings.filter((warning) => promoted(warning.code)),
  ].map(({ code, path, message }) => ({ code, path, message }));
}

// --- Phase 1: the one mechanical repair ---------------------------------------------------

export interface MechanicalRepairResult {
  readonly arc: FabulaArc;
  /** One line per edit applied, for the run report. Empty when nothing needed doing. */
  readonly applied: string[];
}

/** Every repair that needs no model: the facts table's bookkeeping, then plant declarations. */
export function mechanicalRepairs(arc: FabulaArc): MechanicalRepairResult {
  const facts = factTableRepairs(arc);
  const plants = plantDeclarationRepairs(facts.arc);
  const secrets = secretRevealRepairs(plants.arc);
  return { arc: secrets.arc, applied: [...facts.applied, ...plants.applied, ...secrets.applied] };
}

/**
 * The two secret-reveal defects with a uniquely determined fix (#196), after plant declarations
 * (which can themselves add a reveal):
 *
 * - A hidden-account fact no event reveals, but an event pays off: that event is where the secret
 *   surfaces, so it is declared there. Nothing is inferred — the generator already put the fact
 *   on that event.
 * - A fact two events reveal: the first reveal stands and the later event retells it
 *   (`recounts`); a payoff planted at the later event is re-pointed at the first.
 */
export function secretRevealRepairs(arc: FabulaArc): MechanicalRepairResult {
  const applied: string[] = [];
  const events = eventsInOrder(arc).map((event) => ({
    ...event,
    reveals: [...event.reveals],
    recounts: [...event.recounts],
    pays_off: event.pays_off.map((payoff) => ({ ...payoff })),
  }));

  for (const fact of hiddenAccountFacts(arc)) {
    if (events.some((event) => event.reveals.includes(fact))) continue;
    const surfacing = events.find((event) => event.pays_off.some((payoff) => payoff.fact_ref === fact));
    if (surfacing === undefined) continue;
    surfacing.reveals.push(fact);
    applied.push(`declare_fact_at_event: hidden "${fact}" installed in ${surfacing.id}.reveals`);
  }

  const firstReveal = new Map<string, string>();
  const movedTo = new Map<string, string>();
  for (const event of events) {
    event.reveals = [...new Set(event.reveals)].filter((fact) => {
      const first = firstReveal.get(fact);
      if (first === undefined) {
        firstReveal.set(fact, event.id);
        return true;
      }
      if (!event.recounts.includes(fact)) event.recounts.push(fact);
      movedTo.set(`${fact}@${event.id}`, first);
      applied.push(`revealed_twice: ${event.id} now recounts "${fact}", first revealed in ${first}`);
      return false;
    });
  }
  for (const event of events) {
    event.pays_off = event.pays_off.map((payoff) => {
      const first = payoff.plant === null ? undefined : movedTo.get(`${payoff.fact_ref}@${payoff.plant}`);
      return first === undefined ? payoff : { ...payoff, plant: first };
    });
  }

  return applied.length === 0 ? { arc, applied } : { arc: { ...arc, events }, applied };
}

/**
 * The facts table's shape errors (ADR 0022 decision 6), fixed without a model: they are
 * bookkeeping, and the closed edit vocabulary below deliberately has no fact edits.
 *
 * A duplicate keeps its first statement; a cause the arc never states is dropped; and a table
 * edge that would close a cycle — checked against the hidden account's own chain first, which
 * wins because it was written as the incident's order — is dropped.
 */
export function factTableRepairs(arc: FabulaArc): MechanicalRepairResult {
  if (arc.facts.length === 0) return { arc, applied: [] };
  const applied: string[] = [];

  const unique: Fact[] = [];
  for (const fact of arc.facts) {
    if (unique.some((kept) => kept.fact_ref === fact.fact_ref)) {
      applied.push(`fact_duplicate: second statement for "${fact.fact_ref}" dropped`);
      continue;
    }
    unique.push({ ...fact, caused_by: [...fact.caused_by] });
  }

  const known = new Set([
    ...unique.map((fact) => fact.fact_ref),
    ...arc.hidden_account.flatMap((step) => step.establishes),
  ]);
  for (const fact of unique) {
    fact.caused_by = fact.caused_by.filter((cause) => {
      if (known.has(cause)) return true;
      applied.push(`fact_unknown_cause: "${fact.fact_ref}" no longer caused_by unstated "${cause}"`);
      return false;
    });
  }

  const graph = new Map(
    mergeHiddenAccount([], arc.hidden_account).map((fact) => [fact.fact_ref, fact]),
  );
  for (const fact of unique) {
    const node = graph.get(fact.fact_ref) ?? { ...fact, caused_by: [] };
    graph.set(fact.fact_ref, node);
    fact.caused_by = fact.caused_by.filter((cause) => {
      if (cause === fact.fact_ref || reachesThroughCauses(graph, cause, fact.fact_ref)) {
        applied.push(`fact_cycle: "${fact.fact_ref}" no longer caused_by "${cause}"`);
        return false;
      }
      if (!node.caused_by.includes(cause)) node.caused_by = [...node.caused_by, cause];
      return true;
    });
  }

  return applied.length === 0 ? { arc, applied } : { arc: { ...arc, facts: unique }, applied };
}

/**
 * Install declarations for plants the generator named but did not declare.
 *
 * Only applied where the named plant event exists *and* strictly precedes the payoff — if either
 * is false the link itself is wrong, which is an authoring question and belongs to the model pass.
 */
function plantDeclarationRepairs(arc: FabulaArc): MechanicalRepairResult {
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
  'add_hidden_cause',
] as const;

export const ArcEditSchema = z.object({
  kind: z.enum(ARC_EDIT_KINDS),
  /** The event the edit lands on, the payoff event for the payoff edits, or the hidden step. */
  event_id: z.string().default(''),
  fact_ref: z.string().default(''),
  /**
   * For `repoint_plant` / `add_payoff`: the planting event, or '' for a seed-grounded payoff.
   * For `add_hidden_cause`: the earlier hidden step the step follows from.
   */
  plant_event_id: z.string().default(''),
  /** For `add_beat`; for `add_hidden_cause`, an optional rewritten summary that says why. */
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
              description:
                'Empty string means seed-grounded (plant: null). For add_hidden_cause: the earlier hidden step.',
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
      ...(event.conceals.length === 0 ? [] : [`   conceals: [${event.conceals.join(', ')}]`]),
      `   pays_off: [${event.pays_off.map((p) => `${p.fact_ref} <- ${p.plant ?? 'SEED'}`).join(', ')}]`,
      `   beats: ${event.beats.length}`,
    ].join('\n'),
  );

  const seeded = arc.world_model_seed.character_knowledge
    .filter((row) => row.learned_at_scene === null)
    .map((row) => `${row.fact_ref} (known by ${row.character_id})`);

  const hidden = [...arc.hidden_account]
    .sort((a, b) => a.sequence - b.sequence)
    .map(
      (step) =>
        `${step.sequence}. ${step.id} — ${step.summary}\n   caused_by: [${step.caused_by.join(', ')}]  establishes: [${step.establishes.join(', ')}]`,
    );

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
    ...(hidden.length === 0 ? [] : ['THE HIDDEN ACCOUNT (what actually happened)', ...hidden, '']),
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
    'A concealed fact no later event reveals: declare_fact_at_event on the later event where the',
    'truth comes out.',
    'A hidden-account fact no event reveals (hidden_fact_never_revealed): declare_fact_at_event on',
    'the event whose summary discloses it to the reader — never on an event where it stays secret.',
    'A hidden step with no cause: add_hidden_cause — event_id is the step, plant_event_id the earlier',
    'step it follows from, and text a rewritten summary that says WHY, when a person acts.',
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
  const hiddenAccount = arc.hidden_account.map((step) => ({ ...step, caused_by: [...step.caused_by] }));

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
      case 'add_hidden_cause': {
        const step = hiddenAccount.find((row) => row.id === edit.event_id);
        const cause = hiddenAccount.find((row) => row.id === edit.plant_event_id);
        if (step === undefined || cause === undefined || cause.sequence >= step.sequence) break;
        if (!step.caused_by.includes(cause.id)) step.caused_by.push(cause.id);
        if (edit.text !== '') step.summary = edit.text;
        note(`${step.id} now caused_by ${cause.id}`);
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
  return { arc: { ...arc, world_model_seed: seed, events, hidden_account: hiddenAccount }, applied };
}
