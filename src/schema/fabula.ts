/**
 * The Fabula event: the one shape both upstream authoring entry points emit.
 *
 * [ADR 0019](../../docs/adr/0019-fabula-only-packages.md) decision 2. This shape started life in
 * `src/arc/fabula.ts`, written by the generator (#119) for its own output, and extraction (#117)
 * then converged on its field names without being able to fill four of them. The ADR settled that
 * disagreement by splitting the fields *by what is recoverable at the Fabula layer* and moving the
 * result here, alongside `story-package.ts` and `manuscript.ts`, so neither entry point owns the
 * contract the other has to satisfy.
 *
 * The split, restated so it can be read off the schema below:
 *
 * | Group | Fields | Why |
 * | --- | --- | --- |
 * | Always required | `id`, `sequence`, `summary`, `location_id`, `characters_present`, `beats`, `pays_off`, `state_changes` | both entry points always produce these |
 * | Optional here, filled by segmentation | `pov`, `dramatic_function`, `reveals`, `conceals` | Syuzhet properties of a *scene*; a generator has them because it authors both layers at once, extraction structurally cannot before boundaries exist |
 * | Optional, best-effort | `caused_by` | attempted by generation, not by extraction; neither omission is an error |
 *
 * Anything else an entry point measured — extraction's `story_time`, `time_anchor`,
 * `narrated_index`, `source_span` — rides as additional keys on individual events, which is why
 * the event is a **`looseObject`**. A plain `z.object` would *strip* those keys on parse rather
 * than reject them, so a segmentation reading its optional signals off a parsed event would
 * silently see none of them and report that the entry point had supplied none — the same class of
 * quiet, plausible-looking wrong answer as #117's collapsed windows. Nothing in the shared
 * contract requires them, and `src/segmentation` reads them only as optional signals.
 *
 * A generator that wants its own stronger guarantee states it locally rather than tightening this
 * one — see `GeneratedFabulaArcSchema` in `src/arc/fabula.ts`.
 */

import { z } from 'zod';

import { FactSchema, WorldModelSeedSchema, type Fact, type SceneState } from './story-package';
import { mergeHiddenAccount } from './facts';

const slug = z.string().min(1);

/**
 * The World Model columns a Fabula event may change.
 *
 * Deliberately a closed enum rather than free text. `src/schema/tiers.ts` is the authority on what
 * columns exist, and the cross-reference pass rejects anything else with `unknown_column`; naming
 * the three that carry a tier and matter at this layer keeps the response schema lean (it is
 * billed as input on every call and is not cacheable) and removes a whole class of repair.
 */
export const EVENT_STATE_COLUMNS = ['location_id', 'status', 'goal'] as const;
export type EventStateColumn = (typeof EVENT_STATE_COLUMNS)[number];

export const StateChangeSchema = z.object({
  entity_id: slug,
  column: z.enum(EVENT_STATE_COLUMNS),
  value: z.union([z.string(), z.null()]),
});

export const FabulaPayoffSchema = z.object({
  fact_ref: z.string().min(1),
  /** The event that plants it, or `null` for a fact true from the World Model seed. */
  plant: slug.nullable(),
});

/**
 * One event of the Fabula, in chronological order.
 *
 * `caused_by` has no counterpart in the Story Package schema and is not smuggled toward one: it
 * exists because `docs/research/llm-arc-generation-prior-art.md` §3 reports that models decide
 * narrative causality by positional shortcut unless the causal graph is made an explicit object,
 * and because §4.2 of the rubric judges causal follow-through. It rides along in the deliverable's
 * `_fabula` block, where segmentation uses it as one boundary signal among several.
 */
