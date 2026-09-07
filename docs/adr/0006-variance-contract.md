# ADR 0006: The variance contract — what may differ between two reads

## Status

Accepted — settled in [The variance contract: what may differ between two reads](https://github.com/tschomay/axiom-weaver/issues/10),
part of [Map: The Narrative Machine](https://github.com/tschomay/axiom-weaver/issues/1).

## Context

Same story, told uniquely on every generation, is the product's whole proposition — so what
is *allowed* to differ between two reads, and what must be identical needs to be a contract
the code enforces, not a hope. The map's agreed shape going in: each Scene Card declares its
**invariants** (required beats, facts revealed to the reader, exit state); everything unnamed
is free (dialogue, imagery, interiority, micro-beat order, which details get attention, length
within budget). This ADR settles invariant expression, verification and what happens on a
miss, the variance dial, reproducibility, and what a reader is told.

## Decision

1. **Invariant expression is a hybrid, following the schema's own shape.** `reader_must_learn`,
   `must_stay_hidden`, and `exit_state` ([`docs/schema/story-package.md`](../schema/story-package.md))
   are already structured (fact-refs and world-state), so verifying them is a lookup against
   the Scene Digest, not a judgment call. `required_beats` is the one genuinely free-text
   field, inherently about dramatic content that doesn't reduce to a fact-ref — it's the only
   invariant type that needs any interpretation at all.

2. **Detection is split, not duplicated.** The structured invariants are checked mechanically
   by compiler code against the digest's `facts_revealed`/state fields. `required_beats`
   satisfaction is **not** independently re-verified by a second pass — it's self-reported by
   the writer via its own `diagnostics` field, the mechanism [The writer prompt contract](https://github.com/tschomay/axiom-weaver/issues/16)
   already owns ("could not satisfy beat 3 because…"). Re-deriving beat satisfaction from a
   digest's free-text `event_summary` would itself be a fuzzy judgment call — a second fuzzy
   checker grading the writer's own fuzzy self-report doesn't add reliability, only cost.

3. **Miss policy mirrors ADR 0004 and ADR 0005's existing precedent, uniformly.** For any
   invariant miss — a mechanical structured-check failure or a writer-reported beat diagnostic
   — read-time: one bounded retry (same instruction restated), then accept-and-log to the run
   report if still missed, never blocking the run (per the map's Notes: read-time compiles are
   unattended). Author-time: immediate warning, no auto-retry, since the author can just fix
   the card.

4. **`must_stay_hidden` is a documented exception to "retry corrects it."** `propertyOrdering`
   puts `prose` first specifically so it streams to the reader immediately (#16) — so by the
   time the full structured response (including the digest that would reveal a violation) is
   checkable, the reader has likely already read the leaked secret. A retry can't un-show
   prose that already streamed. A `must_stay_hidden` violation is therefore **log-only at
   read-time**, never correctable after the fact — the only real defense is front-loading the
   instruction strongly in the prompt (a #16 concern), not catching it after. This is an
   accepted, documented gap, not an oversight — #16 and #19 inherit it rather than
   rediscovering it independently.

5. **The variance dial is `required_beats` density, sugared as per-scene presets.** `tight` /
   `normal` / `loose` expand to how much of a scene's natural outline becomes a required beat:
   - `tight` — essentially every beat a human outline would name (dialogue points, specific
     reveals, blocking) — near-deterministic retelling.
   - `normal` — the load-bearing turns only (what must happen), leaving how it happens free.
   - `loose` — only the scene's single indispensable outcome (often just `exit_state`, maybe
     one beat) — wide improvisation.

   Presets are chosen **per scene** at authoring time — there is no story-level default to
   inherit or override. `tight` for climax/ending and `normal`/`loose` for the middle is
   **documented authoring guidance**, not an enforced rule: the compiler does not decide which
   scenes "are" the climax — that's Syuzhet authority, which belongs to the author (per the
   map's Notes: "the engine never invents plot").

6. **Temperature is not part of the contract.** It's an internal generation parameter the
   compiler sets, not an author-facing or diffable knob — unlike beats, a run's temperature
   isn't observable or verifiable from a Compiled edition after the fact, so it can't carry
   any part of a contract the code is supposed to enforce.

7. **Reproducibility is persistence-only — no reliance on the model's `seed`.** Gemini's
   `generationConfig`/Interactions API does expose a `seed` field, but Google's own
   documentation is explicit that determinism isn't guaranteed even with an identical seed and
   parameters (model updates and other drift can still change the output). Building any part
   of "re-reading reproduces the telling" on that would be a promise the platform can't keep.
   A Compiled edition's repeatability comes entirely from what's flushed to Blob per scene
   (already required by ADR for [#6](https://github.com/tschomay/axiom-weaver/issues/6)/[#20](https://github.com/tschomay/axiom-weaver/issues/20)
   for unrelated reasons — workflow retention) — re-reading means reading the stored artifact;
   a fresh compile is always a new, unseeded, uniquely-varying run.

8. **The reader is told once, unobtrusively.** A single line on the story's landing page (e.g.
   "this is a live telling — no two reads are quite the same") — no in-reader indicator, run
   ID, or diffing affordance during reading. Fully silent undersells what the ticket calls the
   product's whole proposition; a persistent in-reader affordance is app-shell UI, out of
   scope for this map, and the diffing mechanic itself is already [#20](https://github.com/tschomay/axiom-weaver/issues/20)'s
   territory.

## Consequences

- `docs/schema/story-package.md`'s Scene Card fields (`required_beats`, `reader_must_learn`,
  `must_stay_hidden`, `exit_state`) are confirmed as the complete invariant surface — no new
  field is needed for this contract.
- [The writer prompt contract](https://github.com/tschomay/axiom-weaver/issues/16) inherits:
  the beat-diagnostic self-report requirement (already implied by its own scope), and the
  `must_stay_hidden` streaming caveat as a prompt-emphasis concern rather than a runtime check.
- [The read-time run loop](https://github.com/tschomay/axiom-weaver/issues/19) inherits: the
  retry-then-log policy as the concrete per-scene behavior on an invariant miss, and the
  accepted `must_stay_hidden` gap.
- Authoring guidance (variance preset-to-scene-position mapping) is documentation for whoever
  builds author-facing tooling — not a schema or runtime constraint.
- No seed/determinism machinery is built anywhere in the compiler; `docs/research/gemini-capabilities.md`
  is not updated with new API surface since `seed` isn't being used.
