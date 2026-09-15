# Evaluation rubric: extraction fidelity and generated-arc validity

The measurement bar for the two upstream authoring entry points in
[issue #113](https://github.com/tschomay/axiom-weaver/issues/113) — **extraction** (existing
prose → Story Package) and **generation** (original arc → Story Package). Written for
[issue #115](https://github.com/tschomay/axiom-weaver/issues/115) so that the prototype tickets
downstream (#117–#120) cite one bar instead of inventing a new one each time.

Vocabulary is [`CONTEXT.md`](../../CONTEXT.md)'s. Field names are the real ones from
[`src/schema/story-package.ts`](../../src/schema/story-package.ts).

## 0. Scope, and why the existing rubric doesn't cover this

`CONTEXT.md`'s **seam-failure rubric** is entirely **Performance**-layer: every row in it is a
surface failure in generated prose, and every mechanism that owns a row (continuity pass,
state-update validator, plant-obligation walk) runs at or after compile time. Both entry points
here stop *upstream* of the compiler — their whole deliverable is a JSON object valid against
`DraftStoryPackageSchema` (#113, "Integration boundary"). Nothing they produce is prose, so no
row of that rubric applies and none of its mechanisms measure them.

What follows is the Fabula/Syuzhet-layer counterpart. It has two halves because the two entry
points differ in exactly one way that matters for measurement:

| | Ground truth | Question the rubric answers |
| --- | --- | --- |
| **Extraction** | Exists — the source text, and a human reading of it | *Did we recover what's there?* |
| **Generation** | None | *Is what we invented internally valid, and is it any good?* |

Everything mechanically checkable is shared between them; only the fidelity half has an answer
key.

---

## 1. What already counts as checkable, for free

Before either half of this rubric adds anything, note what the repo can already decide about a
candidate package, with no ground truth and no judge. **Both** entry points inherit these, and
neither gets to score above zero without them.

`lintPackage` ([`src/authoring/lint.ts`](../../src/authoring/lint.ts)) composes the schema parse,
`WorldModel.referenceProblems`, the Scene Card cross-reference pass, and the plant-obligation
walk ([`src/plants/obligation-walk.ts`](../../src/plants/obligation-walk.ts), ADR 0004) into one
verdict. Its **errors**:

| Code | What it catches |
| --- | --- |
| `unknown_entity` | a `pov` / `location_id` / `characters_present` / `entry_state` / `exit_state` reference to an id no seed row carries |
| `plant_scene_unknown` | a `pays_off` entry naming a scene id no Scene Card has |
| `plant_after_payoff` | the named plant scene does not strictly precede the payoff |
| `plant_not_declared` | the plant scene precedes the payoff but never declares the fact |
| `unfounded_seed_payoff` | a `plant: null` payoff whose fact is not actually seed-known |

and its **warnings**: `unpaid_fact` (a `reader_must_learn` fact no scene ever pays off),
`unused_seed_entity`, `no_required_beats`, `no_length_budget`, `voice_card_untouched`.

Two consequences for this rubric, and they are the reason this section comes first:

1. **"No orphaned payoffs, no unpaid plants" is already implemented.** #115's framing asks for it
   as a new mechanical check; it is the plant walk's four error codes plus `unpaid_fact`. Do not
   write a second one — cite these.
2. **A lint-clean package is a gate, not a score.** Publishing is blocked by any error
   (ADR 0017), so *every* candidate package from either pipeline must reach zero errors before
   anything below is worth measuring. A pipeline that emits lint errors has failed at a level
   this rubric doesn't grade; report the codes and stop.

> **Gate G0** — `lintPackage(candidate).publishable === true`. Non-negotiable, both entry points.
> Warnings are reported alongside the score, never as a failure on their own.

---

## 2. Ground truth for extraction: what we have, and its one important limit

The repo already ships two hand-authored packages derived from named public-domain source texts —
[`fixtures/cinderella/package.json`](../../fixtures/cinderella/package.json) (Lang's *Blue Fairy
Book*, 1889) and
[`fixtures/a-christmas-carol/package.json`](../../fixtures/a-christmas-carol/package.json)
(Dickens, 1843), sourced and rights-checked in
[`docs/research/fixture-stories.md`](../research/fixture-stories.md). That pair *is* the
extraction answer key: run the pipeline over the same source text, score against the fixture.

**The limit, and it is load-bearing for every threshold below:** the fixtures are *one valid
authoring*, not the unique correct one.
[`fixtures/authoring-notes.md`](../../fixtures/authoring-notes.md) records the judgment calls
explicitly — the *Carol* was merged from ~28 finest-grain beats down to 20 Scene Cards under a
documented `merge_policy`, Stave IV deliberately kept at full grain, and "deciding what *not* to
model was real effort, and is invisible in the output" (individual lords, the two portly gentlemen
as one row, no `possesses` relationship per costume change).

So a scoring scheme that treats any deviation from the fixture as an error is measuring
*agreement with one author*, not fidelity to the source. Every metric below is therefore built to
be **granularity-tolerant** and to separate three different kinds of disagreement:

- **Contradiction** — the candidate asserts something the source denies. Always an error.
- **Omission / invention** — the candidate misses something the source states, or states
  something the source doesn't. Scored.
- **Different valid grain or framing** — a merge the fixture didn't make, a bag attribute the
  fixture chose not to model, a different `dramatic_function` wording. **Not** an error; excluded
  from the denominator where the rule below says so.

Collapsing the third into the second is the single most likely way to make this rubric produce
confident, meaningless numbers.

---

## 3. Extraction fidelity

Scored per source story, against that story's fixture package. Report every metric separately —
there is deliberately no single composite number, because the failure modes have different costs
and a mean hides which one fired.

### 3.1 Alignment comes first

Entity-level metrics are meaningless without an alignment between candidate ids and fixture ids,
and slugs will not match (`fairy_godmother` vs `godmother`). Align **by name and role, once,
before scoring**, and freeze the mapping:

1. Exact `name` match (case/punctuation-normalized) → aligned.
2. Otherwise, a human (or judge) decides, and the decision is recorded in the run's alignment
   file alongside the score.
3. Unaligned candidate rows are **inventions**; unaligned fixture rows are **misses**.

The alignment file is part of the result, not scratch work. Two runs are only comparable if the
alignment was built the same way.

### 3.2 World Model seed

| Metric | Definition | Initial bar |
| --- | --- | --- |
| **Character recall** | aligned characters ÷ fixture characters | ≥ 0.90 |
| **Character precision** | aligned characters ÷ candidate characters | ≥ 0.85 |
| **Location / object recall** | same, per table | ≥ 0.80 |
| **Location / object precision** | same, per table | ≥ 0.75 |
| **Relationship recall** | aligned `{from_id, to_id, kind}` triples ÷ fixture's | ≥ 0.75 |
| **Attribute contradiction rate** | aligned rows whose `status` / `goal` / `location_id` / `bag` value the source text *contradicts* ÷ aligned rows | **0** |

Precision bars sit below recall bars on purpose: a minor named character the fixture folded away
is the "different valid grain" case, and over-extraction is cheap for an author to delete.
Under-extraction is not — it is silent.

**Attribute contradiction is judged against the source, never against the fixture.** A candidate
that gives Scrooge a `goal` the fixture doesn't have is not wrong; one that puts him in the wrong
location at the story's start is. This is the one metric with a zero bar.

**Seed-time versus current-time.** The World Model seed holds state *at the story's start*
(ADR 0001), and a long source text states most attributes long after that. Extracting a
late-story value into the seed is the specific, expected failure here — check it directly, don't
fold it into the contradiction rate. Report it as **seed-time attribute error count**, and expect
it to be the noisiest number in this section.

### 3.3 Event list and chronology

The event list is Fabula — chronological, not narrated order — so a source with any
non-chronological structure (the *Carol* is almost entirely flashback and flash-forward) tests
exactly the thing that matters.

- **Event recall** against a hand-built event list for the source: ≥ 0.85 of events the fixture's
  Scene Cards' `required_beats` collectively entail.
- **Chronological ordering accuracy** — over all pairs of aligned events, the fraction ordered
  correctly relative to each other (pairwise, not sequence-identity, so one misplaced event costs
  one event's worth and not the whole tail). Bar: ≥ 0.95, and **≥ 0.90 restricted to pairs the
  source narrates out of order**, which is the number actually worth watching.
- **Fabricated events** — events with no support in the source: **0**. Unlike an extra character
  row, an invented event propagates into segmentation and plant structure.

### 3.4 Scene segmentation

Segmentation is where "different valid grain" dominates, so boundary agreement is scored with
tolerance and is never the headline number.

- **Boundary agreement (windowed)** — a candidate scene boundary counts as matching a fixture
  boundary if it falls within a window of the source text (suggested: ±2% of total length, or
  ±1 paragraph for short sources). Report `precision` / `recall` over boundaries. Bar: ≥ 0.70
  each. A candidate that splits where the fixture merged scores below 1.0 on precision and that
  is *fine* — read it next to the count.
- **Scene count ratio** — candidate ÷ fixture. Report it; don't bar it. Outside 0.5–2.0, the
  segmentation is answering a different question than the fixture and the boundary numbers should
  not be trusted.
- **`required_beats` coverage** — for each aligned scene, the fraction of the fixture's beats
  entailed by some candidate beat (judged, not string-matched). Bar: ≥ 0.80 mean, and **no
  aligned scene below 0.5** — a mean hides one gutted scene.
- **Beat invention rate** — candidate beats the source does not support: ≤ 0.10.
- **POV and location accuracy** — `pov` and `location_id` of aligned scenes, against the source:
  ≥ 0.95. These are near-free to get right and a miss signals a segmentation that isn't reading
  the scene.

### 3.5 Reveal order — the told-ledger equivalent

The hardest thing to recover, because the source never states it. A Scene Card's
`reader_must_learn` / `must_stay_hidden` encode *what the reader knows when*, and the source only
implies it.

- **Reveal-order fidelity** — build, from the candidate, the ordered sequence of first-reveal
  scene per `fact_ref`; same from the fixture. Over aligned facts, score pairwise ordering
  accuracy as in §3.3. Bar: ≥ 0.90.
- **Premature reveal count** — facts the candidate marks `reader_must_learn` in a scene *earlier*
  than the source discloses them: **0**. This is the asymmetric error. Withholding a fact one
  scene too long is a craft difference; leaking it early destroys the dramatic irony the package
  exists to encode — the *Carol*'s Stave IV withholding is the fixture case, and Cinderella's
  irony gap is the other (`fixtures/authoring-notes.md` §3).
- **`must_stay_hidden` recall** — of the fixture's `must_stay_hidden` entries, the fraction the
  candidate also withholds: ≥ 0.80. A candidate that recovers no withholding at all has extracted
  a plot summary, not a Syuzhet, however well it scores everywhere else.

### 3.6 Plant/payoff graph

G0 already guarantees the graph is *internally* valid. What's left is whether it's the source's
graph:

- **Plant/payoff pair recall** — aligned `{fact_ref, plant scene, payoff scene}` triples ÷ the
  fixture's: ≥ 0.70.
- **Long-range pair recall** — the same, restricted to pairs spanning ≥ 5 scenes: ≥ 0.60,
  reported separately. Short-range pairs are easy and will carry the aggregate; the *Carol*'s
  "surplus population" plant (Stave I → Stave III) is the case this number exists for.
- **Misattributed plant rate** — pairs whose payoff is right but whose plant scene is wrong:
  report it. It is a different defect from a missed pair and points at a different fix.

### 3.7 Reporting

One result file per run, carrying: the alignment file, every metric above with its bar, the G0
lint output (warnings included), the source text and fixture `package_version` it scored against,
**and the model that produced the candidate**. Per `AGENTS.md`, a result that doesn't say which
model produced it is not a measurement — the same rule the run report already applies per scene.

---

## 4. Generated-arc validity

No answer key. So the question splits cleanly in two, and the split is the useful part of this
section: **do the mechanical gates first, and never let a judge's score excuse a gate failure.**

### 4.1 Mechanically checkable — must pass 100%

- **G0** (§1): lint-clean, `publishable === true`. This alone covers "no orphaned payoffs, no
  unpaid plants, every reference resolves."
- **Payoff reachability** — every `pays_off` entry's `fact_ref` is either declared by its named
  plant scene or seed-grounded. Already an error (`plant_not_declared` /
  `unfounded_seed_payoff`); listed here because #113 names it as a generation-time requirement and
  it must be re-asserted per generated arc, not assumed.
- **Entry/exit state chaining** — for every consecutive scene pair in `order`, the later scene's
  `entry_state` must not contradict the earlier's `exit_state` on any column both name. Not
  currently a lint rule; it is the authoring-time analogue of the **amnesia guard** (ADR 0005)
  and is a cheap pure function over the package. **A generated arc must satisfy it; an extracted
  one is only warned.** Whoever builds the generation prototype should add this check next to the
  linter rather than inside their own script.
- **Causal reachability from setup to payoff** — for each payoff, a path exists through
  intermediate scenes that share an entity or location with both ends. A weak structural proxy
  for causality, and it is honest to call it that: it catches a payoff bolted onto an arc that
  never touches it, and it does not catch a chain that is merely implausible.
- **Plant-span distribution** — report the histogram of payoff-to-plant scene distances. Not a
  pass/fail. An arc whose every plant lands one scene before its payoff is structurally valid and
  narratively inert; this number makes that visible where a boolean cannot.
- **No trivially-satisfied scene** — every scene has non-empty `required_beats` (the linter's
  `no_required_beats` warning, promoted to a gate for generated arcs, since nothing else is
  holding a generated scene to anything).

### 4.2 Judged — human or LLM-judge

These cannot be mechanized and should not be faked with a proxy metric:

| Criterion | What's asked | How scored |
| --- | --- | --- |
| **Causal follow-through** | Does each scene's outcome actually cause what follows, or merely precede it? | Per consecutive pair: `causes` / `merely follows` / `contradicts`. Bar: ≥ 0.70 `causes`, **0** `contradicts`. |
| **Non-genericity** | Does the arc reduce to a stock shape with names substituted? | Judge names the closest stock shape and rates adherence 1–5; ≤ 3 passes. Deliberately not "is it original" — every arc resembles something; the failure is when nothing but the labels differ. |
| **Payoff earned-ness** | Is each payoff *set up*, versus merely *linked*? | Per pair: `earned` / `linked only`. ≥ 0.70 `earned`. This is the one that separates a valid `pays_off` graph from a good one, and §4.1 cannot see it. |
| **Thematic coherence** | Does the arc hold one recognizable concern end to end? | 1–5, ≥ 3. |
| **Engagement** | Would a reader keep going? | 1–5, ≥ 3. The softest number here; weight it last. |

**Judge protocol**, so scores are comparable across tickets:

- Judge the **package**, never compiled prose. Prose quality is the Performance layer's problem
  and would contaminate a Fabula-layer score.
- Use `WRITER_MODEL` (currently `gemini-3.8-flash`) as judge, **never**
  `gemini-3.5-flash-lite` — per `AGENTS.md`, the lite model is for proving a call reaches the API,
  not for judging prose or structure. Record the judge model in the result.
- Judge **blind to provenance** where both a generated and an extracted arc are in play: a judge
  told which is which will find what it expects.
- Report per-criterion scores, never a mean. A high mean with `contradicts > 0` is a failing arc.
- Three or more arcs per configuration before drawing any conclusion. Single-arc judgments on a
  sampled model are anecdote.

### 4.3 The one comparison worth running

For calibration, run the judged criteria over the **fixture packages** (human-authored, from
sources that demonstrably work) and treat those scores as the reference point. If the judge cannot
rate Cinderella and the *Carol* above the bars in §4.2, the judge is miscalibrated and its scores
on generated arcs mean nothing. **Do this before trusting a single generated-arc number.**

---

## 5. How downstream tickets use this

- Cite this file and name the sections you scored against. Don't restate the bars.
- **Report every metric, not a composite.** No section defines an overall score, on purpose.
- Bars in §3 and §4.2 are **initial, unmeasured, and expected to move.** They are stated so the
  first prototype has something to be judged against rather than reporting raw numbers with no
  opinion attached. The first ticket that runs them should propose adjustments here, in a PR
  against this file, with the numbers that motivated the change — not silently score against a
  different bar.
- The zero-tolerance items are the ones to argue about last: attribute contradiction (§3.2),
  fabricated events (§3.3), premature reveal (§3.5), `contradicts` pairs (§4.2), and G0. Each is
  zero because a nonzero value is a defect the downstream compiler cannot detect or repair — not
  because zero is convenient.

## 6. What this rubric deliberately does not cover

- **Anything Performance-layer.** Prose quality, voice, imagery — the seam-failure rubric in
  `CONTEXT.md` owns those, and nothing here should be read as bearing on them.
- **Voice Card fidelity.** Extracting a Voice Card from source prose is a distinct problem (it is
  style, not structure) and needs its own criteria. `voice_card_untouched` is the only check
  either pipeline currently gets, and it is a warning.
- **Whether the source text was worth extracting**, or the arc worth telling. Out of scope.
- **Cost and latency.** Real constraints on both pipelines, tracked by the run report's cost
  fields (`src/edition/run-report.ts`), not by a fidelity rubric.
- **Schema gaps.** If either pipeline needs a field Scene Cards don't have, that is an ADR
  discussion (#113, "Non-goals"), not a rubric exemption.
