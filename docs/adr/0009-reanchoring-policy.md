# ADR 0009: Re-anchoring policy — introduce, assume, or remind

## Status

Accepted — settled in [Re-anchoring policy: introduce, assume, or remind](https://github.com/tschomay/axiom-weaver/issues/13),
part of [Map: The Narrative Machine](https://github.com/tschomay/axiom-weaver/issues/1).

## Context

The told-ledger (ADR 0003) tracks `{fact_ref, first_learned_scene, last_touched_scene,
centrality}`, and ADR 0003 itself named `last_touched_scene` as "load-bearing for #13's
re-anchoring decay" without saying how — that's this ticket's job. [The zoom-level context
assembler](https://github.com/tschomay/axiom-weaver/issues/12) (ADR 0008) also deferred one
piece of its own volatile-tail eviction order to this ticket: the "broader told-ledger
recency slice" in its lowest-priority group 6, described only as "this is Re-anchoring
policy's territory to refine."

Without a decision function, the writer either re-explains everything every time it appears
(the "Marcus, the getaway driver" problem, told for the fourth time) or assumes too much and
loses the reader — and without a mechanism for detecting it, **told-ledger miscalibration**
(the seam-failure rubric mode covering both directions, ADR 0002) has no owner that can
actually check it, despite the rubric already committing it to being digest-detectable.

## Decision

1. **Decision function.** `scenes_since_last_touch` — current scene's `order` minus the
   told-ledger row's `last_touched_scene` order, or `∞` if no told-ledger row exists yet
   (never touched) — modulated by `centrality`. No words-elapsed signal (scenes-elapsed is
   already native to the told-ledger's own keys; a word counter would be new state nobody
   else tracks) and no same-POV-character discount (a real refinement, but a second axis of
   state-tracking for a marginal craft gain — left as fog, not built). `centrality` alone
   differentiates major characters, minor characters, locations, objects, and plot facts;
   no separate entity-kind taxonomy is introduced, since that would duplicate what
   `centrality` already encodes and could disagree with it.

2. **`centrality` is a 3-level ordinal** — `low` / `medium` / `high` — not a continuous
   score. Consistent with the schema's existing preference for categorical fields over
   continuous ones (tier, `kind`); a decay curve doesn't need more resolution than that, and
   a continuous score would be false precision.

3. **Three bands**, cutoffs scaling by centrality. These are tunable constants living in
   code, not the schema — the shape is the decision, the numbers are a starting point:

   | centrality | `assume` | `reanchor` | `reintroduce` |
   | --- | --- | --- | --- |
   | high | ≤ 5 scenes | 6–40 scenes | > 40 scenes, or never-touched |
   | medium | ≤ 3 scenes | 4–15 scenes | > 15 scenes, or never-touched |
   | low | ≤ 1 scene | 2–6 scenes | > 6 scenes, or never-touched |

   `reintroduce` covers both first-ever mentions (never touched) and previously-introduced
   entities/facts that have decayed past the `reanchor` band (a character returning after a
   long absence) — the same instruction in both cases, not two different ones.

4. **Instruction format: an annotated per-entity list, scoped to entities present in the
   scene.** "Present" reuses [ADR 0008](0008-zoom-level-context-assembler.md) §4's existing
   deterministic join — `characters_present`, the `location_id` row, present/held objects —
   rather than inventing a second one. Each line carries `{name, band,
   scenes_since_last_touch}`, e.g. *"Marcus — established, assume"* / *"the pawnshop ring —
   last seen 30 scenes ago, re-anchor lightly."*

   **Plot facts (non-entity `fact_ref`s) are explicitly not covered by this decay
   mechanism.** They stay owned entirely by `reader_must_learn` / `must_stay_hidden` (the
   variance contract, [ADR 0006](0006-variance-contract.md)), which already gives the writer
   an explicit per-scene instruction for them. Overlaying a decay band on top would produce
   two instructions that could disagree. This is a deliberate scope boundary, not a gap.

5. **Resolves ADR 0008's deferred group-6 slice.** The "broader told-ledger recency slice"
   in the volatile-tail eviction order's lowest-priority group is: told-ledger rows for the
   `met:<entity_id>` facts of every entity present in the scene — the same set decision (4)
   needs, reachable via the same join, nothing wider. There is no join path to arbitrary
   non-required plot facts without inferring relevance from prose, which ADR 0008 §4 already
   rules out.

6. **Craft rule for "light re-anchor" prose.** A distinguishing clause, not a
   re-explanation — *"her brother's ring, the one from the pawnshop,"* not a restated
   sentence explaining what the ring is and why it matters. This ticket owns the rule and a
   small worked-example set (positive and negative, one per entity kind — character, object,
   location — plus one demonstrating `reintroduce` after a long absence) as design guidance;
   [the writer prompt contract](https://github.com/tschomay/axiom-weaver/issues/16) owns
   embedding it in the actual prompt template, the same division ADR 0008 used between the
   digest hierarchy and #16's prompt assembly.

7. **Author override.** New Scene Card field `force_reintroduce: fact_ref[]` (default `[]`),
   the same convention as `reader_must_learn` / `must_stay_hidden`. Forces the `reintroduce`
   band for the named facts/entities on that scene regardless of the computed band.

8. **Detectability: a new Scene Digest field, `reanchor_used: {entity_id, band}[]`.** The
   writer self-reports which band it actually used per touched entity. This is
   self-reported and **not** independently re-verified against the prose — the continuity
   pass ([issue #15](https://github.com/tschomay/axiom-weaver/issues/15)) works over digests
   only, never prose (`CONTEXT.md`) — the same trust level as `required_beats` in the
   variance contract (ADR 0006). This is an *extension* to ADR 0003's digest field set, not
   a reopening of it (see the addendum in
   [ADR 0003](0003-scene-digest-and-told-ledger.md)); it's what makes told-ledger
   miscalibration actually checkable: the continuity pass computes the expected band from
   told-ledger state at scene entry and compares it against `reanchor_used`.

## Consequences

- `docs/schema/story-package.md`'s Scene Card table gains `force_reintroduce: fact_ref[]`.
- [ADR 0003](0003-scene-digest-and-told-ledger.md) gains an addendum: the Scene Digest field
  set is extended with `reanchor_used`.
- [The continuity pass over digests](https://github.com/tschomay/axiom-weaver/issues/15) now
  has a concrete field to check told-ledger miscalibration against, closing the rubric's
  (ADR 0002) previously-unmechanized detectability gap for that mode.
- [The writer prompt contract](https://github.com/tschomay/axiom-weaver/issues/16) has the
  craft rule, the per-entity instruction format, and the new digest field to build its
  output schema and prompt around.
- Closes [ADR 0008](0008-zoom-level-context-assembler.md)'s deferred group-6 slice
  definition — no further decision needed there.
