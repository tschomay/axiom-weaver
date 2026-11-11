# Why segmentation scores 1 of 31 plant/payoff pairs (#162)

A reading of the 31 annotated pairs (`fixtures/{cinderella,a-christmas-carol}/plants.annotation.json`)
against what the plant pass proposed in the recorded runs
(`prototypes/segmentation/{cinderella,a-christmas-carol}/`). No model was called. Every judgement
below that the scorer did not make is mine, from the candidate packages' beats and the annotation's
own `why` lines, and is marked as such.

## What was read, and its limits

- The recorded *Carol* run is not the one #162 quotes. #162 reports 4 candidate pairs and
  `misattributed: 2`; the run on disk (segmented 2026-09-18) has **6** candidate pairs and
  `misattributed: 0`. The "right payoff, wrong plant" thread #162 names as the cheapest start
  cannot be followed from what is committed, because those two pairs are no longer in any file.
- The recorded Cinderella score is marked `stale`: it was computed over the extraction that
  preceded wave 2 of #142. Its candidate pairs are still the ones described here.
- The scorer's fact alignment (`factMap`) is not written to `score.json`, so where this says the
  alignment failed, that is inferred, and the inference is stated.

## The headline

The scorer says 1 of 31. Read by hand, the pass recovered **6 of 31**, and the other five were
lost in scoring, not in segmentation:

| | annotated pairs | scorer counts | a reader counts | candidate pairs | candidate pairs that are wrong |
| --- | --- | --- | --- | --- | --- |
| Cinderella | 13 | 1 | 2 | 4 | 0 |
| *A Christmas Carol* | 18 | 0 | 4 | 6 | 0 |
| both | 31 | **1** | **6** | 10 | **0** |

6 of 31 is 0.19 against a 0.70 bar, so the pass still fails by a wide margin. What changes is the
shape of the failure. Nothing the pass proposes is wrong: all ten accepted pairs are real, six are
annotated pairs and four are pairs the annotation does not list. The defect is volume, and most of
the missing volume is not in the plant pass at all.

## Where each of the 31 went

| outcome | Cinderella | *Carol* | total |
| --- | --- | --- | --- |
| Found and counted | 1 | 0 | 1 |
| Found, not counted: the scorer never compared it | 0 | 2 | 2 |
| Found, not counted: candidate scenes are finer than the fixture's | 0 | 2 | 2 |
| Found, not counted: same plant, payoff placed one scene later | 1 | 0 | 1 |
| One end is not in the beats the pass reads | 9 | 5 | 14 |
| Both ends are in the beats, but the plant scene is outside the proposal window | 0 | 5 | 5 |
| Both ends in the beats and in view, not accepted | 2 | 3 | 5 |
| Seed-grounded (`plant: null`), unrepresentable by design | 0 | 1 | 1 |
| | 13 | 18 | 31 |

### Found, and lost by the scorer (5)

- `marley_foretells_three_spirits` → first spirit, and `portly_gentlemen_solicit_subscription`.
  The candidate declares `three_spirits_warning` (scene 9 → 10) and
  `portly_gentlemans_charity_appeal` (scene 2 → 40). Both sit on exactly the candidate scenes the
  fixture pair maps to through the scene alignment. Neither was counted as matched or as
  misattributed, which in `plantScore` can only mean the fact alignment gave the fixture slug no
  candidate fact, and the pair hit `if (expectedFact === undefined) continue`. The same score file
  reports `reveal_order.aligned_facts: 0` for the *Carol*, which agrees. The alignment judge is
  given the two slugs with underscores turned to spaces and an empty note, and nothing else.
- `fred_invites_scrooge_to_dinner` and `bob_cratchit_underpaid_and_grudged_his_day`. The candidate
  has both (`nephews_christmas_dinner_invitation`, scene 2 → 41, and
  `cratchits_tardy_arrival_and_compensation`, scene 5 → 42). The fixture's one scene "the street and
  Fred's dinner" is two candidate scenes, 40 and 41, and the scene map sends it to 40. The fixture's
  opening scene is candidate scenes 2 to 6, and the map sends it to 2 while the plant is in 5. The
  scene map is single-valued, so at 43 candidate scenes against 20 a correct pair can land beside
  the scene the scorer expects. This is #146 reaching into §3.7.
- `godmother_gave_glass_slippers`. The candidate plants the slippers in the godmother scene, as the
  annotation does, and collects them at the fitting. The annotation collects them at the
  proclamation, one scene earlier. Both readings are defensible.

### One end is not in the beats (14)

The proposer and the verifier see candidate `required_beats` and nothing else: 28 beats for
Cinderella, 136 for the *Carol*. The prompt forbids a pair whose plant "is only implied", and the
verifier is told to reject a plant the beats do not establish. For these fourteen the material is
not there to be found:

