/**
 * Gate G0, and the honest problem with applying it to a pre-segmentation artifact.
 *
 * `docs/agents/story-authoring-eval.md` §1 states G0 as `lintPackage(candidate).publishable ===
 * true`, "non-negotiable, both entry points", and §3 makes it the thing that has to hold before
 * any other number is worth reporting. As written it **cannot** pass here, and the reason is
 * structural rather than a defect in the extraction: `lintPackage` parses against
 * `StoryPackageSchema`, whose `scene_cards` is `.min(1)`, while #117's output contract
 * deliberately leaves `scene_cards` empty. The lint stops at the shape check, emits
 * `schema.too_small`, and — because a shape violation stops the pass in `src/authoring/lint.ts` —
 * never runs a single reference check. A pipeline that stopped there would report "G0: failed"
 * and learn nothing.
 *
 * **#119 already solved this and this module reuses its answer rather than inventing a second
 * one.** `provisionalPackage` (`src/arc/fabula.ts`) projects a Fabula event list onto
 * one-provisional-Scene-Card-per-event so the *real* linter rules on the *real* graph. That is
 * exactly what §1 demands — "Do not write a second one — cite these" — and it is strictly more
 * than the seed-only check that stood here before: projecting the events puts `location_id`,
 * `characters_present` and every `exit_state` entity in front of the cross-reference pass, which
 * a seed-only gate never sees.
 *
 * Two substitutions are needed to project, and they are counted rather than hidden.
 * `provisionalPackage` needs a `pov` and a `location_id` per scene; extraction has neither as a
 * recoverable fact (see `FIELDS_NOT_RECOVERED` in `../pipeline.ts`). So `pov` falls back to the
 * event's first participant and `location_id` carries forward from the last event that named one.
 * Both are projection artifacts of the measuring instrument, never of the deliverable — the
 * emitted package still carries `scene_cards: []` — and `substitutions` reports how many were
 * needed, because a G0 pass bought entirely with fallbacks is not a G0 pass.
 *
 * Nothing in `src/authoring` is touched to make this work; that is a #113 hard boundary.
 */

import { FABULA_BLOCK, provisionalPackage, type FabulaArc, type FabulaEvent } from '../../arc/fabula';
import { DraftStoryPackageSchema } from '../../schema/manuscript';
import { WorldModelSeedSchema } from '../../schema/story-package';
import { lintPackage, type LintResult, type PackageProblem } from '../../authoring/lint';

/** The one code a seed-only package is expected to trip, because it has no Scene Cards yet. */
export const EXPECTED_PRE_SEGMENTATION_CODE = 'schema.too_small';

/** What a provisional scene's `dramatic_function` says, since extraction has not recovered one. */
export const PROJECTED_FUNCTION = '(projection: dramatic_function not recovered before segmentation)';

export interface G0Report {
  /** `lintPackage` on the deliverable verbatim, including the expected structural failure. */
  readonly deliverable: {
    readonly publishable: boolean;
    readonly errors: readonly PackageProblem[];
    readonly warnings: readonly PackageProblem[];
    /** Errors that are *not* the expected empty-`scene_cards` failure. */
    readonly unexpected_errors: readonly PackageProblem[];
  };
  /**
   * `lintPackage` on the one-event-to-one-scene projection — the gate that actually bites.
   * This is the number to read as G0 for a pre-segmentation artifact.
   */
  readonly projected: {
    readonly passed: boolean;
    readonly errors: readonly PackageProblem[];
    readonly warnings: readonly PackageProblem[];
    readonly scene_count: number;
    readonly substitutions: {
      readonly pov_from_first_participant: number;
      readonly pov_unavailable: number;
      readonly location_carried_forward: number;
      readonly location_unavailable: number;
    };
  };
  readonly seed_parse_errors: readonly string[];
  readonly draft_parse_ok: boolean;
}

interface BlockEvent {
  id?: unknown;
  sequence?: unknown;
  summary?: unknown;
  location_id?: unknown;
  characters_present?: unknown;
  beats?: unknown;
  state_changes?: unknown;
}

