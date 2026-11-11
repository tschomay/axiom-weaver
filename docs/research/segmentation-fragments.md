# Over-segmentation on long texts: fragments and told stories (#146)

Measured 2026-11-11 with `gemini-3.8-flash` as segmenter and judge, on the three extraction runs in
`fixtures/extraction/runs/`. The scored runs are in `prototypes/segmentation/<story>/`.

## What the surplus scenes are

The boundary pass on a long text cuts in defensible places and far too often. Listing the
candidate scenes beside the fixture scenes they cover shows two kinds of surplus.

**Fragments.** Groups of one or two events among groups of ten. On *A Christmas Carol*: "They
travel on into the suburbs" (1 event), a remark Bob recounts during the Cratchit dinner (1), the
vision ending and Scrooge back in bed (1), the epilogue (1). On *The Machine Stops*, 20 of the 45
candidate scenes are a single event.

**A told story cut at every interruption.** In *The Machine Stops* Kuno tells Vashti about his
climb to the surface. The extraction alternates between the room and the tale, and the pass cut
on every alternation: "Vashti sighed", "Kuno paused in his narration", "Kuno turns grave again"
were each a scene. 24 of that story's 45 candidate scenes sit inside the one telling, which the
fixture stages as three scenes. The prompt asked for this: "Entering or leaving a flashback, a
vision or a dream STARTS a new scene."

Neither is the entity duplication #146 first suspected. The comment on that issue already ruled
it out.

## What changed

1. **Boundary prompt** (`pass-boundaries.ts`). Two rules: a story one character tells another is
   cut where the tale changes scene, not at the listener's interruptions; and a brief aside inside
   an ongoing scene belongs to that scene.
2. **Fragment absorption** (`grouping.ts`, `absorbFragments`). A judged group smaller than a
   quarter of the run's mean group size loses a boundary. If the scene resumes in the same place
   after it, both boundaries go. Otherwise it joins the neighbour the mechanical signals separate
   it from least. It runs before the plant-span and size constraints, so those still hold.

The threshold is relative because the fixtures need different grains. A quarter of the mean is
one event on Cinderella and *The Machine Stops* and two on the *Carol*.

## Result

One scored run per fixture, before and after. "Before" is the code as it stood, re-scored with
the alignment fix below so the plant columns are comparable.

| | scenes (fixture) | ratio | boundary precision | boundary recall |
| --- | --- | --- | --- | --- |
| Cinderella | 14 → 11 (14) | 1.00 → 0.79 | 0.62 → 0.70 | 0.73 → 0.64 |
| *A Christmas Carol* | 46 → 35 (20) | 2.30 → 1.75 | 0.33 → 0.44 | 0.83 → 0.83 |
| *The Machine Stops* | 45 → 22 (16) | 2.81 → 1.38 | 0.20 → 0.43 | 0.82 → 0.82 |

Both long fixtures are now inside the 0.5–2.0 band where §3.5 says the boundary numbers can be
trusted. Neither reaches the 0.70 precision bar. What is left on the *Carol* is a finer grain
than the fixture's, not fragments: the fixture's opening counting-house scene is five candidate scenes.

Other §3.5 numbers held or improved: source coverage 0.80 → 0.92, 0.87 → 0.90 and 0.70 → 0.85;
beats coverage within 0.01 on all three; G0 passes on all six runs. Beat invention rose from 0.03
to 0.07 on *The Machine Stops* and from 0.00 to 0.03 on Cinderella, on one run each.

### Which change did what

Replaying the grouping over saved boundary decisions, with no model call:

| scenes | as it stood | absorption only | prompt only | both |
| --- | --- | --- | --- | --- |
| Cinderella | 14 | 10 | 15 | 11 |
| *A Christmas Carol* | 46 | 36 | 44 | 35 |
| *The Machine Stops* | 45 | 25 | 28 | 22 |

The prompt does nearly all its work on *The Machine Stops*. Absorption carries the *Carol*.

### The cost: one Cinderella boundary

Cinderella's recall is below the 0.70 bar after the change, and it was not reliably above it
before. Four segmentation runs under each prompt, absorption off:

| | boundary recall | boundary precision |
| --- | --- | --- |
| old prompt | 0.73, 0.64, 0.64, 0.73 | 0.54–0.62 |
| new prompt | 0.64, 0.64, 0.64, 0.64 | 0.50–0.58 |

With absorption on, all eight runs give recall 0.64 and precision 0.70–0.78 at 10 or 11 scenes.
The boundary lost is the same one each time. "The sisters depart for Court" is a one-event group;
the fixture opens a scene on it, and absorption joins it to the scene before, which moves the
boundary one event later and outside the scorer's 270-character window. The fixture also merges
that event into a larger scene. The disagreement is over which side.

I did not add a rule to recover it. Any rule I could write for that one event would be fitted to
the sidecar.

### Generated arcs

Replayed over the nine saved runs in `prototypes/segmentation/generated/`, absorption removes no
boundary on any of them. The prompt change was not re-run on generated input.

## Sensitivity of the fraction

Same replay, baseline decisions:

| fraction | Cinderella | *Carol* | *Machine Stops* |
| --- | --- | --- | --- |
| 0.20 | 10 scenes, recall 0.64 | 36, 0.83 | 45, 0.82 |
| 0.25 | 10, 0.64 | 36, 0.83 | 25, 0.82 |
| 0.34 | 10, 0.64 | 33, 0.83 | 25, 0.82 |
| 0.50 | 6, 0.36 | 29, 0.78 | 19, 0.73 |

0.25 is the smallest value at which a one-event group counts on all three. At 0.5 real scenes
start to go. The step on *The Machine Stops* between 0.20 and 0.25 is a threshold crossing one
event, so the constant is doing the work of "a single event is not a scene when scenes average
four or more".

## Plant recall, re-measured (#162)

#162 asks for §3.7 to be re-measured once #146 lands.

**First, the instrument.** The fact-alignment judge was given two lists of bare slugs and an
instruction written for entities. On the *Carol* baseline it aligned none of the fixture's facts,
so all 18 pairs were never compared. It now gets where each fact is set up and paid off, plus the
annotation's reason on the fixture side, and its decisions are saved in `score.json` under
`fact_alignment`. On the same package it then aligned three.

| matched / fixture pairs | before | after |
| --- | --- | --- |
| Cinderella | 1 / 13 | 1 / 13 |
| *A Christmas Carol* | 1 / 18 | 2 / 18 |
| *The Machine Stops* | 1 / 5 | 0 / 5 |

Recall did not move. Three things the runs show:

- **Coarser scenes mean fewer proposals.** The pass proposed 14 pairs on the *Carol* and 12 on *The
  Machine Stops* before, and 9 and 6 after (Cinderella: 4 both times). It reads scene beats, so fewer scenes give it less to pair.
- **The missing end is missing from the extraction.** On both *Carol* runs the pass proposed the
  "surplus population" and "prisons and workhouses" callbacks and the verifier rejected both,
  correctly: the extraction has an event for each callback (`ev_0270`, `ev_0332`) and none for
  Scrooge's original remarks. The verifier cannot confirm a plant that no event records.
- **Grain still costs pairs.** "Fred invites Scrooge to dinner" was found with its payoff at
  Fred's dinner; the fixture's scene for it maps to the street scene before, so it scores as
  missed.

So the ceiling on §3.7 is set in extraction, at the lines of dialogue that later come back. That
is where #162 should go next, ahead of the pass or the verifier.