export const FabulaEventSchema = z.looseObject({
  id: slug,
  /** Chronological position, 1-based. Fabula order, not told order. */
  sequence: z.number().int().positive(),
  summary: z.string().min(1),
  /**
   * A property of the *scene* this event lands in, so optional here (ADR 0019 decision 2).
   * `src/segmentation` assigns it per scene; the Fabula layer may leave it blank.
   */
  pov: slug.optional(),
  /**
   * `null` where the entry point could not name one. The projection and segmentation both carry
   * the nearest earlier named location forward rather than inventing one.
   */
  location_id: slug.nullable().default(null),
  characters_present: z.array(slug).default([]),
  /** Scene-level, same as `pov` — a turning point is a judgment about a scene, not an event. */
  dramatic_function: z.string().min(1).optional(),
  /** What must happen. Becomes `required_beats` downstream; never empty (rubric §4.1). */
  beats: z.array(z.string()).default([]),
  /** Earlier event ids this one follows *from*, not merely after. */
  caused_by: z.array(slug).default([]),
  /** `fact_ref`s the reader learns here. Becomes `reader_must_learn`. */
  reveals: z.array(z.string()).default([]),
  /** `fact_ref`s deliberately withheld here. Becomes `must_stay_hidden`. */
  conceals: z.array(z.string()).default([]),
  /**
   * `fact_ref`s the reader already learned that this event retells — an inquiry, a confession.
   * Becomes the scene's `recounts` (ADR 0022's amendment). Best-effort, like `caused_by`.
   */
  recounts: z.array(z.string()).default([]),
  pays_off: z.array(FabulaPayoffSchema).default([]),
  state_changes: z.array(StateChangeSchema).default([]),
});

/**
 * One step of the hidden account (ADR 0022 decision 4): what actually happened, as its own
 * chronological chain, separate from the events that happen on the page.
 *
 * A mystery's events are usually the *discovery*; its hidden account is the incident being
 * discovered. `caused_by` names earlier steps; `establishes` names the facts the step makes true,
 * which is how the chain reaches the writer — as fact statements (decision 5), never as scenes.
 */
export const HiddenStepSchema = z.object({
  id: slug,
  sequence: z.number().int().positive(),
  summary: z.string().min(1),
  caused_by: z.array(slug).default([]),
  establishes: z.array(z.string().min(1)).default([]),
});

export const FabulaArcSchema = z.object({
  title: z.string().min(1),
  world_model_seed: WorldModelSeedSchema,
  events: z.array(FabulaEventSchema).min(1),
  /** Best-effort, like `caused_by`: generation fills it, extraction does not (yet). */
  hidden_account: z.array(HiddenStepSchema).default([]),
  /** Statements for the arc's fact_refs (ADR 0022 decision 1). */
  facts: z.array(FactSchema).default([]),
});

export type StateChange = z.infer<typeof StateChangeSchema>;
export type FabulaPayoff = z.infer<typeof FabulaPayoffSchema>;
export type FabulaEvent = z.infer<typeof FabulaEventSchema>;
export type FabulaArc = z.infer<typeof FabulaArcSchema>;
export type HiddenStep = z.infer<typeof HiddenStepSchema>;

/** Where the event list rides in the deliverable. A top-level block the loose schema preserves. */
export const FABULA_BLOCK = '_fabula';

export interface FabulaRead {
  readonly arc: FabulaArc;
  /**
   * State changes dropped because they named a column outside `EVENT_STATE_COLUMNS`.
   *
   * `name` is the live case: a real, tiered World Model column, but not one this layer admits,
   * and an extractor that recovers a rename emits it. Dropping it is what #117's scoring already
   * did by hand; counting it is what keeps the drop from being silent.
   */
  readonly dropped_state_changes: number;
}

/**
 * Read a Fabula-only package back into an arc.
 *
 * The inverse of what both entry points write, in one place: extraction's `fabulaBlock`
 * (`src/extraction/pipeline.ts`) and generation's `draftPackage` (`src/arc/fabula.ts`) produce the
 * same envelope, and before this existed three callers each re-derived the read by hand. Parsing
 * is the shared `FabulaArcSchema`, so an event carrying extraction-only keys keeps them — and an
 * event missing `pov` or `dramatic_function` is accepted, which is the whole point of ADR 0019's
 * field split.
 */
