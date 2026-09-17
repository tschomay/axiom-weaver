# One segmentation path, two entry points — what happened when we actually tried it

Issue #120, under the map issue #113. #118 built `segmentFabulaPackage()` against extraction output
(#117) and claimed in its own doc comment that it "never reads source prose, nothing consults a
fixture, and nothing assumes a correct answer exists — the three things that would make this work on
extraction output and fail on generated input". This is the ticket that tested the claim, by running
that function over #119's committed generated arcs.

Everything below is measured on the nine arcs in `prototypes/arc-generation/`. No arc was generated
for this ticket; the only API spend here is the segmentation passes themselves.

## Short answer

**The hypothesis holds.** One function, two entry points, no fork. Six generated arcs across all
three of #119's prompt configurations segmented into Story Packages that pass the real
`lintPackage` and every §4.1 gate, with no changes at all to the boundary pass, the scene-card pass,
the state replay, the assembly, the grouping constraints or the schema.

It holds **with one real defect found and fixed**, and that defect is exactly the shape the ticket
predicted: a guard that reads as correct, is correct on extraction input, and is silently a no-op
on generated input — because extraction could never exercise it. See §3.

It also surfaced three things that are **not** segmentation's to decide and are flagged rather than
settled: §5, §6 and §7.

## 1. It runs, unmodified

`readFabulaArc` accepted all nine arcs. `segmentMechanically` (no model at all) produced a package
for all nine. Eight lint clean; `arc_free_text_2` fails with
`unknown_entity world_model_seed.characters.char_stoddard.location_id` — which is #119's own
already-recorded G0 failure on that arc, propagated faithfully rather than laundered. Segmentation
passes the World Model seed through untouched, so a broken seed stays broken, which is the correct
behaviour and is worth having checked.

The judged sample is six arcs, two per configuration, `arc_free_text_2` deliberately excluded from
the paid runs because a model pass over it would have spent money re-measuring an upstream defect.

| arc | config | events → scenes | events/scene | G0 | §4.1 all gates |
| --- | --- | --- | --- | --- | --- |
| `arc_structured_kiln` | structured | 20 → 17 | 1.18 | PASS | PASS |
| `arc_structured_ferry` | structured | 20 → 14 | 1.43 | PASS | PASS |
| `arc_free_text_1` | free_text | 20 → 16 | 1.25 | PASS | PASS |
| `arc_free_text_3` | free_text | 20 → 17 | 1.18 | PASS | PASS |
| `arc_no_span_guidance_kiln` | no_span_guidance | 20 → 17 | 1.18 | PASS | PASS |
| `arc_no_span_guidance_orchard` | no_span_guidance | 20 → 13 | 1.54 | PASS | PASS |

Zero lint errors across all six. The only warnings are 14 `unused_seed_entity` — seed rows #119
wrote that no event names, again an upstream property.

**Substitutions were zero everywhere**: no scene needed a POV or a location or a beat set stood in
for. On the extraction side #118 also reported zero, but from a much weaker position — see §2.

## 2. What the two entry points look like from inside segmentation

The interesting part is that neither input is a subset of the other. They carry *disjoint* optional
signals, and `signals.ts` reads both correctly without knowing which pipeline it is talking to.

| optional signal | extraction (#117) | generation (#119) |
| --- | --- | --- |
| `narrated_index`, `story_time`, `time_anchor`, `source_span` | present | absent |
| `pov`, `dramatic_function`, `caused_by` | absent | present |
| `reveals`, `conceals`, `pays_off` | always empty | populated |
| `character_knowledge` with `learned_at_scene: null` | always empty | populated |

This is the real reason #120 was worth running as its own ticket. Four code paths in
`src/segmentation` are reachable **only** from generated input, because extraction emits
`pays_off: []` on every event and an empty `character_knowledge`:

- `carryForward` (rewriting event-id plant edges onto scenes),
- the `plant: null` branch of `applyPlantGraph` and its `seedFacts` lookup,
- `grouping.ts`'s "a merge may never swallow a plant into its own payoff" constraint,
- the `alreadyKnown` dedup in `segment.ts`.

The first three work. The fourth did not.

Two of the six arcs had a scene split **forced by the plant-span constraint**, which is the first
time that constraint has fired on real data at all.

## 3. The defect: a guard that could only ever be tested by the entry point it was not written for

`segment.ts` filtered the proposal pass's answers against the carried edges by `fact_ref`:

```ts
const alreadyKnown = new Set(carriedPairs.map((pair) => pair.fact_ref));
const fresh = proposals.pairs.filter((pair) => !alreadyKnown.has(pair.fact_ref));
```

The stated intent — "anything the Fabula layer already asserted is not re-proposed" — is right. The
mechanism cannot deliver it. The carried slug is the *generator's* name for the fact; the proposed
slug is the *proposal call's* name for the same fact. They never collide, so on the only input where
`carriedPairs` is ever non-empty, the filter removed nothing.

Measured, before the change, over the six arcs: **26 edges added by segmentation on top of 56
authored ones**, and in `arc_structured_kiln` 4 of the 5 additions sat on a plant/payoff scene pair
the generator had already authored:

| the arc's own edge | segmentation's alias, run 1 | run 2 |
| --- | --- | --- |
| `roof_exhaust_damper_propped_open` (3 → 15) | `damper_propped_open` (3 → 15) | `damper_wedged_with_rebar` (3 → 15) |
| `missing_brass_scale_counterweight` (5 → 11) | `missing_scale_counterweight` (5 → 11) | `missing_brass_counterweight` (5 → 11) |
| `bram_fresh_arc_burns` (7 → 14) | `bram_arc_burns` (7 → 14) | `brams_arc_burns` (7 → 14) |
| `purple_twine_on_brams_cuffs` (2 → 14) | `purple_twine_repair` (2 → 13) | `purple_mending_twine` (2 → 13) |

Two independent runs over the same arc produced *two different sets of aliases* for the same four
facts, which is the tell: these are naming noise, not findings.

Nothing caught it downstream, and nothing could have. A duplicate edge is internally valid by
construction — `applyPlantGraph` writes the alias into the plant scene's own `reader_must_learn`, so
the plant-obligation walk is satisfied and G0 passes. The package simply claims more structure than
its author wrote, and invents `fact_ref`s the World Model has no rows for.

### The fix, and why it is minimal and general

The carried edges are now passed **into** `proposePairs` and rendered as an `ALREADY RECORDED`
block, so the collision is avoided where the names are chosen rather than string-matched after the
fact. The old filter stays as the cheap exact case.

It is general in the only sense that matters here: the block is omitted when there is nothing to
show, so for extraction input the prompt is byte-identical and #118's published numbers still stand.
`tests/segmentation.test.ts` asserts exactly that. Nothing in `src/segmentation` asks which pipeline
produced its input, before or after.

Effect, same six arcs. The change touches only the fourth pass, and the first three came back
essentially unmoved — five of the six arcs re-segmented to the same scene count, the sixth to one
more (16 → 17), which is ordinary run-to-run variation rather than an effect of the change:

| | authored edges | on Scene Cards, before | after |
| --- | --- | --- | --- |
| six arcs, total | 56 | 81 | 63 |
| edges added by segmentation | — | 26 | 7 |

(56 + 26 = 82 rather than 81 in the "before" column because in that run one arc had two events land
in a single scene paying off the same fact from the same plant, which `carryForward` collapses to
one edge. No fact was lost — all 16 of that arc's authored edges are present either way, as 16
distinct `{fact_ref, plant scene, payoff scene}` triples. The "after" column has no such collapse:
56 + 7 = 63.)

All seven surviving additions sit on scene pairs the generator did **not** use, and no authored edge
was lost in any arc, before or after. The pass still finds real new structure; it stopped finding the
author's own structure twice.

## 4. Scoring (rubric §3.5–§3.7, and why most of it reports `null`)

Most of §3.5–§3.7 **cannot be computed for a generated arc, and this is a property of the rubric
rather than a gap in this run.** Those sections measure *fidelity to a source*: boundary agreement is
defined in source-text offsets against a fixture segmentation, beat coverage and invention are
judged against the source, POV/location accuracy is agreement with a fixture, source coverage is the
fraction of a source assigned to a scene, and §3.6's premature-reveal count is defined relative to
where the source discloses a fact. A generated arc is the only authoring of itself and has no source
text. `scripts/segment-arcs.ts` reports each of these as `null` with the reason attached rather than
approximating it, per §5.

What *is* comparable:

| | Cinderella (#118) | *A Christmas Carol* (#118) | six generated arcs (#120) |
| --- | --- | --- | --- |
| events → scenes | 44 → 12 | 441 → 47 | 20 → 13–17 |
| events per scene | 3.67 | 9.38 | 1.18–1.54 |
| telling-order basis | `narrated_index` | `narrated_index` | `fabula_sequence` |
| events displaced from chronology | 3 | 441 | 0 |
| G0 | PASS | PASS | PASS ×6 |
| POV substitutions | 0 | 0 | 0 |
| `must_stay_hidden` entries | 0 | 0 | 1–17 per arc |
| self-consistency (within-run) | 1.00 | 0.97 | `null` — see below |

Two of those rows are worth reading twice.

**Segmentation is near-identity on generated input.** 76% of the 94 scenes are a single event. That
is not a failure — the boundary pass is agreeing that a #119 event is already one action, which is
true: #119 authors one event per intended scene, each with its own POV, location and dramatic
function, while extraction produces sub-scene-grained events (441 for a 20-scene story). But it means
the expensive part of #118's design — a judged, windowed, non-1:1 boundary pass — buys very little
on this entry point, and the numbers that justify it (*Carol* 63→47) come from the other one.

**POV agreement is 93/94, and the scene-card pass never saw the answer.** `renderDraft` shows the
model only each event's summary and beats — never the authored `pov` or `dramatic_function`, because
those fields do not exist on extraction input. The model recovered the generator's POV anyway in all
but one scene. So this *is* an extraction-shaped assumption, and it is also **not worth changing**:
it costs a re-derivation that is 99% redundant, and the one place it could be improved is the single
scene where the two disagree. The honest reading is that the pass is duplicating work, not getting
it wrong, and that is not enough to justify a prompt change and a re-measurement. `dramatic_function`
is rewritten in 94/94 scenes — a rephrasing, not a disagreement, but it does mean a segmented
package's Scene Card function and the `_fabula` block riding along in the same file never match
textually.

**Run-to-run stability.** §3.5's within-run self-consistency number is `null` on every generated arc,
and structurally so: 20 events fits inside one `WINDOW_EVENTS = 24` window, so no adjacency is judged
twice and there is nothing to be consistent with. §3.5 names the substitute — run the pipeline twice
and score the two runs against each other — so that is what was done, on `arc_structured_kiln`:
**16/16 identical boundaries, F1 = 1.00**, with an identical POV sequence. Only the scene labels and
the proposed plant edges differed, and the proposed edges were the §3 defect.

That is one arc, and it is not the whole picture: across the sample as a whole, one arc
(`arc_no_span_guidance_kiln`) came back with 16 scenes on one run and 17 on another. So the fair
statement is that boundaries are stable but not deterministic, which is what §3.5 expects, and that
a real stability number for this entry point needs more than the one pair of runs this ticket
could afford.

## 5. Seed-grounded payoffs: #118's open question does **not** transfer

#118 flagged `plant: null` payoffs as "unreachable by any automated pipeline", because nothing
populates `character_knowledge` with `learned_at_scene: null`. That is an accurate statement about
**extraction**, whose seed has no `character_knowledge` rows at all (0 for both fixtures) on #117's
cited grounds.

It is simply not true of generated input. #119's generator writes those rows, and every one of its
`plant: null` payoffs is grounded by one:

| | seed-grounded payoff edges | grounded by a `learned_at_scene: null` row |
| --- | --- | --- |
| all nine arcs | 31 | 31 |

`seed_grounded_unrepresentable` is **0** on every arc in the paid sample. The rejection path #118
built is correct and stays correct; it simply never fires here. The open question narrows to "how
does *extraction* ever produce a seed-grounded payoff", which is #117's question, not this pipeline's.

## 6. Telling order: a non-issue for these arcs, and a real gap above them

#118 predicted #120 would "hit this directly". Concretely, what happens is: `tellingOrder` finds no
`narrated_index`, reports `basis: 'fabula_sequence'`, and `displaced: 0`.

For #119's arcs that is not a degradation, it is the correct answer, and the evidence is that the two
orders are **identical by construction**. #119 authors a chronological event list and its own §4.1
gates require every plant to precede its payoff in that list; there is no second ordering to be wrong
about. The failure a wrong telling order causes — plant edges landing backwards and being dropped as
unrepresentable — did not occur once: 0 unrepresentable, 0 authored edges lost, across all six arcs.
The *Carol*'s 63→47 improvement came from `narrated_index` **existing**; here there is nothing to
lose by its absence.

The real gap is one layer up and is **not segmentation's to close**: a generated arc cannot currently
express a non-chronological telling at all, because #119 authors a Fabula and no Syuzhet. Every
generated package is therefore linear by construction, and the *Carol*'s Stave IV withholding — the
structure the whole told-ledger exists for — is inexpressible by the generation entry point. ADR 0019
made `narrated_index` an optional extraction-only extra; making it something a generator can author
is an ADR-shaped decision and is flagged here, not taken.

Note that the told-ledger is nonetheless far *richer* on generated input than extracted: 1–17
`must_stay_hidden` entries per arc, against 0 on both fixtures, because #119 authors `conceals`
directly and they are carried forward verbatim.

## 7. The plant-span histogram was being read at the wrong layer

§4.1 asks for "the histogram of payoff-to-plant **scene** distances". #119 reported it over the
Fabula projection, where one event is one scene by construction, so what it actually published was
*event* distances. After real segmentation the number moves, and it moves in the direction that
matters:

| arc | span-1 share, event layer (#119) | span-1 share, scene layer (#120) |
| --- | --- | --- |
| `arc_free_text_1` | 0.00 | 0.00 |
| `arc_free_text_3` | 0.00 | 0.20 |
| `arc_no_span_guidance_kiln` | 0.08 | 0.21 |
| `arc_no_span_guidance_orchard` | 0.00 | 0.29 |
| `arc_structured_ferry` | 0.00 | 0.00 |
| `arc_structured_kiln` | 0.00 | 0.00 |

Mean span falls on all six (6.7 → 4.0 on `arc_no_span_guidance_orchard`, 9.8 → 6.3 on
`arc_structured_ferry`), and rises above zero on three arcs that reported a clean 0.00 before. This is the one
instrument §4.1 has for the "structurally valid and narratively inert" failure
(`llm-arc-generation-prior-art.md` §6), and reading it before segmentation systematically flatters
the arc. `scoreMechanicalPackage` in `src/arc/rubric.ts` now lets §4.1 be scored over a real package,
which is how the right-hand column above was produced; it is the same code as `scoreMechanical` and
they are asserted equal on the projection, so #119's published numbers are unaffected.

This is a finding about **where** the rubric's own number should be measured, and §5 of the rubric
says the ticket that runs a bar should propose adjustments in a PR against the rubric rather than
score against a different one silently. That proposal is not made here — it is flagged for the owner
alongside the two metric definitions #118 already flagged.

## 8. Verdict

Shared segmentation **holds**. There is one `segmentFabulaPackage()`, it reads only what ADR 0019
made shared, and the six generated packages it produced are ordinary Story Packages that the real
linter passes. Nothing in `src/segmentation` branches on which pipeline produced its input, and the
one change this ticket made does not introduce such a branch — it keys on whether the *input* carries
a plant graph, which is a property of the artifact, not of its provenance.

The honest qualification is that "one path" is not the same as "one path that is equally well
exercised by both ends". #118 could only ever test half of the plant machinery, and the half it could
not test contained a real bug. The general lesson for the remaining integration work is that a code
path reachable from only one entry point should be treated as untested until the other one runs
through it, however obviously correct it reads.
