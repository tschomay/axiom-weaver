# ADR 0003: Scene Digest shape and told-ledger fact granularity

## Status

Accepted — settled in [The Scene Digest and the told-ledger](https://github.com/tschomay/axiom-weaver/issues/7).

## Context

The Scene Digest is the only thing that circulates in long-range context — the continuity
pass (#15) and the plant-obligation walk (#8) read digests instead of prose, and four of
the eight seam-failure rubric modes (ADR 0002) are digest-detectable only if the digest
actually carries the field that detects them. The schema doc
([`docs/schema/story-package.md`](../schema/story-package.md)) had already deferred the
real identity scheme behind `fact_ref` to this ticket, since `character_knowledge` and
Scene Card's `reader_must_learn`/`must_stay_hidden` all reference it without defining it.

## Decision

1. **Fact granularity.** A `fact_ref` is an author-declared or auto-generated **slug**, not
   required to correspond to a World Model row or column. Many narratively load-bearing
   facts ("the will was forged") have no natural column home, and the World Model's bag
   columns are flat-scalar-only (ADR 0001) — forcing fact identity to be WM-row-shaped
   would either miss such facts or force one-off schema growth per story.
2. **Digest field set.** `event_summary`, `entities_on_stage`, `facts_revealed`,
   `plants_opened`, `payoffs_closed`, `imagery_signature` (capped at 3 entries),
   `closing_situation`. Standalone `emotional register` (open/close) is **cut**: "at close"
   duplicates part of `closing_situation` (already "physically *and emotionally*"), and
   "at open" doesn't tie to any rubric mode or downstream consumer. Every surviving field
   ties to a rubric mode (#3/ADR 0002) or a named consumer (#8, #12, #13, #15, #20) — a
   field earns its place by making some failure detectable, not by seeming useful.
3. **Emission.** The writer emits the digest in the *same* structured call as the prose,
   not a second extraction call — #5's research already confirmed streaming and structured
   output coexist in one call, and #16 (writer prompt contract) is scoped around one output
   schema carrying prose + digest + state_updates + diagnostics together.
4. **Told-ledger shape.** One table: `{fact_ref, first_learned_scene, last_touched_scene,
   centrality}`. `last_touched_scene` (not just first-learned) is load-bearing for #13's
   re-anchoring decay — a fact touched three times recently and one touched once 40 scenes
   ago must decay differently. Entity introduction ("has the reader met Marcus?") is not a
   parallel structure — it rides the same mechanism via an auto-generated `met:<entity_id>`
   fact_ref per entity. Current state only is tracked, not a full touch history.
5. **Size budget.** Per-field caps enforced by the schema itself: `event_summary` and
   `closing_situation` ≤ ~2 sentences each, `imagery_signature` ≤ 3 entries, other list
   fields uncapped (naturally sparse per scene). Target ~150–220 tokens/digest. This is
   deliberately narrower than the ticket's literal "truncated under pressure" framing:
   cross-digest eviction across many digests already belongs to #12, and MAX_TOKENS
   mid-JSON truncation already belongs to #16's digest-only fallback call. No field is ever
   dropped wholesale under pressure — a field exists to catch one failure mode, and cutting
   it silently reopens that mode.
6. **Rollups.** A Chapter/Part Digest shares the Scene Digest schema but aggregates over
   its window rather than concatenating scene-by-scene: `event_summary` is freshly
   synthesized (not concatenated, or growth stops being logarithmic per CONTEXT.md's zoom
   levels), list fields union, `imagery_signature` unions then re-caps to 3 by recency, and
   `closing_situation` is **not** aggregated — it inherits the window's last scene, since
   it's a point-in-time fact, not a narrative thread. Rollup *trigger timing* (when a
   Chapter Digest computes) stays unspecified — deferred fog, now sharpened by #5's finding
   that rollups are cache-invalidating events, so it's a cost decision as much as a
   fidelity one.
   The told-ledger itself does not get a rollup shape: facts are permanently
   learned-or-not, so there's no "chapter told-ledger" to compose — #12 queries the flat
   ledger by recency at assembly time instead.

## Consequences

- Unblocks #12 (zoom-level context assembler), #13 (re-anchoring policy), and #14
  (repetition and voice-drift control) — all were blocked on this ticket alone or in
  combination with already-closed tickets.
- `docs/schema/story-package.md`'s `character_knowledge.fact_ref` and Scene Card's
  `reader_must_learn`/`must_stay_hidden` now have a concrete identity scheme to align
  with: freeform slugs, not WM-row references.
- #16 (writer prompt contract) can finalize the digest's shape inside its output schema
  without re-deriving field choices.
- #20 (compiled editions and staleness) can diff on the now-concrete `facts_revealed` /
  `plants_opened` / `closing_situation` fields.
- Rollup *trigger policy* remains open fog — this ADR settles the rollup's shape, not when
  one fires.