export function readFabulaArc(envelope: unknown): FabulaRead {
  const record = (envelope ?? {}) as Record<string, unknown>;
  const block = record[FABULA_BLOCK] as
    | { events?: unknown; hidden_account?: unknown; facts?: unknown }
    | undefined;
  const metadata = record['metadata'] as { title?: unknown } | undefined;
  const known = new Set<string>(EVENT_STATE_COLUMNS);

  let dropped = 0;
  const events = (Array.isArray(block?.events) ? block.events : []).map((raw) => {
    const event = { ...(raw as Record<string, unknown>) };
    if (Array.isArray(event['state_changes'])) {
      const kept = (event['state_changes'] as Array<Record<string, unknown>>).filter((change) =>
        known.has(String(change['column'])),
      );
      dropped += (event['state_changes'] as unknown[]).length - kept.length;
      event['state_changes'] = kept;
    }
    return event;
  });

  return {
    arc: FabulaArcSchema.parse({
      title:
        typeof metadata?.title === 'string' && metadata.title !== '' ? metadata.title : 'untitled',
      world_model_seed: record['world_model_seed'],
      events,
      hidden_account: Array.isArray(block?.hidden_account) ? block.hidden_account : [],
      facts: Array.isArray(block?.facts) ? block.facts : [],
    }),
    dropped_state_changes: dropped,
  };
}

/** The `story_id` a Fabula-only envelope carries, or a caller-supplied stand-in. */
export function storyIdOf(envelope: unknown, fallback = 'candidate'): string {
  const id = (envelope as Record<string, unknown> | null)?.['story_id'];
  return typeof id === 'string' && id !== '' ? id : fallback;
}

/**
 * The envelope's Voice Card block, carried through segmentation untouched (#182). Generate fills
 * one from the arc's plot shape; an Extract envelope has none, and gets `{}` as before.
 */
export function voiceCardOf(envelope: unknown): Record<string, unknown> {
  const block = (envelope as Record<string, unknown> | null)?.['voice_card'];
  return typeof block === 'object' && block !== null && !Array.isArray(block)
    ? { ...(block as Record<string, unknown>) }
    : {};
}

/**
 * The `facts` block a package built from this arc carries (ADR 0022 decision 5): the arc's table
 * with its hidden account folded in. Spread into the package; empty adds no key at all, so a
 * package from an arc without either is unchanged.
 */
export function packageFacts(arc: FabulaArc): { facts?: Fact[] } {
  const facts = mergeHiddenAccount(arc.facts, arc.hidden_account);
  return facts.length === 0 ? {} : { facts };
}

/** Every fact the hidden account establishes (ADR 0022 decision 4), in step order, once each. */
export function hiddenAccountFacts(arc: { hidden_account: readonly HiddenStep[] }): string[] {
  const steps = [...arc.hidden_account].sort((a, b) => a.sequence - b.sequence);
  return [...new Set(steps.flatMap((step) => step.establishes))];
}

/**
 * The hidden account's facts as a package carries them: in the `_fabula` block a generated or
 * extracted package keeps, and a Fabula projection repeats. A hand-authored package has none.
 */
export function hiddenAccountFactsOf(pkg: unknown): string[] {
  const block = (pkg as Record<string, unknown> | null)?.[FABULA_BLOCK] as
    | { hidden_account?: unknown }
    | null
    | undefined;
  const steps = HiddenStepSchema.array().safeParse(block?.hidden_account ?? []);
  return steps.success ? hiddenAccountFacts({ hidden_account: steps.data }) : [];
}

/** Events in Fabula order. `sequence` is the field; array position is incidental. */
export function eventsInOrder(arc: FabulaArc): FabulaEvent[] {
  return [...arc.events].sort((a, b) => a.sequence - b.sequence);
}

/** Collapse an event's `state_changes` into the `exit_state` block a Scene Card carries. */
export function exitStateFor(event: FabulaEvent): SceneState {
  const state: Record<string, Record<string, string | null>> = {};
  for (const change of event.state_changes) {
    const row = state[change.entity_id] ?? {};
    row[change.column] = change.value;
    state[change.entity_id] = row;
  }
  return state as SceneState;
}
