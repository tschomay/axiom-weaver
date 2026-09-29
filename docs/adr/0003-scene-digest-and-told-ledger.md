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

## Addendum (2026-09-08)

[ADR 0009](0009-reanchoring-policy.md) extends the digest field set with `reanchor_used:
{entity_id, band}[]` — the writer's self-reported introduce/assume/reanchor/reintroduce
band per touched entity, which is what makes told-ledger miscalibration (ADR 0002)
checkable by the continuity pass. This is an extension, not a reopening: every field
decided here (item 2) stands: `reanchor_used` earns its place the same way — it makes one
more rubric mode detectable — rather than being added speculatively.

[ADR 0010](0010-repetition-and-voice-drift-control.md) reshapes `imagery_signature`'s
entries from bare strings to `{image: string, domain: string | null}`, still capped at 3:
the writer self-tags each recorded image against a Voice Card `imagery_palette` domain (or
`null` for an ad hoc image outside the palette) at emission time. This is what lets the
imagery ledger fed to later scenes distinguish a licensed motif (same domain) from lazy
repetition (same phrasing) with a plain tag-equality check — no fuzzy matching, no extra
call. Rollup behavior (item 6 above) is unchanged: union then re-cap to 3 by recency, now
operating on `{image, domain}` pairs instead of bare strings.

## Addendum (2026-09-11)

[ADR 0018](0018-prose-grounding.md) extends the digest field set again, for the same reason every
prior extension has: it makes one more rubric-relevant thing checkable, not because it seemed
useful. `grounded_claims: {entity_id, column, asserted_value}[]` — the physical/epistemic claims a
scene's prose makes about entities the told-ledger already tracks — lets the state-update
validator's existing `unentailed_reversion` test (ADR 0005 §2) run over prose-derived claims, not
just `state_updates`. And `reanchor_used` (ADR 0009's addendum above) gains one more sub-field,
`anchor_text: string | null`, a short extract of the actual clause used to place an entity, capped
like the digest's other length-bounded fields. Both ride the same structured call this ADR's
decision 3 already established — no second call.

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

## Amendment (2026-09-28)

Decision 1 stands: a `fact_ref` is a slug, and the slug is the identity. [ADR
0022](0022-fact-statements-and-the-hidden-account.md) adds an optional statement and causes for a
slug, in the package's `facts` table, because a bare slug reaching the writer carried no claim and
no direction (issue #179).

## Amendment (2026-09-28): `terms_glossed`

Decision 2's field set gains `terms_glossed` (slugs of specialist terms the scene explained),
and decision 4's `met:` mechanism gains a sibling `term:<slug>` fact. See [ADR
0007](0007-voice-card-and-style-presets.md)'s 2026-09-28 amendment. Like the other list fields,
it unions across a rollup window.

## Amendment (2026-09-29): `established_details`, and the details ledger

[#198](https://github.com/tschomay/axiom-weaver/issues/198), from Story Review Panel batch
2026-09-29 (`prototypes/story-review/2026-09-29/CURATION.md` §2). The consistency reviewer scored
four of five stories 2/5, mostly for one thing: a concrete detail the prose invents is forgotten by
the next scene, which invents it again. Helen left for "a ledger clerk's stool in Inverness" five
winters back (scene 1) and spent "three years running railway timetables" in the south (scene 3);
the urn is brass, then tin; Julien sits at Table 4, then calls Table nine; the escrow is £5,000,
then £20,000. The writer sees earlier scenes only as digests plus the last paragraph, and no
digest field records the specifics the prose committed to. `grounded_claims` (ADR 0018) records
claims about World Model columns only — location, status — and most of these details have no
column, and many of their entities have no row.

This field earns its place the way every earlier extension did: it makes one more rubric mode
(Amnesia, ADR 0002) detectable across scenes, for the attributes no column holds.

1. **A new digest field: `established_details: {entity_id, attribute, value}[]`, capped at 8.**
   The writer reports the concrete specifics this scene committed the reader to — a material, a
   number, a name, a date, a duration, a piece of backstory — about any entity, tracked or not:
   `obj_ash_urn / material / brass`, `char_helen / years_away / five winters, in Inverness`.
   `entity_id` is a World Model id where one exists, and otherwise a short slug the writer coins
   (`prop_quince_tart`), reused whenever the same thing recurs. `attribute` is a short snake_case
   slug. Only what the prose *states*; not what it implies, and not what the card already fixes
   (`exit_state`, facts) — those have their own mechanisms. Same call, per decision 3.
2. **A separate field, not folded into `grounded_claims`.** Folding would mean
   `column: "bag.<key>"` claims validated by the amnesia guard, which reads committed World Model
   values. ADR 0018 scoped `grounded_claims` to tracked columns on purpose, and most of these
   entities have no row to hold a bag. A separate field keeps that scope intact and needs no
   World Model writes.
3. **Accumulated in a run-scoped details ledger, first statement wins.** The run state keeps
   every established detail, keyed by `(entity_id, attribute)`, with the scene that established
   it. A later scene reporting a *different* value for the same key is **detail drift** —
   diagnostic `detail_drift` (`warn`, never a retry); the ledger keeps the first value, because
   that is what the reader read first. Values are compared case- and punctuation-insensitively,
   so a rewording of the same value is not drift. The ledger is not a rollup shape (decision 6):
   like the told-ledger it is flat and read at assembly time.
4. **Rendered to later scenes as `ESTABLISHED DETAILS (the reader has been told these — do not
   change them)`,** in the volatile tail's mandatory core, so eviction never drops it (ADR
   0008's amendment of the same date). Scoped to what the scene can touch: every detail about an
   entity on stage, then details about untracked entities (a prop or a backstory with no World
   Model row, which the deterministic join cannot place on or off stage), most recently
   established first, capped at 24 lines. A detail about a tracked entity who is off stage is
   left out; it returns when they do.
5. **Rollups carry no `established_details`** (decision 6): the ledger already holds every one,
   and a window has no single statement of an attribute to aggregate.
6. **Segmentation: props that pass between events become World Model objects.** Issue #198's
   fourth item. The arc prompt asks for a `world_model_seed` object for every physical object that
   two or more events turn on, so its `location_id` is tracked (ADR 0005) rather than moved
   between scenes by nobody (`04`'s wren and confession letter, `03`'s pin). This is a prompt
   requirement, not a text-mining pass over event summaries: naming "the object" in free text is
   the model's job, and a second heuristic would guess.

Consequences: `SceneDigestSchema` and the writer's response schema gain the field (optional on
read, defaulting to `[]`, so every stored digest still parses); the writer contract says what
belongs in it; `RunState` holds the ledger; the context assembler renders it; `compileScene`
checks drift. `CONTEXT.md`'s Scene Digest entry and `GLOSSARY.md` gain the term.
