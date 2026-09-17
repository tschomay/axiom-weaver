/**
 * Linting a **Fabula-only** artifact, by projecting it onto provisional scenes first.
 *
 * [ADR 0019](../../docs/adr/0019-fabula-only-packages.md) decisions 3–5. Extraction (#117) and
 * generation (#119) both emit a `DraftStoryPackageSchema`-valid object with `world_model_seed`
 * populated, `scene_cards` empty and the event list in the `_fabula` block. `lintPackage` cannot
 * see such a thing at all: it parses against `StoryPackageSchema`, whose `scene_cards` is
 * `.min(1)`, so the whole pass stops on one shape error and none of the checks that matter — the
 * World Model reference pass, the plant-obligation walk (ADR 0004) — ever run.
 *
 * Both tickets independently reached for the same fix: project each event onto one provisional
 * Scene Card so the *real* linter rules on the *real* graph. This module is that projection,
 * lifted out of `src/arc/` so there is one of it.
 *
 * **What this is not.** `lintFabulaArc` is not a publish gate and cannot be mistaken for one:
 *
 * - It returns a `FabulaProjectionLintResult`, which has **no `publishable` field**. Only
 *   `LintResult` has one, and only `lintPackage` produces a `LintResult`.
 * - It carries a mandatory `note` every caller must surface alongside the problems, so there is no
 *   short output path that reports "clean" without saying what was checked.
 * - `publishManuscript` calls `lintPackage` on the real Manuscript and nothing else. Even if this
 *   were wired in by mistake, a Fabula-only package has `scene_cards: []` by construction and the
 *   real linter rejects it on shape alone, unconditionally.
 *
 * Once `src/segmentation` turns a Fabula-only artifact into real Scene Cards, none of this
 * applies: the result is an ordinary Story Package, validated and published through the one
 * existing gate like any other.
 */

import {
  eventsInOrder,
  exitStateFor,
  type FabulaArc,
  type FabulaEvent,
} from '../schema/fabula';
import type { SceneCard, StoryPackage } from '../schema/story-package';
import { lintPackage, type PackageProblem } from './lint';

/**
 * The sentence every report of a `FabulaProjectionLintResult` prints. Fixed text, by ADR 0019
 * decision 5 — a caller that wants to say less has to say this much.
 */
export const FABULA_PROJECTION_NOTE =
  'This is a projection of Fabula-only content onto provisional scenes. It is not a Story ' +
  'Package and has not been checked for publish-readiness — Scene Cards, the Voice Card, and ' +
  'everything the real linter checks about them still do not exist.';

/** What a provisional scene's `dramatic_function` says when the Fabula layer did not name one. */
export const PROJECTED_FUNCTION =
  '(projection: dramatic_function not recovered before segmentation)';

/**
 * How many scene-level fields the projection had to stand in for.
 *
 * ADR 0019 decision 4: a field the projection cannot recover gets a deterministic, *counted*
 * substitution, never a silent guess. A run with zero substitutions and a run with fifty are
 * different results at the same pass/fail outcome, and a G0 bought entirely with fallbacks is not
 * a G0.
 */
export interface ProjectionSubstitutions {
  /** `pov` taken from the event's first `characters_present` entry. */
  readonly pov_from_first_participant: number;
  /** The event named no characters at all, so a seed character stood in — and was added to the cast. */
  readonly pov_unavailable: number;
  /** `location_id` carried forward from the nearest earlier event that named one. */
  readonly location_carried_forward: number;
  /** Nothing to carry forward and no seed location either. */
  readonly location_unavailable: number;
  /** `dramatic_function` replaced by `PROJECTED_FUNCTION`. */
  readonly dramatic_function_projected: number;
}

export interface FabulaProjection {
  readonly package: StoryPackage;
  readonly substitutions: ProjectionSubstitutions;
}

export interface FabulaProjectionLintResult {
  /** `FABULA_PROJECTION_NOTE`. Present so no caller can report this result without it. */
  readonly note: string;
  readonly problems: readonly PackageProblem[];
  readonly errors: readonly PackageProblem[];
  readonly warnings: readonly PackageProblem[];
  /** How many provisional scenes were linted — one per event. */
  readonly scene_count: number;
  readonly substitutions: ProjectionSubstitutions;
}

