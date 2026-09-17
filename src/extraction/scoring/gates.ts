/**
 * Gate G0, and the honest problem with applying it to a pre-segmentation artifact.
 *
 * `docs/agents/story-authoring-eval.md` §1 states G0 as `lintPackage(candidate).publishable ===
 * true`, "non-negotiable, both entry points", and §3 makes it the thing that has to hold before
 * any other number is worth reporting. As written it **cannot** pass for a Fabula-only artifact,
 * and the reason is structural rather than a defect in the extraction: `lintPackage` parses
 * against `StoryPackageSchema`, whose `scene_cards` is `.min(1)`, while #117's output contract
 * deliberately leaves `scene_cards` empty. The lint stops at the shape check, emits
 * `schema.too_small`, and — because a shape violation stops the pass in `src/authoring/lint.ts` —
 * never runs a single reference check. A pipeline that stopped there would report "G0: failed"
 * and learn nothing.
 *
 * [ADR 0019](../../../docs/adr/0019-fabula-only-packages.md) settled what to do instead, and this
 * module now calls it rather than carrying its own copy: `lintFabulaArc`
 * (`src/authoring/lint-fabula.ts`) projects the event list onto one provisional Scene Card per
 * event so the *real* linter rules on the *real* graph. That is exactly what §1 demands — "Do not
 * write a second one — cite these" — and it is strictly more than a seed-only check, because
 * projecting the events puts `location_id`, `characters_present` and every `exit_state` entity in
 * front of the cross-reference pass.
 *
 * The substitutions the projection needs (`pov` from the first participant, `location_id` carried
 * forward, a placeholder `dramatic_function`) are counted rather than hidden, per ADR 0019
 * decision 4 — a G0 pass bought entirely with fallbacks is not a G0 pass. So is the projection's
 * mandatory note, which rides into the report so no reader sees "projected: passed" without it.
 */

import { readFabulaArc, type FabulaArc } from '../../schema/fabula';
import { DraftStoryPackageSchema } from '../../schema/manuscript';
import { WorldModelSeedSchema } from '../../schema/story-package';
import { lintPackage, type LintResult, type PackageProblem } from '../../authoring/lint';
import {
  lintFabulaArc,
  type ProjectionSubstitutions,
} from '../../authoring/lint-fabula';

/** The one code a seed-only package is expected to trip, because it has no Scene Cards yet. */
export const EXPECTED_PRE_SEGMENTATION_CODE = 'schema.too_small';

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
   * `lintFabulaArc` on the one-event-to-one-scene projection — the gate that actually bites.
   * This is the number to read as G0 for a pre-segmentation artifact.
   */
  readonly projected: {
    readonly note: string;
    readonly passed: boolean;
    readonly errors: readonly PackageProblem[];
    readonly warnings: readonly PackageProblem[];
    readonly scene_count: number;
    readonly substitutions: ProjectionSubstitutions;
  };
  readonly seed_parse_errors: readonly string[];
  readonly draft_parse_ok: boolean;
}

const NO_SUBSTITUTIONS: ProjectionSubstitutions = {
  pov_from_first_participant: 0,
  pov_unavailable: 0,
  location_carried_forward: 0,
  location_unavailable: 0,
  dramatic_function_projected: 0,
};

export function gateG0(candidate: unknown): G0Report {
  const deliverableLint: LintResult = lintPackage(candidate);
  const unexpected = deliverableLint.errors.filter(
    (problem) =>
      !(problem.code === EXPECTED_PRE_SEGMENTATION_CODE && problem.path === 'scene_cards'),
  );
  const deliverable = {
    publishable: deliverableLint.publishable,
    errors: deliverableLint.errors,
    warnings: deliverableLint.warnings,
    unexpected_errors: unexpected,
  };

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

  const unprojectable = (reason: string): G0Report => ({
    deliverable,
    projected: {
      note: reason,
      passed: false,
      errors: [],
      warnings: [],
      scene_count: 0,
      substitutions: NO_SUBSTITUTIONS,
    },
    seed_parse_errors: seedParseErrors,
    draft_parse_ok: draft.success,
  });

  if (!draft.success || seedParse === null || !seedParse.success) {
    return unprojectable('the candidate did not parse far enough to be projected');
  }

  // Read through the *shared* reader (ADR 0019 decision 2) rather than re-derived here: an event
  // missing `pov`/`dramatic_function` is admissible at this layer, and one carrying extraction's
  // own `story_time`/`source_span` keeps them.
  let arc: FabulaArc;
  try {
    arc = readFabulaArc({ ...(candidate as object), world_model_seed: seedParse.data }).arc;
  } catch (error) {
    return unprojectable(
      `the _fabula event list did not parse: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const projected = lintFabulaArc(arc, draft.data.story_id || 'candidate');

  return {
    deliverable,
    projected: {
      note: projected.note,
      passed: projected.errors.length === 0,
      errors: projected.errors,
      warnings: projected.warnings,
      scene_count: projected.scene_count,
      substitutions: projected.substitutions,
    },
    seed_parse_errors: seedParseErrors,
    draft_parse_ok: true,
  };
}
