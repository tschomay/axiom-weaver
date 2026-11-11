# The three unmeasured rubric rows: a manual read (#110)

#110 asks for one informal read of a compiled edition against the three seam-failure rows nothing
measures (character-voice homogenization, voice drift, uniform beat shape), to see whether a judge
pass would have anything to find, before building one.

## What was read, and what was not

- **Not Cinderella or the *Carol*.** #110 names those, and no compiled edition of either is
  committed. The editions live in the production blob store and this session had no token for it.
- **Read in full:** `prototypes/story-review/2026-09-29-after/03-review-toll/story.md`, a generated
  story compiled scene by scene with `gemini-3.8-flash`: 9 scenes, 5,742 words, one writer call
  per scene. That is the condition the three rows are about.
- **Read for comparison, not re-read as prose:** the character and prose reviews the Story Review
  Panel wrote for the ten stories in `2026-09-29-after` and `2026-09-29-random`.

One story is a small sample. The findings below say whether there is something to find, which is
the question #110 asks. They are not rates.

## The read

### Character-voice homogenization: present

Four speakers, one register. A farm woman turned mechanic, a dam administrator, a signal
technician and a clinic nurse all make their case as a hydraulic conditional:

- Myra, the nurse (Scene 6): "If you dump eighty fathoms into the riverbeds before summer, the
  clinic loses light, the refrigeration fails, and the dikes down at the bend will scour out like
  wet paper."
- Teresa (Scene 7): "If the apron takes a hydraulic jump at this elevation, the backwash will
  scour the footing."
- Arthur (Scene 7): "If I trip the crest flumes now, the wave reaches the levee bend at Oakhaven
  in twelve minutes".
- Kester (Scene 5): "If Finch tries to trip the auxiliary solenoid from the control desk while
  we're turned in, the circuit won't even register a draw."

Myra's line could be given to Arthur without a reader noticing. In Scene 1 she has a voice of her
own ("If we linger for the sideboard, we go down with the floorboards"), and by Scene 6 it is gone.
The narrator also tags speech the same way for everyone: "his voice flat, drained", "his voice dry
and hollowed out", "his voice scraped raw and pitched low", "her voice dropping beneath", "his
voice flat, gravel-scraped", "her voice taut", "his voice scraping raw", "his voice cracked". Eight
tags of that one shape across seven of the nine scenes.

### Voice drift: not found

The narrator's register, distance and rhythm hold from the first scene to the last: long,
simile-heavy sentences, close on Teresa, past tense. The last scene shortens its sentences, which
suits it. What does drift is the world. Scene 1 has vellum and weir locks, Scene 4 has vacuum
tubes, linoleum and motion sensors, Scene 8 has "the hood of a county car". That is a period and
continuity failure, which `metadata.period` and the consistency lens own, and it should not be
filed under this row.

### Uniform beat shape: present, and the clearest of the three

- **Openings.** Seven of nine scenes open on a paragraph of setting. Three open on the same
  words: "The iron rungs of the access shaft gave way to" (Scene 4), "The iron rungs of the
  descent ladder smelled of" (Scene 5), "The iron rungs gave way to daylight" (Scene 9).
- **Endings.** Four of nine end on Teresa walking away: she "locked the gallery inspection hatch
  behind her" (3), "turned back toward the shadows of the gallery hatch" (4), "turned toward the
  north gallery stair" (8), "turned her back on the hearth and began the slow climb" (9). Most of
  the rest end on a closing line of weight: "like an old promise" (2), "waiting for the hour" (5),
  "a deep and coming dark" (6).
- **The middle.** Description, then a short exchange in which Teresa has the last word, then the
  closing image. Scenes 1, 2, 4 and 6 are built this way.

No single scene is badly shaped. The monotony is only visible across them, which is how the rubric
describes this row.

## Against the panel

The Story Review Panel did not exist when #110 was filed. It is already a judge pass that reads
full prose, so the comparison #230 asks for can be made against it.

| row | this read, on *Toll* | the panel, on the same story | the panel, across all ten stories |
| --- | --- | --- | --- |
| Voice homogenization | present | not reported by the character lens; the prose lens has a minor "Villain and heroine talk in exposition" | reported on 2 of 10 (*Terms of Sale*, and the other *Toll*: "Everyone talks like a hydraulic engineer"); at least two stories are told their voices are distinct |
| Voice drift | not found; the era drifts | agrees: a major on "the setting's era and furnishings shift" | one minor POV drift; tense switches are zero since #201 |
| Uniform beat shape | present: openings, endings and middle | endings only, as a minor; the three "iron rungs" openings are not reported | reported on 4 of 10, as a major on two (the smell-list openings in *Understudy*, the weather simile in *Terms of Sale*) |

The panel finds two of the three rows, and misses them on a story where they are plain. The
reviewer briefs explain why. The character lens lists "interchangeable voices" as one item among
several about motive, and its reviews are spent on motive. The prose lens asks about endings ("ending
every scene on a portentous one-liner") and about recycled phrases, and does not ask about how
scenes open or how they are built. Neither is asked to count.

## What this says about #110

1. **There is something to find** on two rows at the scale of a nine-scene story. #110's guess
   that these failures might not be visible yet at short-story length is wrong for homogenization
   and beat shape, and right for narrator voice drift.
2. **Do not build a separate `gemini-3.5-flash-lite` judge.** A full-prose judge already exists
   and already finds these when it looks. The gap is that it is not asked to.
3. **The change worth measuring** is to name the two rows in the briefs and ask for counts: in
   the character lens, "take three lines of dialogue from different speakers and say whether a
   reader could tell them apart with the tags removed"; in the prose lens, "list how each scene
   opens and how each scene ends, and report any pattern that covers more than a third of them".
   Re-run the panel on the two committed batches and compare against this read and against the
   existing reviews.
4. **Leave voice drift unmeasured for now**, and say so in the rubric. It was not found, and the
   failures near it (tense, POV, era) each already have an owner.

The briefs were not changed in this session. A brief edit changes the instrument every curated
batch was scored with, and it should land together with the re-run that shows what it moved.
