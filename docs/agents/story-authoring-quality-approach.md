# Approach: the rubric shortcomings from #113

The direction for [issue #142](https://github.com/tschomay/axiom-weaver/issues/142) and its seven
children (#143–#149). #142 collects every below-bar result from #113's two entry points and names
a cause for each; it deliberately does not say what order to fix them in, or whether the named
causes are the ones actually driving the numbers. This file answers both, so each child ticket
cites a sequence and a method instead of inventing one.

Vocabulary is [`CONTEXT.md`](../../CONTEXT.md)'s. Bars and section numbers are
[`story-authoring-eval.md`](./story-authoring-eval.md)'s. Every number below was recomputed from
the committed run artifacts (`fixtures/extraction/runs/`, `prototypes/segmentation/`,
`prototypes/arc-generation/`) rather than copied from a PR comment; where a recomputation
disagrees with a ticket, the disagreement is the point and is called out.

---

## 1. The finding that reorders the work

**Four of the seven tickets are measurement faults wearing a pipeline fault's clothes.** #142's
children were written from the numbers the scoring harness reported, and in four cases the harness
is not measuring the thing the ticket's title names. Fix those instruments first, because a
pipeline tuned against a broken instrument fits the instrument's error, and that fit is expensive
to undo: it lands in prompts, in signal weights and in committed `*.score.json` files that later
tickets read as a baseline.

| # | The ticket reads the number as | What the number actually measures | §|
| --- | --- | --- | --- |
| #143 | under-merge (duplicate entity rows) | disagreement with one author's modeling grain — under-merge is a real but minor term | [4.3](#43-143--entity-rows) |
| #147 | two judge bars set too high | one bar is circular by construction; the other is scored in the wrong order | [4.1](#41-147--the-two-failing-judge-bars) |
| #149 | the plant-span histogram read pre-segmentation | *(correct as written — the one instrument ticket whose diagnosis holds)* | [4.2](#42-149--the-plant-span-layer) |
| #148 | generated arcs seed-ground 37% vs the fixtures' 20% | a 5-edge fixture sample with no power to distinguish those rates | [4.7](#47-148--seed-grounded-payoffs) |

And one instrument fault that **no child ticket owns at all** — §5.

The remaining three (#144 events, #145 story-time, #146 segmentation) are genuine pipeline faults.
Two of them are also the upstream of everything else, which is what makes the ordering below fall
out almost automatically.

---

## 2. The rule

> **Calibrate an instrument before tuning what it measures, and never tune two layers at once.**

#146 already states the second half for one case ("don't tune segmentation against the *Carol*'s
current, entity-inflated input"). It generalises to the whole map, and it is the only real
sequencing constraint here: nothing in #142 blocks anything shipped, so the order is free, and the
one thing that can waste the work is measuring wave *n* through an instrument wave *n−1* was
supposed to fix.

The corollary matters as much: **a recalibration is not a bar relaxation.** #147 revises two bars
because the fixtures fail them, and the honest form of that move is to state the new criterion,
re-run the *same* fixtures, and publish both columns. A revision that only ever produces higher
scores is a revision that was fitted to the result.

---

## 3. The sequence

```
WAVE 1 — instruments only, no pipeline change
  #147  judge bars (non-genericity, causal follow-through)
  #149  plant-span at the scene layer
  §4.3a entity-precision denominator      (rubric PR, currently inside #143)
  §5    fabricated-event definition       (unowned — proposed as a new child)

WAVE 2 — upstream pipeline causes
  #144  speech acts as events          ─┐ same prompt, same file, one measurement pass:
  #145  conditional-future story-time  ─┘ do them together (§4.5)
  #143  entity modeling policy + merge   (needs §4.3a's denominator to score against)

WAVE 3 — downstream, re-measured through wave 1 and 2
  #146  segmentation                     (re-measure first; fix only the residue)
  #148  seed-grounded payoffs            (needs #147's judge; reframed by §4.7)
```

Waves 1 and 2 are independent of each other and can run in parallel; wave 3 depends on both.
Within wave 1 the four items are fully independent. Within wave 2, #144 and #145 are one piece of
work (§4.5) and #143 is separate.

**What "wave 1 is done" means:** `docs/agents/story-authoring-eval.md` carries the revised
criteria, the scoring code implements them, and the two fixtures have been re-scored through the
new instruments with both the old and new columns published. Until that holds, no wave-2 or
wave-3 number is comparable to anything.

---

## 4. Per-ticket approach

Each subsection gives: what the ticket claims, what the artifacts say, the approach, and what
would falsify it. Where the approach departs from the ticket's "what fixed looks like," that is
stated first.

### 4.1 #147 — the two failing judge bars

**The ticket is right that the bars are wrong, and understates why.** Neither is a threshold
problem. Both are construction problems, and naming them that way makes the fix concrete instead
of a matter of taste.

**Non-genericity is circular.** `judgePrompt` (`src/arc/judge.ts`) asks the judge to *name the
closest stock shape it can*, then rate the arc's adherence to that self-supplied label. The label
is derived from the arc, so adherence is maximal whenever the arc is a clean instance of anything
nameable. The judged output shows exactly this: the judge labelled Cinderella "Cinderella-type
rags-to-recognition" and scored 5/5. All nine generated arcs drew genre labels instead
("industrial accident inquiry whodunnit", "fair-play whodunnit with protective culprit") and
scored 2–3 — not because they are less generic, but because a genre label does not determine
events, so nothing can fully adhere to it. **The metric is measuring how specific a label the
judge happened to choose.**

*Approach.* Replace "resemblance to a self-named shape" with **particularisation**, which is what
§4.2 says the criterion is for ("the failure is when nothing but the labels differ"). Two ways to
do it, and they compose:

1. **Fix the label set a priori.** Give the judge a closed inventory of stock shapes and make it
   pick one. A label the judge could not tailor to the arc restores the comparison the current
   prompt destroys.
2. **Ask the inverse question.** "List the elements of this arc that a reader who knew only the
   label could *not* predict." Count them, and weight by whether they are load-bearing (does the
   arc's own causal chain run through them) or decorative. A canonical instance scores well here —
   Cinderella's irony gap and the midnight condition are not predictable from "rags-to-recognition"
   — which is the property the current bar lacks.

*Falsification.* Re-run the revised criterion on the three fixtures and the nine generated arcs.
If it still scores the fixtures at the failing end, it is measuring resemblance again. If it scores
*everything* well, it has lost the failure mode; check it against a deliberately inert arc
(`arc_no_span_guidance_kiln`, whose 16 edges include five at spans of 1–3, is the nearest thing
the corpus has).

**Causal follow-through is scored in the wrong order.** `judgePackage` walks scenes in
`scenesInOrder(pkg)` — Syuzhet order, the order the story is told. Causation runs along the
Fabula. On a linear arc the two coincide and the metric is fine; on the *Carol*, every Stave seam
is a pair of scenes that are adjacent in the telling and hours or decades apart in the story, so
`merely_follows` is the only honest verdict available and the 0.63 is a property of the telling,
not a defect in the arc.

*Approach.* Score causal follow-through over **Fabula order**, and make the input order an
explicit, reported field of the judge result. Then add the missing third category: a Syuzhet seam
that is a deliberate juxtaposition is neither `causes` nor `merely_follows`, and forcing it into
one of the two is what produced the failure. Concretely — `caused_by` already exists on the event
schema and `story_time` already exists on extracted events; a pair spanning a `story_time` change
is identifiable without a judge, and should be excluded from the denominator rather than counted
as a miss.

*Two cautions.* The `contradicts` verdict must stay on **Syuzhet** order as well as Fabula —
a contradiction between consecutively *told* scenes is a real defect regardless of chronology, and
it is the zero-tolerance half of this row. And the `earned` bar fails calibration too (Cinderella
0.50), which #147's body notes in its table but does not list as a bar to revise; §6 explains why
that failure is a sample-size artifact rather than a third broken criterion, and why #147 should
say so explicitly rather than leave it looking unaddressed.

### 4.2 #149 — the plant-span layer

**The one instrument ticket whose diagnosis is exactly right**, and the cheapest item in the map:
`scoreMechanicalPackage` already exists (#120, PR #140) and `scripts/segment-arcs.ts` already calls
it. The work is repointing the default and re-publishing the numbers.

*Approach.* Follow the ticket as written, with one addition. Make `scoreMechanical` (the projection
path) **name its layer in its own output** rather than being silently replaced — the projection is
still the only thing available for a Fabula-only package that has not been segmented, so it cannot
simply be deleted, and a histogram that does not say which layer produced it is the whole defect
here. Add the layer to the score file's shape and to `prototypes/arc-generation/*.score.json` on
the re-run.

Re-run rather than annotate. `docs/research/generated-arc-segmentation.md` §7 already carries the
corrected numbers for six of the nine arcs; completing the set is three segmentation runs, and
leaving two sets of numbers in the repo with a note pointing between them is how the next ticket
picks up the wrong column.

### 4.3 #143 — entity rows

**This is where the approach departs from the ticket most sharply.** The ticket's root cause is
real: `char_marley` / `char_jacob_marley` / `char_marley_s_ghost` are one entity, and the
downstream POV-agreement consequence it names (flat 0.00 on the *Carol*) is a genuine, expensive
failure that a canonicalization pass fixes. But under-merge is **not** what drives the precision
numbers the ticket opens with, and a canonicalization pass alone cannot reach the bar it cites.

Two pieces of evidence, both from committed artifacts:

**Cinderella has zero duplicates and still scores 0.40.** Its twelve unaligned character rows are
`Mademoiselle de la Poche`, `gentleman's first wife`, `tire-woman`, `six mice`, `coachman`,
`six lizards`, `The King`, `Queen`, `sisters`, `three huge rats`, `guards`,
`two great lords of the Court`. Not one is a duplicate of a principal. Every one is an entity the
source genuinely names and the fixture chose not to model — which
[`story-authoring-eval.md` §2](./story-authoring-eval.md) classifies as *different valid grain* and
says explicitly is "**not** an error."

The single row that touches coreference at all is `sisters`, a collective standing for the two
stepsisters the fixture models as `char_stepsister_elder` and `char_stepsister_charlotte` — and
that is the *over*-merge direction, the failure `pass-reconcile.ts` was deliberately built to
avoid. Under-merge contributes nothing to Cinderella's 0.40.

**On the *Carol*, the arithmetic does not close.** Of 135 unaligned character rows, roughly 35
share a word with a principal (the population a merge pass can reach, and not all of those are
merges — `Belinda Cratchit` and `Mrs. Fezziwig` are distinct people the fixture folded away), ~27
are collectives (`Fifty Cooks and Butlers`, `innumerable people`, `gold and silver fish`), and ~73
are singular walk-ons and allusions — `the postboy`, `the milkman`, `Topper`, alongside `Ali Baba`,
`Robin Crusoe`, `Friday`, `Saint Dunstan`: characters in books Scrooge remembers *reading*, which
are not entities in this story at all. Reaching character precision ≥ 0.85 with 20 aligned rows
requires the candidate to carry **≤ 23 character rows total**. The ticket's stated fix — merge the
22 flagged `suspicious_merges` groups — takes 155 to roughly 133, and precision from 0.129 to
about 0.15.

The same arithmetic on the other tables: locations need ≤ 17 rows (candidate: 64), objects ≤ 8
(candidate: 95).

*Approach — split the ticket in two, and do (a) first.*

**(a) The denominator.** §2 of the rubric states the three-way split between contradiction,
omission/invention, and different-valid-grain, and says grain differences are "excluded from the
denominator where the rule below says so" — but §3.3 never states that rule, and
`src/extraction/scoring/score.ts` computes `precision = aligned / candidate_rows` flat. The stated
principle has no operative form. This is a rubric PR under §5 and belongs in wave 1:

- Define what earns a World Model row, as a rule the scorer can apply. The fixtures already encode
  one — `fixtures/authoring-notes.md`'s `merge_policy` and its "deciding what *not* to model was
  real effort, and is invisible in the output." Candidates: an entity that some event's
  `state_updates` writes to, that appears in more than one event, or that a Scene Card would name.
  An entity mentioned once in a simile or inside a character's remembered reading earns no row.
- Rows failing that rule leave the precision denominator and are **reported as a separate
  over-extraction count** — visible, unignorable, and not conflated with welding two people into
  one. Over-extraction is still a cost (190 `unused_seed_entity` warnings on the *Carol*'s
  segmented package is what it looks like downstream); it is just not the same defect.
- Keep the bars where they are. Changing the denominator without changing the bar is the honest
  move: it makes the bar mean what §2 already says it means.

**(b) The merge.** Then do the ticket's own fix, scored against the metric that is actually
sensitive to it: **confirmed weld/split count** (§3.3, zero-tolerance) and the POV-agreement number
in `prototypes/segmentation/a-christmas-carol/score.json`, currently 0.000. Those are the numbers
under-merge moves. Precision will barely move, and that is the correct outcome, not a failed fix.

*Falsification.* If, after (a), the *Carol*'s character precision is still far below bar and the
remaining unaligned rows are principals rather than walk-ons, the grain hypothesis is wrong and the
ticket's original framing was right. The check is cheap: it is a read of the `inventions` list.

### 4.4 A caution for (a): do not re-author the fixtures

The tempting shortcut is to add the walk-ons to the fixture packages so the candidate aligns. That
inverts the answer key — §2 is explicit that the fixture is "*one valid* authoring, not the unique
correct one," and a fixture edited to match a pipeline measures nothing. The fixtures change only
when they are found *wrong about the source*, never when they are found different from a candidate.

### 4.5 #144 and #145 — one piece of work

Both are prompt-level changes to the same pass (`src/extraction/pass-events.ts`) and both are
scored by the same re-run, so splitting them costs a whole extraction run over both fixtures for no
benefit. Do them as one change with two measurements.

**#144 (speech acts).** The ticket's diagnosis is correct and its caution is the important part:
recall 0.38–0.53 comes from the prompt reading dialogue as description, and the fix's risk is
flipping to over-extraction. Two things make that risk manageable:

- The prompt already contains the pattern to copy. Its `story_time` bullet handles a similar
  both-things-at-once case well ("A scene in which a character is SHOWN a memory contains both").
  The speech-act rule wants the same shape: a *request*, a *refusal*, a *declaration* and a
  *revelation* are events; a line of dialogue that conveys none of those is not.
- Measure against `ground_truth_events` recall **and** the §5 over-extraction count from §4.3a
  together, on both fixtures, in one run. Recall alone will reward every line of dialogue becoming
  an event.

**#145 (conditional future) has a structural cause the ticket does not name.** The ticket reads it
as the classifier following grammatical tense. That is true, but it is downstream of something the
prompt cannot fix on its own: **`extractEvents` passes each window the entity roster and the
excerpt, and nothing else.** There is no carry-over of narrative state between windows. The
sentence that establishes Stave IV as a vision — the Ghost showing "shadows of things that have not
happened, but will happen" — appears once, at the start of the Stave; at a ~800-word window target
over a 157k-character source, the remaining ~6 windows of Stave IV are read with no signal that
they sit inside a frame. Sharpening the prompt helps only the window containing the framing
sentence. The measured shape agrees: 16 `future` of 441 events.

*Approach.* Carry a small frame state across windows, the way `pass-reconcile.ts` already carries
the canonical roster — a one-line "currently inside: a vision of the future, shown by X" that the
events pass writes and the next window reads. That is the same architecture the pipeline already
uses for the one other thing that cannot be decided window-locally, and it needs no schema change.
A cheap global re-bucketing pass over event summaries plus `time_anchor` is the fallback if the
carried state proves unreliable; prefer the carry, because a re-bucketing pass re-reads structures
that have already lost the framing.

*One honest limit, worth writing into the ticket.* `fixtures/authoring-notes.md` §1 records that
the fixture author hit this same problem at the schema level and had no clean answer: Stave IV's
corpse got its own entity (`char_dead_man`) because "there is no schema-native way to say 'this
entity is dead' and 'this entity is alive and standing right here' at the same time." So the ground
truth for Stave IV is itself a workaround, and the *showing* is genuinely present-tense while the
*shown* is future. A classifier that labels the showing `present` is not simply wrong. Score the
**shown** events, and say which is which in the result.

*And the measurement is one-fixture.* Cinderella's `out_of_order_total` is 0 — the metric has no
denominator there. `the-machine-stops` is told straightforwardly and will not supply a second
point either. So #145's number rests entirely on the *Carol* until a fixture with non-chronological
telling exists, which `story-authoring-eval.md` §2 already lists as wanting its own ticket. Do not
tune to three decimal places against a single text.

### 4.6 #146 — segmentation

**The ticket's instruction is right: re-measure before touching anything.** What it does not have
is the mechanism, and the mechanism is worth stating because it predicts how much of the
over-segmentation is inherited.

`src/segmentation/signals.ts` weights `cast_disjoint` at 0.35 and `cast_churn` at 0.20 — 0.55 of
1.45 total weight mass, 38%, the largest single block, and deliberately so ("a disjoint cast
outranks a location change"). Both are computed as set operations over `characters_present`.
Duplicate ids for one person make those sets differ across adjacent events *even when the same
person is on stage throughout*, which drives `cast_overlap` down and `cast_disjoint` up. So #143's
duplicates feed directly into segmentation's heaviest signal, and the *Carol*'s 2.35× scene-count
ratio against Cinderella's clean 0.82/0.75 is exactly the shape that predicts.

*Approach.* Re-run segmentation on the post-#143 extraction, and read four numbers before changing
a weight: scene-count ratio, boundary precision (0.261), POV agreement (0.000) and
`unused_seed_entity` (190). POV agreement should move first and most — the ticket's own evidence
says it is 0.00 *by construction* from id mismatch, so anything short of a large jump means #143
did not land. Only the residue after that is segmentation's own, and then the lever is the boundary
pass prompt and the weights, in that order: the weights encode an argued ranking (§"Why none of
these is a hard rule") and should be the last thing touched.

*Falsification.* If the ratio stays near 2.35 with a clean entity set, the inheritance hypothesis is
wrong and this is a plain threshold problem on longer texts — in which case the honest fix is
length-aware calibration, and #118's own finding (a mechanical baseline giving 4 scenes for
Cinderella and 71 for the *Carol*) says no single threshold will serve.

### 4.7 #148 — seed-grounded payoffs

**The ticket is chasing the right defect with the wrong instrument.** Its headline comparison —
37% of generated payoff edges seed-grounded versus the fixtures' 20% — cannot support the
conclusion. The recomputation confirms the numbers exactly (31 of 83 generated; 1 of 5 across the
two realist fixtures) and that is the problem: **5 edges**. If generation seed-grounded at
precisely the fixture rate, the chance of seeing ≤ 1 of 5 is about 0.38. Including
`the-machine-stops` gives 2 of 10 and a chance of about 0.21. The fixture baseline and the
generated rate are indistinguishable, and "measure the seed-grounded share against the fixtures'
~20% as a rough target" asks for a fit to noise.

A second recomputation removes the other obvious lever. Seed-grounded share is **flat across
generation configurations** — 0.35 free-text, 0.35 without span guidance, 0.42 structured with it —
and per premise it moves in both directions (kiln 0.44 with span guidance vs 0.25 without). So
tightening span guidance will not touch this; the span block did its job on spans (the kiln premise
goes from 16 edges whose spans start at 1, 2, 2, 3, 3 to 9 edges whose shortest span is 5) and
seed-grounding is orthogonal to it.

**The signal the ticket needs is its own second sentence**, and it is strong. Cross-tabulating
`judged.json`'s per-edge verdicts against each edge's plant type, over the nine generated arcs:

| | earned | linked_only | earned share |
| --- | --- | --- | --- |
| seed-grounded (`plant: null`) | 14 | 17 | **0.45** |
| planted | 46 | 6 | **0.88** |

83 edges, not 5. **17 of the 23 unearned verdicts in the whole generated corpus sit on
seed-grounded edges, which are only 37% of it.** Generated arcs score 0.72 earned overall against
a 0.70 bar; drop the seed-grounded edges and the same arcs score 0.88. Seed-grounding is not a
stylistic preference the generator over-uses — it is where earned-ness actually fails.

*Approach.*

- **Retarget the ticket** at the earned share *within* seed-grounded edges (0.45), reporting the
  seed-grounded share alongside as context rather than as the thing to move. That metric has a
  usable denominator and it names the defect.
- **The prompt lever is the framing, not the span block.** `src/arc/prompt.ts` presents
  seed-grounding as a co-equal option ("A fact that is true from the start of the story instead
  uses `plant: null` … There is no third option"). The guidance to add is what makes a
  seed-grounded payoff earn its verdict: a fact true from the start still has to be *made to
  matter* before it is collected. Guidance, per ADR 0020 — never a generator-side gate, and never a
  count target, which would just push the failure into a different column.
- **It is gated on #147.** Earned-ness is a judged criterion and §4.3's calibration on it is one of
  the failing rows. Re-judge after the judge is calibrated, or the before/after is unreadable.

*Falsification.* If, after #147, the seed-vs-planted earned gap collapses, the whole ticket was an
artifact of judge calibration and should close — that outcome is a result, not a waste.

---

## 5. The gap in the map: fabricated events

**No child ticket owns a zero-tolerance rubric row that is currently failing.**
`fixtures/extraction/runs/a-christmas-carol/score.json` reports `fabricated: 13` against §3.4's bar
of **0** — the row the rubric singles out because "unlike an extra character row, an invented event
propagates into segmentation and plant structure."

It is also a measurement fault, which is why it belongs in wave 1 rather than as a bug. `score.ts`
computes fabricated as *ungrounded-quote* ∪ *judge said contradicts*, and the first term dominates:
the ten published examples are all events the source genuinely narrates (Fezziwig skipping down
from his desk, Bob Cratchit visiting the burial place, Mrs. Cratchit's toast). They are flagged
because the model paraphrased instead of copying its `quote` verbatim, so the span would not
resolve. That is a real defect — §3.2 is the rubric's cheapest decisive check and it deserves to
fail loudly — but it is *already* reported, as `quote_resolution_rate` 0.968 and 34 unresolved
claims. Counting it a second time under "invention" conflates a transcription failure with a
hallucination and makes a zero-tolerance row unreadable.

*Proposed as an eighth child of #142*, in wave 1: restrict `fabricated` to the judged
`contradicts` verdicts (invention proper), keep ungroundable quotes reported under §3.2 where they
already live, and re-read the resulting count. If it is nonzero, extraction has a hallucination
problem and that is a new ticket with real teeth; if it is zero, a zero-tolerance row goes from
failing to passing without a line of pipeline code changing, which is the clearest possible
demonstration of why §2's rule comes first.

---

## 6. The cross-cutting constraint: the plant/payoff corpus is ten edges

Three separate calibration failures in this map trace to one fact. The fixtures declare **2, 3 and
5** `pays_off` edges (Cinderella, the *Carol*, *The Machine Stops*) — ten in total, against nine
generated arcs carrying 83.

That sample cannot calibrate a rate:

- #148's 20% baseline rests on 5 edges (§4.7).
- #147's failing `earned` row — Cinderella 0.50 — is **1 of 2 edges**. It is not evidence of a
  broken criterion; it is one judgment.
- §4.1's plant-span histogram has a fixture reference of ten spans: `[2, 5]`, `[7, 8]` and
  `[1, 2, 5, 7]`.

This is not a defect in the fixtures. Real stories declare few explicit plant/payoff edges — the
brief's own note records the fixtures at about 0.15 edges per scene and builds `plantPolicyFor`
around that — and inflating the fixtures to get a denominator would be re-authoring the answer key
(§4.4).

*What to do instead,* in priority order:

1. **Prefer within-corpus comparisons for payoff metrics.** Seed-grounded versus planted edges
   inside the generated corpus (n=83) has power; generated versus fixture rates (n=10) does not.
   §4.7 is the worked example.
2. **State the denominator next to every fixture-derived payoff number,** in the rubric and in
   score files. `earned 0.50` and `earned 1 of 2` are different claims and only one of them is
   honest.
3. **Treat a fixture payoff rate as a sanity screen, never a bar** — the same status §3.3 already
   gives entity-count sanity and the merge signature.

A fourth option exists and should be named rather than assumed away: annotate the *implicit*
plant/payoff structure in the existing fixtures, which is far denser than the declared graph
(Cinderella's slipper, the *Carol*'s "surplus population" line — §3.7 already cites the latter as
the case long-range pair recall exists for). That is fixture work with a real cost and a real
judgment call about what counts as a declared plant, so it is a ticket of its own, not a step
inside one of these seven.

---

## 7. What this approach does not do

- **No schema change and no ADR 0001–0020 change.** #142's non-goals, restated because §4.5's
  frame-carry and §4.3a's row rule both sit close to the line: the frame state is pipeline-internal
  and never reaches a Scene Card, and the row rule is a scoring rule, not a schema constraint. If
  either turns out to need a field, that is an ADR discussion under the rule #113 established.
- **No fixture edits to close a scoring gap** (§4.4).
- **No new bars.** Wave 1 revises how three existing criteria are computed and restates a fourth's
  denominator. Every numeric bar in §3 and §4.2 stays where it is until a measurement through a
  fixed instrument argues otherwise — which is `story-authoring-eval.md` §5's own rule.
- **Nothing at the Performance layer.** Every ticket here is Fabula/Syuzhet; the seam-failure
  rubric in `CONTEXT.md` owns prose.

## 8. Open questions for the owner

Three decisions this file deliberately does not make, because they are calls about what the project
wants rather than readings of the evidence:

1. **What earns a World Model row** (§4.3a). The rule is writable several ways and the choice sets
   what extraction is *for*: a package that models every walk-on is more faithful and much more
   expensive to author against. The fixtures' implicit answer is the narrow one.
2. **Whether the eighth child (§5) gets filed**, or whether the fabricated-event definition is
   folded into #144 as part of the same events-pass work. Filing it separately keeps a
   zero-tolerance row visible; folding it in is one fewer ticket.
3. **Whether the implicit-plant fixture annotation (§6)** is worth its cost now or after the
   generation path has more arcs to measure. It is the only thing that would give the payoff
   metrics real ground truth, and it is the most expensive item named anywhere in this file.
