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

The remaining three (#144 events, #145 story-time, #146 segmentation) are genuine pipeline faults.
Two of them are also the upstream of everything else, which is what makes the ordering below fall
out almost automatically.

**And the map is missing three failures no child ticket owns.** All three were found by
recomputing rather than by reading the tickets, and all three are instrument questions before they
are pipeline questions:

| What | Where it stands | § |
| --- | --- | --- |
| Fabricated events, a zero-tolerance row | 13 on the *Carol* against a bar of 0 — and mismeasured | [5](#5-the-first-gap-fabricated-events) |
| Plant/payoff pair recall, §3.7 | **0.00** on the *Carol*, 0.50 on Cinderella, against a 0.70 bar — on a 5-pair denominator | [5a](#5a-the-second-gap-plantpayoff-recall-is-failing-and-unreadable) |
| Objects are orphaned from the Fabula | not one object row on either fixture is referenced by any event | [5b](#5b-the-third-gap-objects-are-extracted-and-orphaned) |

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
  #151  entity-precision denominator      (split out of #143 — §4.3a)
  #152  fabricated-event definition       (§5)
  #153  plant/payoff ground truth sidecar (§5a)

WAVE 2 — upstream pipeline causes
  #144  speech acts as events          ─┐ same prompt, same file, one measurement pass:
  #145  conditional-future story-time  ─┘ do them together (§4.5)
  #154  objects orphaned from the Fabula (§5b — same pass as #144/#145)
  #143  entity merge                     (needs #151's denominator to score against)

WAVE 3 — downstream, re-measured through wave 1 and 2
  #146  segmentation                     (re-measure first; fix only the residue)
  #148  seed-grounded payoffs            (needs #147's judge; reframed by §4.7)
```

Waves 1 and 2 are independent of each other and can run in parallel; wave 3 depends on both.
Within wave 1 the five items are fully independent. Within wave 2, #144, #145 and #154 are one
piece of work over `pass-events.ts` and #143 is separate.

#151 exists because #143 otherwise straddles two waves: its denominator half is an instrument fix
and its merge half is a pipeline fix, and landing them in one PR would make the before/after
unreadable — which is the rule in §2 applied to the ticket that motivated it.

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

**(a) The denominator — now #151.** §2 of the rubric states the three-way split between
contradiction, omission/invention, and different-valid-grain, and says grain differences are
"excluded from the denominator where the rule below says so" — but §3.3 never states that rule, and
`src/extraction/scoring/score.ts` computes `precision = aligned / candidate_rows` flat. The stated
principle has no operative form.

**The rule, decided:** a candidate row is **load-bearing** when some extracted event references it
— in `characters_present`, as the event's `location_id`, or as a `state_changes` entity or
location value. Rows nothing references leave the precision denominator and are reported as a
separate `over_extracted` count. It needs no judge, no gold data and no new field, and it reuses
the opinion the linter already ships as `unused_seed_entity`.

It was chosen by measurement, not by argument, and the measurement is the reason it is scoped the
way it is:

| | rows | ref ≥1 | ref ≥2 | ref ≥3 | rows needed to reach bar |
| --- | --- | --- | --- | --- | --- |
| *Carol* characters | 155 | 97 | 71 | 53 | **23** |
| *Carol* locations | 64 | 50 | 46 | 39 | **17** |
| Cinderella characters | 20 | 16 | **8** | 6 | **9** |
| Cinderella locations | 10 | 6 | **5** | 4 | **5** |
| objects, both fixtures | 95 / 12 | **0** | 0 | 0 | 8 / 4 |

Three things follow, and the third is the one that matters:

- **Adopt it at ≥1 for characters and locations.** It is necessary but not sufficient: at ≥2 it
  lands Cinderella almost exactly on the fixture's grain (8 characters against a 9-row target,
  5 locations against 5), and it does not close the *Carol*, which still carries 53 characters at
  ≥3 against a 23-row target. Take the cut, re-measure after wave 2, and do not stack a second
  rule on top now — #143's merge and #144's event tuning both move this number, and a rule tuned
  before them is a rule tuned against the wrong input.
- **Keep the bars where they are.** Changing the denominator without changing the bar is the
  honest move: it makes the bar mean what §2 already says it means.
- **Do not apply it to objects** — see §5b. Not one object row on either fixture is referenced by
  any event, so the rule would delete the whole table. Objects stay on the flat denominator until
  #154 gives them an attachment point, and the score file says so rather than quietly scoring them
  a different way.

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

## 5. The first gap: fabricated events

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

**Filed as #152**, in wave 1, rather than folded into #144: it is a scoring change in
`score.ts` and #144 is a prompt change in `pass-events.ts`, so landing them together would put an
instrument fix and a pipeline fix in one PR and make the before/after unreadable — §2's rule,
applied to itself.

**And the corrected count is already known: zero, on both fixtures.** The *Carol*'s single
`contradicts` verdict is on a `state_update` (`char_charwoman.location_id` — "the location is Old
Joe's parlour, not Belle's parlour"), not on an event; Cinderella has no `contradicts` verdict at
all. So restricting `fabricated` to judged-contradicts events takes a failing zero-tolerance row to
passing with no pipeline code changed, which is the clearest available demonstration of why §2
comes first.

Two things the fix must carry, or it trades one overstated number for another:

- **The 13 do not disappear, they move.** Unresolvable quotes are a real defect and stay reported
  under §3.2, where `quote_resolution_rate` 0.968 already counts them. The change is which row
  owns them.
- **State the denominator.** The judge saw 60 of 1054 claims on the *Carol* and 45 on Cinderella,
  so the honest result is "0 of 60 judged," never a bare 0. A zero-tolerance row reported without
  its sample size is exactly the overstatement §6 is about.

---

## 5a. The second gap: plant/payoff recall is failing, and unreadable

§3.7's plant/payoff pair recall **is** being scored today — `prototypes/segmentation/*/score.json`
computes it on every segmentation run — and it is failing on both fixtures with no child ticket
owning it:

| | fixture pairs | candidate pairs | matched | recall | bar |
| --- | --- | --- | --- | --- | --- |
| *A Christmas Carol* | 3 | 4 | 0 | **0.00** | ≥ 0.70 |
| Cinderella | 2 | 4 | 1 | **0.50** | ≥ 0.70 |

The *Carol*'s row is the interesting one: segmentation produced four plant/payoff pairs and matched
none of the fixture's three. At a denominator of five pairs across both fixtures, that number
cannot distinguish "segmentation does not recover plants" from "the fixture declared three of the
thirty pairs a reader would name, and the candidate found four different ones." It is the same
ten-edge problem §6 describes, showing up as a bar that is failing for reasons nobody can read.

*Approach — #153, wave 1, and it is an instrument, not a fixture edit.* Annotate the **implicit**
plant/payoff structure of the three fixtures as a **sidecar**, not as new `pays_off` edges on the
packages:

- `fixtures/<story>/plants.annotation.json`, keyed by `fact_ref` plus plant and payoff scene id.
  This is the precedent §3.2 already set for spans — "a sidecar keyed by `fact_ref` and scene id,
  not a Scene Card field," because "the rubric has no authority to change the schema."
- The packages are not touched, so §4.4 holds: nothing re-authors the answer key, the fixtures'
  own `pays_off` graphs and their lint status are unchanged, and ADR 0020 is not relitigated —
  recording pairs a reader would name is not adding a trigger term.
- Build it **from the source, blind to candidate output**, and record the inclusion rule in the
  file, the way §3.1 requires of an alignment file. An annotation built by reading the candidate is
  not ground truth.
- §3.7 then scores against the sidecar when one exists and against the declared graph when it does
  not, and the result says which.

*Falsification.* If recall on a 30-pair denominator lands near the 0.70 bar, the current 0.00 was a
denominator artifact. If it stays near zero, segmentation genuinely is not recovering the source's
plant structure — and that is a real, newly-legible failure worth its own pipeline ticket.

---

## 5b. The third gap: objects are extracted and orphaned

**Not one object row on either fixture is referenced by any event** — 95 object rows on the
*Carol*, 12 on Cinderella, zero references between them. No Fabula field can name one:
`characters_present` is characters-only by design, `location_id` is a `loc_` id, and every
`state_changes.entity_id` in both committed packages is a character.

That makes `pass-events.ts`'s own justification for dropping object participants false in practice.
Its header argues the model "is answering a question the schema does not ask, and their involvement
is already carried by `state_updates` and `location_id`" — 25 such participants were dropped on
Cinderella alone. The involvement is not carried. It is discarded, and the object table is left as
rows nothing downstream consumes, which is why objects are the worst number in the whole extraction
report (precision 0.063 on the *Carol*, 0.25 on Cinderella, recall 0.43).

*Approach — #154, wave 2, in the same pass as #144 and #145.* The events prompt already permits
`object.status` / `object.location_id` / `object.name` writes in `COLUMNS_BY_KIND`; the extractor
simply never produces them. Prompt for them explicitly — an object that a scene moves, breaks,
hides or transfers earns a `state_changes` row — and re-measure object precision and recall
together. Then, and only then, bring objects under #151's load-bearing denominator.

*Two cautions.* The fix must not become "restore object participants": `characters_present` is
characters-only for a reason the cross-reference pass enforces (`wrong_entity_table`), and PR #136
measured 25 of 76 gate errors as objects and locations extracted into the character table. And
object recall is 0.43 on Cinderella — the table is under-extracted as well as over-extracted, so
watch both directions, as §4.5 asks for events.

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

A fourth option exists, and the evidence promoted it from "worth naming" to **decided and filed
as #153**: annotate the *implicit* plant/payoff structure in the existing fixtures, which is far
denser than the declared graph (Cinderella's slipper, the *Carol*'s "surplus population" line —
§3.7 already cites the latter as the case long-range pair recall exists for).

The argument for deferring it was that nothing consumes it yet. That was wrong: §5a shows §3.7 is
scored on every segmentation run today and is failing on both fixtures, so the denominator is live
and unreadable right now. The two objections that remained both dissolve once it is a **sidecar**
rather than fixture edits — no re-authored answer key, no schema change, no ADR 0020
relitigation. §5a has the shape.

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

## 8. Decisions taken

The three questions this file originally left open are closed, each by a measurement rather than a
preference. They are recorded here with what settled them, so a later ticket can reopen one on
evidence instead of taste.

1. **What earns a World Model row** → an event references it (§4.3a, now #151). Adopted for
   characters and locations, excluded for objects until #154, and explicitly *not* sufficient on
   its own: it leaves the *Carol* at 53 characters against a 23-row target. The measurement table
   in §4.3a is the reason it is scoped that way, and the reason no second rule is stacked on it
   before wave 2 lands.
2. **The fabricated-event fix is its own child** (§5, now #152), not folded into #144 — an
   instrument fix and a pipeline fix in one PR is unreadable. The corrected count is already known
   to be 0 of 60 judged on the *Carol* and 0 of 45 on Cinderella.
3. **The implicit-plant annotation happens now**, as a sidecar (§5a/§6, now #153). The deferral
   argument was that nothing consumed it; §3.7 is scored on every segmentation run and is failing
   at 0.00/0.50 on a five-pair denominator, so it is consumed today.

And the map grew two children it did not have: **#153** (§5a) and **#154** (§5b), both found by
recomputation rather than by reading the tickets.

One thing is deliberately still open, and it is a question for after wave 2, not now: **what to do
about the *Carol*'s residual over-extraction** once #151's denominator, #143's merge and #144's
event tuning have all landed. If 53 characters against a 23-row target survives all three, the
remaining gap is a modeling-policy question the fixtures answer only implicitly, and it will want
an explicit answer — possibly an ADR, since it bears on what a World Model seed is *for*. Nothing
in this file pre-empts that, and nothing should until the number is measured through fixed
instruments.

---

## 9. Wave 1: what actually happened

Wave 1 is done — #147, #149, #151, #152 and #153 are merged. This section records the outcomes
against what §§1–8 predicted, because two predictions were wrong in ways that matter more than the
ones that were right, and a plan that quietly drops its failed predictions is not a record.

| Ticket | Predicted | Measured |
| --- | --- | --- |
| #152 fabricated events | corrected count "0 or nonzero, and either is informative" | **0 of 60 judged** on the *Carol*, 0 of 45 on Cinderella — a zero-tolerance row went from failing to passing with no pipeline change |
| #151 entity denominator | "necessary, not sufficient" | exactly that: characters 0.129 → **0.202** (*Carol*), 0.400 → **0.500** (Cinderella), both still far below the 0.85 bar |
| #149 plant-span layer | six arcs' numbers already corrected, three to re-run | all nine now segmented: **mean span falls on every one**, and a fourth arc joins those whose span-1 share rises from 0.00 |
| #147 judge bars | two bars rebuilt, fixtures then pass | non-genericity **fixed** (all three fixtures pass); causal **2 of 3** pass — and the ticket's stated cause was wrong (below) |
| #153 plant/payoff sidecar | a real denominator would show whether 0.00 was an artifact | it is **not** an artifact: 1 of 31 pairs recovered (#162) |

### Three things this file got wrong

1. **#147's root cause was not flashback structure.** §4.1 repeated the ticket's diagnosis and
   proposed scoring causal follow-through over Fabula order. The measurement says the *Carol*'s
   jump seams are **more** causal (0.71) than its continuous ones (0.58). What depresses that
   number is **montage** — the Ghosts' guided tours — not non-chronological telling. #159 owns it.
2. **The first fix for it made things worse, and only re-running caught that.** A fourth
   `discontinuity` verdict looked obviously right and took the *Carol* from 0.63 to 0.38, because a
   seam can be both a story-time jump and genuinely causal, so the new verdict got spent on pairs
   the judge had rated `causes`. Three repeat runs put judge variance at **±0.08**, which is how
   that was established as a real effect rather than noise. Recording the jump *beside* the verdict
   works. **The lesson generalises to wave 2: propose, measure, and be willing to throw the
   proposal away.**
3. **§6 treated the fixture payoff corpus as only a calibration problem.** It is also a *pipeline*
   problem: at n=31 the pipeline recovers one pair. The small denominator was hiding a real failure,
   not just preventing a bar from being read.

### One thing worth keeping that this file did not predict

Judge run-to-run variance on §4.2's causal criterion is **±0.08**, measured over three repeats per
fixture. No bar in §4.2 should be argued to a finer resolution than that, and no single judged run
should be treated as a measurement. §4.2 already says three arcs per configuration; the same rule
applies to the judge itself and did not, until now.

### Where wave 2 starts

Unchanged from §3, with one addition: **#154 (orphaned objects) joins #144 and #145** as one piece
of work over `pass-events.ts`, and #151's denominator cannot be extended to objects until it lands.
The open question §8 left for after wave 2 — the *Carol*'s residual over-extraction — is still open
and still should not be pre-empted.

---

## 10. Wave 2: what actually happened

#144, #145 and #154 landed as one change to `pass-events.ts`, preceded by the held-out-fixture
prerequisite (#164). Same format as §9, and the same reason: one prediction was wrong, and one
piece of method was wrong in a way worth not repeating.

> ### ⚠ Correction: #144's row below is retracted (#167)
>
> Every event-recall figure in this section was produced by an instrument that silently scored a
> failed judge batch as six misses. The same extraction of the *Carol*, scored three times with no
> input change, returned **0.233**, **0.534** and — after the #167 fix — **0.795**. A ±0.30 swing,
> and in the worst run the *Carol* was reported as a *linear* source.
>
> So **"*Carol* recall 0.384 → 0.466" is not evidence.** It is a single-run comparison on an
> unstable instrument, and it should be read as *unmeasured* until re-run. The direction may well
> survive; the number does not. Every recall figure published before #167 — #117's baseline
> included — is a floor, understated by an unknown amount.
>
> #145's and #154's results are **unaffected**: frames-per-window, `future` counts and
> `object_state_updates` are counted mechanically, not judged.
>
> One caveat on the fixed number itself: #167 recovers a failed batch by re-asking one beat at a
> time, so a run with failures is scored by a *mix* of prompt shapes. 0.795 is a better measurement
> than 0.233, and it is not a like-for-like successor to figures produced entirely by the batch
> path. Making the method uniform is the open question #167 leaves behind.

| Ticket | Predicted | Measured |
| --- | --- | --- |
| #154 objects | prompt for `obj_` writes and re-measure both directions | **works, both fixtures**: object `state_updates` 0 → 36 (*Carol*), 0 → 9 (Cinderella), and `dropped_participants` 25 → 0 |
| #144 speech acts | recall rises, watch for over-extraction | ~~*Carol* recall 0.384 → 0.466~~ **retracted, see above**. Candidate events +3.9% is still sound — it is a count, not a judgment |
| #145 frame carry | prompt alone cannot reach the windows; carry the frame | **works**: frames on exactly 12 of 38 windows, `future` 16 → 50, and out-of-order **0.435 → 0.696** on a paired denominator |

### The method error, which cost more than the run it saved

§3 said to do #144 and #145 together because they touch one prompt and one re-run scores both. That
was wrong, and §2's own rule says why: **#144 changes which events exist and which align, #145
changes their buckets, and the out-of-order metric depends on both.** The headline number read
0.580 → 0.467 and looked like a regression. Restricted to the 14 events aligned in *both* runs — the
same 23 pairs scored twice — it reads **0.435 → 0.696**.

The unpaired comparison was not merely noisy, it was measuring a different denominator: recall
improving is what changed which pairs the metric selects. A second extraction run would have cost
about twenty minutes and under a dollar. Untangling it afterwards cost more, and only worked at all
because the alignment files happened to be committed. **Two changes that move the same metric go in
two runs, whatever they cost.**

### The held-out fixture earned its keep immediately

`the-machine-stops` was made scoreable in #164 and never looked at while tuning. Run once
afterwards:

- **Event recall 0.565** — *higher* than either tuning fixture (*Carol* 0.466, Cinderella 0.547).
  There is no before/after here, so this is a generalisation check and not a delta: the point is
  that performance does not collapse on unseen, ontologically novel material.
- **The frame carry generalised to a frame type it was never designed against.** It was built
  against Dickens's ghost-visions; on Forster it fired on windows 6–9 as *"inside Kuno's account of
  his escape"* — a character's spoken recollection. That also independently corroborates the
  hand-written chronology entry, which places Cards 06–08 before Card 05 on exactly that reasoning.
- It stresses what it was picked to stress: `suspicious merge into loc_underground_city: city + the
  Machine` welds the story's central entity into a location, which is #143's territory on the axis
  #132 chose this fixture for.

### Costs, stated rather than buried

More events means more of everything: *Carol* object recall 1.00 → 0.833, location precision
0.260 → 0.228, and ungroundable quotes 13 → 27 with quote resolution 96.8% → 94.9%. None of these
is barred, and none is large, but a change that only ever improves numbers has not been measured
honestly.

### Still open after wave 2

- Out-of-order is **0.696 against a 0.90 bar** — better, not fixed.
- #165: §3.4's event-recall bar is unreachable because its denominator counts standing facts, moods
  and non-actions. Filed during wave 2 under the scope rule, because it blocks #144's bar from
  being readable at all. Not fixed here: it is an instrument change, and bundling one with a
  pipeline change is what splitting #151 out of #143 existed to prevent.
- #143 is the remaining wave-2 ticket, and the held-out fixture has already handed it a case.
- `prototypes/segmentation/*/score.json` now carry a `stale` block: segmentation reads the
  extraction runs this wave replaced, and #146 owns that re-measure in wave 3.
