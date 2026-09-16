# ADR 0019: Fabula-only packages and how they're validated

## Status

Accepted — settled under [issue #113](https://github.com/tschomay/axiom-weaver/issues/113), after
[#117](https://github.com/tschomay/axiom-weaver/issues/117) (extraction) and
[#119](https://github.com/tschomay/axiom-weaver/issues/119) (generation) independently hit the
same gap and converged on the same workaround without coordinating.

## Context

#113 gave both extraction and generation a shared output contract: a JSON object valid against
`DraftStoryPackageSchema`, `world_model_seed` populated, `scene_cards` left empty — because
segmentation into Scene Cards is #118's job, and both entry points are meant to share it rather
than each inventing their own. Two problems fell out of that contract that #113 explicitly
deferred as "a new ADR-worthy discussion, not something to bend silently into these tickets":

1. **`lintPackage` cannot see a Fabula-only package at all.** It parses input against
   `StoryPackageSchema`, whose `scene_cards` is `.min(1)`
   (`src/schema/story-package.ts:162`) — a shape violation, so gate G0
   (`docs/agents/story-authoring-eval.md` §1) gets one schema error and zero of the checks that
   actually matter: the World Model reference pass and the plant-obligation walk (ADR 0004).
   Neither ticket wrote a second opinion about validity to get around this — §1 of the rubric
   explicitly forbids that ("do not write a second one — cite these").

2. **There is no agreed shape for a Fabula event.** #119 defined one (`FabulaEventSchema` in
   `src/arc/fabula.ts`) with `pov`, `dramatic_function`, `reveals`, and `conceals` as required —
   because a generator produces Fabula and Syuzhet in one interleaved act, so it always has them.
   #117 (extraction) converged on reusing that shape's field names and its `_fabula` block rather
   than inventing a second one, but structurally cannot fill those four fields: `pov` and
   `dramatic_function` are properties of a *scene*, which doesn't exist before #118 draws
   boundaries, and `reveals`/`conceals` are the told-ledger, which
   `docs/research/narrative-extraction-prior-art.md` §4.7 establishes has no extraction method at
   all — it's derived from Scene Cards, never read off prose. #117 shipped anyway, with those
   fields omitted and listed on the block as `fields_not_recovered`, and flagged the shape itself
   as the open question.

Both tickets independently reached for the same fix for problem 1: project each Fabula event onto
one provisional Scene Card (`provisionalPackage` in `src/arc/fabula.ts`) so `lintPackage` runs its
real checks against the real graph, and treat that projection as a measuring instrument, never the
deliverable. Two independent arrivals at the same shape is corroborating evidence it's the right
shape — worth formalizing as the sanctioned mechanism rather than three more tickets (#118, #120,
#132 phase 2) each re-deriving or subtly diverging from it.

## Decision

1. **A Fabula-only package is a first-class, named shape, not an implicit side effect of an empty
   `scene_cards` array.** It's a `DraftStoryPackageSchema`-valid object with `world_model_seed`
   populated, `scene_cards` empty, and its event list carried in the existing `_fabula` extra
   block (`FABULA_BLOCK`). No schema change to `StoryPackageSchema` or `DraftStoryPackageSchema`
   is needed or wanted — `DraftStoryPackageSchema.scene_cards` already defaults to `[]`, and the
   `looseObject` shape both fixtures already rely on (`_authoring_conventions`) is exactly the
   seam `_fabula` uses. The gap is entirely on the *validation* side.

2. **`FabulaEventSchema` moves out of `src/arc/` and becomes the shared shape, with fields split
   by what's actually recoverable at the Fabula layer:**
   - **Always required** (both entry points always produce these): `id`, `sequence`, `summary`,
     `location_id`, `characters_present`, `beats`, `pays_off`, `state_changes`.
   - **Optional at this layer, required once real Scene Cards exist**: `pov`,
     `dramatic_function`, `reveals`, `conceals`. These are Syuzhet properties of a scene, not an
     event — a generator can fill them because it authors both layers in one pass; extraction
     structurally cannot, and #118 is what actually produces them.
   - **Optional, best-effort**: `caused_by` — attempted by generation, not (yet) attempted by
     extraction; neither omission is an error.
   - **Not part of the shared contract**: extraction's `story_time`, `time_anchor`,
     `narrated_index`, `source_span`. These ride as additional keys on individual events when
     present, exactly as #117 already does — a generator has no use for them and nothing should
     require it to produce them.

3. **Validating a Fabula-only package always goes through the projection — never through a mode
   flag threaded into `lintPackage`.** `lintPackage` keeps requiring `StoryPackageSchema` and
   keeps meaning "this is a finished, checkable package" — that contract doesn't change, and nor
   does the principle it already states: severity is a property of the check, never the instance
   (ADR 0001 decision 2's tiering rule, restated for lint in `src/authoring/lint.ts`). What's new
   is a named, shared entry point — `lintFabulaArc(arc)` — that always builds the one-event-to-
   one-provisional-Scene-Card projection and calls the real `lintPackage` on it. The caller picks
   which package it's validating (real vs. projected); `lintPackage` itself never branches on
   provenance. G0 for a Fabula-only artifact means "the projection lints clean," not "`scene_cards`
   is non-empty."

4. **A field the projection can't recover gets a deterministic, counted substitution — never a
   silent guess.** `pov` falls back to the event's first `characters_present` entry; `location_id`
   carries forward from the nearest earlier event that named one. Both are exactly what #117
   already did on its own. The projection reports how many substitutions it made, so "G0 passed"
   on a Fabula-only package never quietly means "G0 passed because we faked scene properties" —
   a run with zero substitutions and a run with fifty are different results even at the same
   pass/fail outcome.

## Consequences

- `src/arc/fabula.ts`'s `FabulaEventSchema`, `FabulaArcSchema`, `FABULA_BLOCK`, and
  `provisionalPackage` move to a shared module (`src/schema/fabula.ts` for the types, alongside
  `story-package.ts`/`manuscript.ts`; the projection and `lintFabulaArc` alongside
  `src/authoring/lint.ts`, since projecting-then-linting is squarely that module's job). This is
  the one deliberate, narrow lift of #113's "don't touch `src/schema`/`src/authoring`" boundary —
  that boundary was right while nothing was decided; this ADR is the decision. #117's own
  `fabulaBlock` (`src/extraction/pipeline.ts`) and #119's callers move to the shared module in the
  same change. Landing this is scoped to whichever of #118 or a dedicated small ticket picks it up
  first — not a blocker for #118 to start, since #118 can keep using the pre-move location and
  rename the import once the move lands.
- #118 is the ticket that actually produces `pov`, `dramatic_function`, `reveals`, and `conceals`
  from real Scene Cards — once it lands, `fields_not_recovered` becomes a record of what an
  extraction-only or generation-only Fabula artifact is missing relative to a fully segmented one,
  not an open question.
- #120's shared-segmentation proof gets a stronger claim to test: not just "the same segmentation
  function accepts both entry points' output," but "the same shared `FabulaEvent` schema, gated
  through the same `lintFabulaArc`, validates both."
- This does not touch the separate, still-open question #119 flagged about entry/exit-state
  chaining severity depending on provenance (generated vs. extracted) — that's a different
  principle-vs-practice conflict and needs its own decision, not bundled into this one.

## Considered and rejected

- **Loosen `StoryPackageSchema.scene_cards` to `.min(0)`, and move "needs ≥1 scene to be finished"
  into an explicit lint rule.** Rejected: that rule's severity would then have to depend on
  whether the package is "still Fabula-only" or "meant to be finished," which is exactly the
  conditional-severity-by-instance shape the linter's own stated principle rules out, and it
  weakens the schema-level guarantee that a real Story Package always has scenes for every other
  consumer of `StoryPackageSchema` (the compiler, the authoring UI), not just the linter.