export function gateG0(candidate: unknown): G0Report {
  const deliverableLint: LintResult = lintPackage(candidate);
  const unexpected = deliverableLint.errors.filter(
    (problem) =>
      !(problem.code === EXPECTED_PRE_SEGMENTATION_CODE && problem.path === 'scene_cards'),
  );

  const draft = DraftStoryPackageSchema.safeParse(candidate);
  const seedParse = draft.success
    ? WorldModelSeedSchema.safeParse(draft.data.world_model_seed)
    : null;
  const seedParseErrors =
    seedParse === null
      ? ['draft parse failed, so the seed was never parsed']
      : seedParse.success
        ? []
        : seedParse.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);

  const substitutions = {
    pov_from_first_participant: 0,
    pov_unavailable: 0,
    location_carried_forward: 0,
    location_unavailable: 0,
  };

  if (!draft.success || seedParse === null || !seedParse.success) {
    return {
      deliverable: {
        publishable: deliverableLint.publishable,
        errors: deliverableLint.errors,
        warnings: deliverableLint.warnings,
        unexpected_errors: unexpected,
      },
      projected: {
        passed: false,
        errors: [],
        warnings: [],
        scene_count: 0,
        substitutions,
      },
      seed_parse_errors: seedParseErrors,
      draft_parse_ok: draft.success,
    };
  }

  const seed = seedParse.data;
  const block = (candidate as Record<string, unknown>)[FABULA_BLOCK] as
    | { events?: unknown }
    | undefined;
  const rawEvents: BlockEvent[] = Array.isArray(block?.events) ? (block.events as BlockEvent[]) : [];

  const fallbackLocation = seed.locations[0]?.id ?? '';
  let lastLocation = '';

  const events: FabulaEvent[] = rawEvents.map((raw, index) => {
    const characters = Array.isArray(raw.characters_present)
      ? [...(raw.characters_present as string[])]
      : [];

    let pov = characters[0] ?? '';
    if (pov === '') {
      // No character took part in this event at all. The projection still needs a `pov`, and the
      // cross-reference pass additionally requires it to appear in `characters_present`
      // (`pov_absent`), so the stand-in is added to both — otherwise the instrument reports a
      // defect it created itself. An event with no characters is a real finding, but it is a
      // *segmentation* finding for #118, not a broken reference.
      substitutions.pov_unavailable += 1;
      pov = seed.characters[0]?.id ?? '';
      if (pov !== '') characters.push(pov);
    } else {
      substitutions.pov_from_first_participant += 1;
    }

    let location = typeof raw.location_id === 'string' ? raw.location_id : '';
    if (location === '') {
      location = lastLocation === '' ? fallbackLocation : lastLocation;
      if (location === '') substitutions.location_unavailable += 1;
      else substitutions.location_carried_forward += 1;
    }
    lastLocation = location === '' ? lastLocation : location;

    const beats = Array.isArray(raw.beats) ? (raw.beats as string[]) : [];

    return {
      id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `ev_${index + 1}`,
      sequence: typeof raw.sequence === 'number' ? raw.sequence : index + 1,
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      pov,
      location_id: location,
      characters_present: characters,
      dramatic_function: PROJECTED_FUNCTION,
      beats,
      caused_by: [],
      reveals: [],
      conceals: [],
      pays_off: [],
      state_changes: normalizeStateChanges(raw.state_changes),
    };
  });

  if (events.length === 0) {
    return {
      deliverable: {
        publishable: deliverableLint.publishable,
        errors: deliverableLint.errors,
        warnings: deliverableLint.warnings,
        unexpected_errors: unexpected,
      },
      projected: { passed: false, errors: [], warnings: [], scene_count: 0, substitutions },
      seed_parse_errors: seedParseErrors,
      draft_parse_ok: true,
    };
  }

  const arc: FabulaArc = {
    title: typeof draft.data.metadata?.title === 'string' ? draft.data.metadata.title : 'untitled',
    world_model_seed: seed,
    events,
  };
  const projectedLint = lintPackage(provisionalPackage(arc, draft.data.story_id || 'candidate'));

  return {
    deliverable: {
      publishable: deliverableLint.publishable,
      errors: deliverableLint.errors,
      warnings: deliverableLint.warnings,
      unexpected_errors: unexpected,
    },
    projected: {
      passed: projectedLint.publishable,
      errors: projectedLint.errors,
      warnings: projectedLint.warnings,
      scene_count: events.length,
      substitutions,
    },
    seed_parse_errors: seedParseErrors,
    draft_parse_ok: true,
  };
}

function normalizeStateChanges(raw: unknown): FabulaEvent['state_changes'] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(['location_id', 'status', 'goal']);
  return (raw as Array<Record<string, unknown>>)
    // `name` is a real, tiered column but not one `StateChangeSchema` admits; dropping it for the
    // projection keeps the measuring instrument inside #119's shape without touching either.
    .filter((change) => typeof change['column'] === 'string' && allowed.has(change['column']))
    .map((change) => ({
      entity_id: String(change['entity_id'] ?? ''),
      column: change['column'] as 'location_id' | 'status' | 'goal',
      value:
        typeof change['value'] === 'string' || change['value'] === null
          ? (change['value'] as string | null)
          : String(change['value'] ?? ''),
    }));
}
