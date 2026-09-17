# Evaluation rubric: extraction fidelity and generated-arc validity

The measurement bar for the two upstream authoring entry points in
[issue #113](https://github.com/tschomay/axiom-weaver/issues/113) — **extraction** (existing
prose → Story Package) and **generation** (original arc → Story Package). Written for
[issue #115](https://github.com/tschomay/axiom-weaver/issues/115) so that the prototype tickets
downstream (#117–#120) cite one bar instead of inventing a new one each time.

Vocabulary is [`CONTEXT.md`](../../CONTEXT.md)'s. Field names are the real ones from
[`src/schema/story-package.ts`](../../src/schema/story-package.ts).

Revised for [#125](https://github.com/tschomay/axiom-weaver/issues/125) once the prior-art
research in `docs/research/` landed: the first draft was written from repo internals alone, and
§2, §3.2, §3.3, §3.5 and §4.1 now carry what that research turned up. Nothing was retracted.

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
| `entry_exit_contradiction` | a scene's `entry_state` disagreeing with the previous scene's `exit_state` on a column both name |

and its **warnings**: `unpaid_fact` (a `reader_must_learn` fact no scene ever pays off),
`unused_seed_entity`, `no_required_beats`, `no_length_budget`, `voice_card_untouched`.

Three consequences for this rubric, and they are the reason this section comes first:

1. **"No orphaned payoffs, no unpaid plants" is already implemented.** #115's framing asks for it
   as a new mechanical check; it is the plant walk's four error codes plus `unpaid_fact`. Do not
   write a second one — cite these.
2. **Consecutive-scene state contradictions are covered too.** `entry_exit_contradiction`
   (added for #127) reads ADR 0005's authority rules statically over the authored cards, in the
   one window — between two consecutive scenes — where no engine behaviour can intervene. It is
   the reason §4.1 lists entry/exit chaining as already satisfied rather than as work.
3. **A lint-clean package is a gate, not a score.** Publishing is blocked by any error
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

### The second limit: two of the three fixtures are the easy end

[`fixtures/cinderella`](../../fixtures/cinderella/package.json) and
[`fixtures/a-christmas-carol`](../../fixtures/a-christmas-carol/package.json) are two short,
linear, realist nineteenth-century stories. That is not a representative sample of what
extraction has to survive. Book-length reasoning degrades **further on speculative fiction with
heavy world-building** than on realist prose — invented entities, coined terms and non-standard
ontologies are exactly what a coreference and attribute-extraction pass handles worst (NoCha, via
[`narrative-extraction-prior-art.md`](../research/narrative-extraction-prior-art.md) §5).

[`fixtures/the-machine-stops`](../../fixtures/the-machine-stops/package.json) (#132) is the third
fixture, and it exists specifically to stop this rubric's numbers from describing only the easy
end. It is **hard along exactly one axis, chosen deliberately, not several at once**: an invented
world with coined terms and non-standard entities (E. M. Forster, 1909/1928 — "the Machine," "the
Book," "the Mending Apparatus," "Homelessness" as a punishment status, none of which map cleanly
onto `character`/`location`/`object`). It is *not* harder on cast size (two principal named
characters, deliberately kept small so ontology novelty is isolated from coreference volume),
narrative order (told straightforwardly, start to finish), or narrator reliability (a plain
third-person narrator throughout). See `docs/research/fixture-stories.md`, "Category 3 — the hard
fixture," for the full axis selection and the three axes rejected alongside it, and
`fixtures/authoring-notes.md`'s entry for this package for how the non-standard entities were
actually modeled against the fixed World Model tables.

That axis pick was made in phase 1 of #132, *before* #117's first scored extraction run existed —
and was rechecked against that run's actual results before phase 2 authored this package. #117's
dominant measured failures (both realist fixtures: character/location/object precision far below
bar from deliberate over-extraction; the *Carol*'s chronology-bucketing at 0.58 on Stave IV's
conditional future; event recall 0.38–0.53 from under-extracted speech acts) are largely
axis-agnostic — they stress extraction volume and tense-vs-story-time, not ontology fit, and
would likely recur on any third fixture regardless of axis. The one finding that *does* bear
directly on this axis is `wrong_entity_table` (PR #136): 25 of 76 gate errors on the realist
fixtures were objects or locations extracted into the character table — a table-classification
failure, which is exactly the mechanism an entity that generically resists classification (a
governing system that is also an environment that is also an antagonist) is chosen to stress
harder. That is corroborating evidence for the axis, not evidence against it, so the phase-1 pick
stood without revision.

So a pipeline scoring at bar on Cinderella and the *Carol* alone has cleared the easy end of the
range, not the range — the three consequences that follow are unchanged whether one or two hard
fixtures exist:

- **Say so in the result.** A score reported without naming the fixture it came from overstates
  what was measured. §3.8 already requires the fixture and `package_version`; this is why.
- **Do not raise a bar on fixture evidence alone.** Passing here licenses proceeding to a harder
  source, not a conclusion that extraction works. A run against *The Machine Stops* should expect
  lower numbers than the two realist fixtures produce, and that is not, by itself, a regression.
- **A low score against the hard fixture still needs the same discipline §2's three-way split
  above asks for.** A candidate that models "the Machine" as a `location` rather than an `object`
  is a different-valid-framing disagreement, not a miss, unless it also gets the Machine's
  changing operational status wrong — the alignment pass (§3.1) has to be read especially
  carefully against this fixture's non-standard entities before any precision/recall number here
  is trusted.

A second hard fixture — large cast with ambiguous naming, non-chronological telling, or an
unreliable narrator, the three axes `fixture-stories.md` rejected alongside this one to keep this
fixture a single-axis test — is out of scope here and worth its own ticket once this fixture's own
numbers are in.

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

### 3.2 Span grounding — the precondition for trusting anything below

**Require every extracted `fact_ref`, `state_update` and `pays_off` edge to carry a verifiable
offset into the source text.** Then check that the span exists, falls inside the source, and
actually supports the claim.

This is the cheapest decisive check in this document, and the only one that needs neither ground
truth nor a judge: an extracted claim that cannot be pointed at a span **is a hallucination by
construction**. Everything else in §3 measures how *close* extraction got; this measures whether
it was reading at all. The precedent is ConStory-Checker's practice of grounding each judgment in
explicit textual evidence — see
[`docs/research/narrative-extraction-prior-art.md`](../research/narrative-extraction-prior-art.md)
§8, which proposes it.

| Metric | Definition | Bar |
| --- | --- | --- |
| **Groundable rate** | extracted items carrying a resolvable span ÷ all extracted items | ≥ 0.95 |
| **Span support rate** | sampled spans (≥ 30) that a reader agrees support the claim ÷ sampled | ≥ 0.90 |
| **Ungroundable claims** | items with no span, or a span outside the source | report the list, not just the count |

**This implies a field the Story Package does not have, and should not grow.** A span is
meaningful only relative to a source text, and a generated or hand-authored package has no source
to point at — so this belongs to the extraction pipeline as a sidecar keyed by `fact_ref` and
scene id, not as a Scene Card field. Stating that explicitly is part of this section's job: the
rubric has no authority to change the schema (#113, "Non-goals"), and a check that quietly implies
a schema change would be doing exactly that. If a later ticket concludes the span genuinely
belongs on the card, that is an ADR conversation, not a rubric decision.

Ungroundable output is also the thing most worth looking at by hand. A pipeline that scores well
everywhere else and grounds poorly has learned to produce plausible Story Packages, which is the
specific failure this whole rubric exists to catch.

### 3.3 World Model seed

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

**The grain rule §2 promises, stated (#151).** §2 says a different valid grain is "not an error;
excluded from the denominator where the rule below says so," and until #151 no rule below said so —
precision was `aligned / candidate_rows` flat, which scores agreement with one author's grain
rather than fidelity to the source. The rule: a candidate row is **load-bearing** when some
extracted event refers to it — in `participants`, as the event's `location_id`, or as a
`state_updates` entity or location value — or when it aligned to a fixture row. Precision's
denominator is the load-bearing rows; everything else is reported as **`over_extracted`**, never
silently forgiven, because over-extraction is still a cost even when it is not a fidelity failure.

Three things about the rule, and the third is a live exemption:

- **The bars do not move.** Changing the denominator without changing the bar is what makes the
  bar mean what §2 already says it means.
- **It is necessary, not sufficient.** It takes *A Christmas Carol*'s characters from 0.129 to
  0.202 and Cinderella's from 0.400 to 0.500 — real, and nowhere near the 0.85 bar. The residue is
  under-merge (#143) and under-extracted events (#144), both of which change this input.
- **Objects are exempt until #154.** No Fabula field can name an object, so not one object row on
  either fixture is referenced by any event and the rule would empty the table. Objects score flat
  meanwhile, and the result reports which denominator it used.

**Attribute contradiction is judged against the source, never against the fixture.** A candidate
that gives Scrooge a `goal` the fixture doesn't have is not wrong; one that puts him in the wrong
location at the story's start is. This is the one metric with a zero bar.

**Seed-time versus current-time.** The World Model seed holds state *at the story's start*
(ADR 0001), and a long source text states most attributes long after that. Extracting a
late-story value into the seed is the specific, expected failure here — check it directly, don't
fold it into the contradiction rate. Report it as **seed-time attribute error count**, and expect
it to be the noisiest number in this section.

**Over-merged versus split characters — the error that earns its own row.** Two distinct
characters welded into one entity, or one character split across two, is not just another recall
miss: ADR 0001 makes an entity's slug its identity, so a downstream Scene Card, `pays_off` edge
and told-ledger entry all inherit the mistake and there is nothing later in the pipeline that can
undo it. Every other extraction error degrades a package; this one corrupts it.

It is also detectable **without gold data**, which is what makes it worth a row rather than a
caution. Run two independent extraction passes over the same source and compare their coreference
metrics against each other: a high MUC score alongside low B³ and CEAFe is the arithmetic
signature of over-merging, because MUC is nearly insensitive to merging clusters that should be
separate while the other two are not. BookCoref's own `evaluate.py` and its `gold_window` mode are
directly reusable for this. The figures and the reasoning are in
[`narrative-extraction-prior-art.md`](../research/narrative-extraction-prior-art.md) §2.2 — read
them there rather than restating them here, so a correction to that doc doesn't leave a stale
number in this one.

| Metric | Definition | Bar |
| --- | --- | --- |
| **Entity-count sanity** | candidate character count ÷ a BookNLP run over the same source | 0.7–1.4; outside that, inspect before scoring anything else |
| **Merge signature** | MUC − B³ across two independent passes | report it; a large positive gap means inspect clusters by hand |
| **Confirmed weld / split count** | distinct source characters sharing one candidate id, or vice versa, once inspected | **0** |

The first two are screens, not verdicts — they tell you where to look. Only the third is scored,
and it is zero-tolerance for the reason above.

### 3.4 Event list and chronology

The event list is Fabula — chronological, not narrated order — so a source with any
non-chronological structure (the *Carol* is almost entirely flashback and flash-forward) tests
exactly the thing that matters.

- **Event recall** against a hand-built event list for the source: ≥ 0.85 of events the fixture's
  Scene Cards' `required_beats` collectively entail.
- **Chronological ordering accuracy** — over all pairs of aligned events, the fraction ordered
  correctly relative to each other (pairwise, not sequence-identity, so one misplaced event costs
  one event's worth and not the whole tail). Bar: ≥ 0.95, and **≥ 0.90 restricted to pairs the
  source narrates out of order**, which is the number actually worth watching.
- **Fabricated events** — events the source **contradicts**: **0**. Unlike an extra character
  row, an invented event propagates into segmentation and plant structure.
  **Report it as a count out of the judged sample** (`0 of 60 judged`), never as a bare zero: a
  zero-tolerance row given without its denominator overstates what was measured.
  An event whose `quote` will not resolve in the source is **not** counted here — that is a
  transcription failure, it is usually a real event the model paraphrased rather than copied, and
  §3.2's *groundable rate* already owns it. The two were added together until #152, which made
  this row read 13 on the *Carol* while every published example was an event Dickens narrates.

### 3.5 Scene segmentation

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
- **Source coverage** — the fraction of the source text assigned to some candidate scene. Bar:
  ≥ 0.95, and **report where the unassigned stretches fall, not just how much there is.** This
  needs no fixture and no judge, only the spans from §3.2, and it catches the failure the
  boundary metrics structurally cannot: a segmentation that quietly drops a stretch of the middle
  still scores well on the boundaries it did produce. Long-context degradation concentrates in the
  middle of a document, so mid-source gaps are the expected shape of this failure rather than a
  surprise — see [`narrative-extraction-prior-art.md`](../research/narrative-extraction-prior-art.md)
  §5.

**On the boundary bar.** Human annotators agree with each other on scene boundaries only
imperfectly — the measured range is in
[`narrative-extraction-prior-art.md`](../research/narrative-extraction-prior-art.md) §3.1, and
chapter-break prediction, a strictly easier task with author-marked ground truth, does worse than
people assume. Two things follow. A boundary bar set near 1.0 would be demanding
better-than-human agreement with one author's segmentation, which is why 0.70 is not timid. And
running the candidate pipeline **twice over the same source** and scoring the two runs against
each other gives a self-consistency number that needs no ground truth: a pipeline that disagrees
with *itself* by more than humans disagree with each other is unstable, whatever it scores against
the fixture.

### 3.6 Reveal order — the told-ledger equivalent

The hardest thing to recover, because the source never states it. A Scene Card's
`reader_must_learn` / `must_stay_hidden` encode *what the reader knows when*, and the source only
implies it.

- **Reveal-order fidelity** — build, from the candidate, the ordered sequence of first-reveal
  scene per `fact_ref`; same from the fixture. Over aligned facts, score pairwise ordering
  accuracy as in §3.4. Bar: ≥ 0.90.
- **Premature reveal count** — facts the candidate marks `reader_must_learn` in a scene *earlier*
  than the source discloses them: **0**. This is the asymmetric error. Withholding a fact one
  scene too long is a craft difference; leaking it early destroys the dramatic irony the package
  exists to encode — the *Carol*'s Stave IV withholding is the fixture case, and Cinderella's
  irony gap is the other (`fixtures/authoring-notes.md` §3).
- **`must_stay_hidden` recall** — of the fixture's `must_stay_hidden` entries, the fraction the
  candidate also withholds: ≥ 0.80. A candidate that recovers no withholding at all has extracted
  a plot summary, not a Syuzhet, however well it scores everywhere else.

### 3.7 Plant/payoff graph

G0 already guarantees the graph is *internally* valid. What's left is whether it's the source's
graph:

- **Plant/payoff pair recall** — aligned `{fact_ref, plant scene, payoff scene}` triples ÷ the
  fixture's: ≥ 0.70.
- **Long-range pair recall** — the same, restricted to pairs spanning ≥ 5 scenes: ≥ 0.60,
  reported separately. Short-range pairs are easy and will carry the aggregate; the *Carol*'s
  "surplus population" plant (Stave I → Stave III) is the case this number exists for.
- **Misattributed plant rate** — pairs whose payoff is right but whose plant scene is wrong:
  report it. It is a different defect from a missed pair and points at a different fix.

### 3.8 Reporting

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
  `entry_state` must not contradict the earlier's `exit_state` on any column both name. **Shipped
  as the linter's `entry_exit_contradiction` error**, so it is already inside G0 and needs no
  separate check — a generated package that trips it is unpublishable, not merely marked down.
  Two bounds keep it sound and are worth knowing before reading a result: it compares consecutive
  scenes only, and only columns both sides name. A contradiction spread across a gap, or asserted
  on one side alone, is outside its reach by construction and remains a judged concern.
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

Three further measurements are cheap, need no judge, and each owns a failure mode the list above
cannot see. They are **reported, not barred** — none has a defensible threshold yet:

- **Arc shape over the event list** — turning-point count and, more importantly, *where* the
  turning points fall, plus the valence trajectory across the arc. Generated arcs skew flatter and
  earlier-peaking than human ones
  ([`llm-arc-generation-prior-art.md`](../research/llm-arc-generation-prior-art.md) §2), and the
  analysis is computable directly on a Fabula event list. Worth noting what this buys: **"uniform
  beat shape" is the one seam-failure row `CONTEXT.md` consciously accepts as unaddressed**,
  because it is only visible in aggregate at the Performance layer. At the Fabula layer it is
  measurable, which means this rubric can hold a line the compiler's rubric explicitly cannot.
- **Cross-arc diversity** — generate N arcs from the same premise and measure how different they
  are from each other. The rubric otherwise measures every arc in isolation, so mode collapse — 
  the best-documented failure in this space — is currently invisible to it no matter how well any
  single arc scores. Semantic breadth/density measures are named in
  [`llm-arc-generation-prior-art.md`](../research/llm-arc-generation-prior-art.md) §8.
- **Lexical canary** — grep generated arcs for the small set of names and nouns documented as
  appearing in an overwhelming share of LLM-written stories (listed in
  [`llm-arc-generation-prior-art.md`](../research/llm-arc-generation-prior-art.md) §2; read them
  there, since that list is a finding and may be corrected). Near-zero cost, and a hit is a strong
  signal of post-training mode collapse rather than a considered choice. A canary, not a criterion:
  a hit prompts a diversity check, it does not fail an arc on its own.

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
- The zero-tolerance items are the ones to argue about last: attribute contradiction (§3.3),
  confirmed welds or splits (§3.3), fabricated events (§3.4), premature reveal (§3.6),
  `contradicts` pairs (§4.2), and G0. Each is zero because a nonzero value is a defect the
  downstream compiler cannot detect or repair — not because zero is convenient.
- **If you only have budget for one thing, do §3.2.** Span grounding needs no ground truth, no
  judge and no fixture, and it separates a pipeline that is reading the source from one that is
  producing plausible-looking Story Packages. Every other number in §3 assumes that question is
  already settled.
- **Numbers cited from the research docs live there, not here.** Several checks are motivated by
  measured figures in `docs/research/`; this file points at the section rather than restating the
  number, so a correction there cannot leave a stale figure in the rubric. Keep that convention
  when adding a check — cite the section, state the bar.

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
  discussion (#113, "Non-goals"), not a rubric exemption. §3.2's span requirement is the live
  example and is deliberately scoped as a pipeline sidecar for that reason.
- **Whether a `pays_off` edge needs a trigger term.** §4.2's *payoff earned-ness* judges whether
  a payoff is set up rather than merely linked, and that judgment stays judged here. Making it
  mechanical would mean the schema representing *why* a payoff fires where it does, which is
  [#124](https://github.com/tschomay/axiom-weaver/issues/124)'s question, not this file's.
- **A harder fixture.** §2 explains why both current fixtures sit at the easy end of the
  difficulty range. Adding a harder source is the fix, and it wants its own ticket once a
  prototype is far enough along for the numbers to mean something.