/**
 * Project the arc onto a Story Package whose Scene Cards are one-per-event.
 *
 * The measuring instrument, not the deliverable. Everything `lintPackage` needs is here and
 * nothing that would flatter it is: `required_beats` is the event's own beats (so
 * `no_required_beats` still fires on an empty one), `reader_must_learn` is the event's own
 * reveals (so `plant_not_declared` still fires), and `voice_card` is left `{}` rather than filled
 * with a preset — a Fabula-layer deliverable has no Voice Card, and `voice_card_untouched` firing
 * is the truth about it.
 *
 * One-event-to-one-scene is the projection that preserves the graph exactly: `pays_off` edges name
 * event ids, event order is scene order, and real segmentation downstream can only ever merge
 * events. A merge moves a plant later, at worst into the same scene as its payoff — which is why
 * `src/segmentation/boundaries.ts` treats an unpaid plant/payoff span as a merge it must refuse.
 */
export function projectFabulaArc(arc: FabulaArc, storyId: string): FabulaProjection {
  const substitutions = {
    pov_from_first_participant: 0,
    pov_unavailable: 0,
    location_carried_forward: 0,
    location_unavailable: 0,
    dramatic_function_projected: 0,
  };

  const fallbackLocation = arc.world_model_seed.locations[0]?.id ?? '';
  let lastLocation = '';

  const scenes: SceneCard[] = eventsInOrder(arc).map((event: FabulaEvent) => {
    const characters = [...event.characters_present];

    let pov = event.pov ?? '';
    if (pov === '') {
      pov = characters[0] ?? '';
      if (pov === '') {
        // No character took part in this event at all. The projection still needs a `pov`, and the
        // cross-reference pass additionally requires it to appear in `characters_present`
        // (`pov_absent`), so the stand-in is added to both — otherwise the instrument reports a
        // defect it created itself. An event with no characters is a real finding, but it is a
        // *segmentation* finding, not a broken reference.
        substitutions.pov_unavailable += 1;
        pov = arc.world_model_seed.characters[0]?.id ?? '';
        if (pov !== '') characters.push(pov);
      } else {
        substitutions.pov_from_first_participant += 1;
      }
    }

    let location = event.location_id ?? '';
    if (location === '') {
      location = lastLocation === '' ? fallbackLocation : lastLocation;
      if (location === '') substitutions.location_unavailable += 1;
      else substitutions.location_carried_forward += 1;
    }
    lastLocation = location === '' ? lastLocation : location;

    let dramaticFunction = event.dramatic_function ?? '';
    if (dramaticFunction === '') {
      substitutions.dramatic_function_projected += 1;
      dramaticFunction = PROJECTED_FUNCTION;
    }

    return {
      id: event.id,
      order: event.sequence,
      pov,
      location_id: location,
      characters_present: characters,
      dramatic_function: dramaticFunction,
      entry_state: {},
      exit_state: exitStateFor(event),
      required_beats: event.beats,
      reader_must_learn: event.reveals,
      must_stay_hidden: event.conceals,
      force_reintroduce: [],
      invariants: [],
      pays_off: event.pays_off.map((payoff) => ({ ...payoff })),
    };
  });

  return {
    package: {
      schema_version: '1.0',
      package_version: 1,
      story_id: storyId,
      world_model_seed: arc.world_model_seed,
      scene_cards: scenes,
      voice_card: {},
      metadata: { title: arc.title },
    },
    substitutions,
  };
}

/** The projected package alone, for callers that only want something to hand `lintPackage`. */
export function provisionalPackage(arc: FabulaArc, storyId: string): StoryPackage {
  return projectFabulaArc(arc, storyId).package;
}

/**
 * G0 for a Fabula-only artifact: project, then run the *real* linter on the projection.
 *
 * "G0 passed" here means "the projection lints clean", never "`scene_cards` is non-empty" — and
 * the returned `note` is what keeps those two readings apart wherever the result is printed.
 */
export function lintFabulaArc(arc: FabulaArc, storyId: string): FabulaProjectionLintResult {
  const projection = projectFabulaArc(arc, storyId);
  const lint = lintPackage(projection.package);
  return {
    note: FABULA_PROJECTION_NOTE,
    problems: lint.problems,
    errors: lint.errors,
    warnings: lint.warnings,
    scene_count: projection.package.scene_cards.length,
    substitutions: projection.substitutions,
  };
}