- Cinderella, plant absent: the kept second slipper (it appears only where it is produced), her
  excellent taste, the sisters' ill usage, the guards who saw only a country wench, the Prince
  being in love with the slipper's owner, the sisters not recognising her, her bearing it
  patiently. Payoff absent: the oranges and citrons, the refused yellow suit.
- *Carol*, plant absent: "surplus population" and "are there no prisons" (the counting-house beats
  say only that Scrooge refuses to give; both payoff beats do say the Spirit uses "Scrooge's own
  words"), the crutch without an owner, Yes and No naming Uncle Scrooge, Doom on the brow.

What these have in common is that the plant is a line of dialogue's wording, an image, a trait or
an absence. None is a staged action, and the beat layer keeps staged actions. Two of them,
"the sisters do not know her" and "bore all patiently", are beats #165 has just classified as
things the extractor's own prompt forbids it to emit, so they are missing two layers down.

### Plant outside the window (5)

`PLANT_WINDOW_SCENES` is 20. Scenes before the window are shown as one line each, the scene's
`dramatic_function`, with no beats. On the *Carol* at 43 scenes, five annotated pairs have a plant
in scenes 9 to 14 and a payoff after scene 20: the third spirit's arrival, Marley's chain,
Fezziwig's "costs so little", Scrooge's wish to speak to his clerk, and Belle's "another idol".
Each plant is in its scene's beats and none is in its one-liner. At the fixture's 20 scenes the
whole story would fit one window. This is the second way #146 reaches the plant pass.

The window is not an absolute block: three of the six accepted pairs have a plant that was only a
one-liner. They are three whose plant is the scene's whole business (a refused invitation, a refused
appeal, a grudged holiday), so the one-liner points at it.

### Both ends visible, not accepted (5)

`godmother_will_come_when_needed`, `ball_open_to_all_persons_of_fashion`,
`tiny_tims_fate_uncertain`, `the_dead_mans_goods_are_plundered`, `his_death_relieves_his_debtors`.
These are the plant pass's own misses, and the only five of the 31 that are. The *Carol* run
proposed 10 pairs and the verifier rejected 4. Which four is not recorded, so whether any of these
three were proposed and rejected cannot be told from the files.

The prompt asks for this outcome in so many words: "Prefer few, real pairs over many weak ones. A
story of this length typically has a handful." The pass proposed 4 and 10. The annotation has 13
and 18.

## #162's hypothesis: "it only finds explicitly stated rules"

Not as stated. The ten accepted pairs are two rules, two objects, three speech acts and three
events. The version the evidence supports is narrower: **it finds pairs whose plant is a staged
event that survived into a beat**, and nothing else is available to it.

## What this says to do, in order

Nothing here was changed in the pass or in the matching rule, because no change could be measured
in this session (no model access). What was changed is instrumentation only, listed below.

1. **Scorer: stop losing found pairs.** Give the fact-alignment judge something to align on (the
   annotation's `why`, the candidate pair's scenes) instead of two bare slugs, and let a fixture
   scene map to every candidate scene that holds its beats. Until then §3.7 on the *Carol* reads 0
   where a reader reads 4.
2. **#146 before anything in the pass**, as #162 already says, now with two concrete mechanisms:
   the single-valued scene map and the 20-scene window.
3. **Let the pass read more than beats.** Fourteen of 31 are unreachable from `required_beats`.
   The events and their verbatim quotes exist one layer down (456 events on the *Carol*). This is
   the largest lever and the only one that reaches verbal callbacks.
4. **Then the "handful" line**, measured on its own, since it trades directly against the zero
   wrong pairs the pass has now.

Do not read the annotation as a target while doing this: four of the ten accepted pairs are real
and unannotated (the lost slipper → the proclamation; the proclamation → the wedding; the carol
singer Scrooge chases off → his regret in the schoolroom, which Dickens states outright; his
treatment of his clerk → Fezziwig).

## Instrumentation added with this note

- `PlantScore.pairs` records an outcome for every fixture pair, `PlantScore.unalignable` counts the
  ones that were never compared, and `candidate_pair_list` lists what the candidate declared. A
  nonzero `unalignable` is printed beside the recall as a floor warning, the way #167 does for
  unscored beats.
- The segmentation report's `plants.rejected` lists the proposals the verifier turned down, with
  its verdict and reason.

Neither changes a number. The recorded score files were not regenerated, since that needs the
alignment judge.

## Re-measured after #146 (2026-11-11)

Item 1 above is done in part: the alignment judge now gets each fact's setup and payoff scenes and
the annotation's reason, and `score.json` saves its decisions as `fact_alignment`. The scene map is
still single-valued. Item 2 landed as a prompt rule and fragment absorption.

Recall did not move (1/13, 2/18 and 0/5 on one run each), and the runs point further upstream than
item 3 does: the plant end of the *Carol*'s two best-known callbacks is not an event in the
extraction at all. Numbers and reasoning are in `segmentation-fragments.md`.
