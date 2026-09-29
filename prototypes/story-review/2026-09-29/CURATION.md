# Story Review Panel — batch 2026-09-29, curated

Five stories from `RANDOM_PREMISES`, generated locally by `npm run review-sample` (arc → segmentation →
publish → telling). Arc: `gemini-3.8-flash` or its capacity fallback `gemini-3.7-flash`; segmentation and every
scene's prose: `gemini-3.8-flash`. Each was read by the six-reviewer panel (`docs/agents/story-review-panel.md`);
the 30 raw reviews are in each story's `reviews/`. Every quote below was checked against `story.md`; findings
that did not survive a reread were dropped. The trace notes behind each root cause are in `CURATION-NOTES.md`.

| Story | Shape | Events | Scenes | Words | Cost | Cons | Grnd | Eng | Char | Pay | Prose | Majors |
| --- | --- | ---: | ---: | ---: | ---: | :-: | :-: | :-: | :-: | :-: | :-: | ---: |
| The Apprentice’s Bill | reckoning | 5 | 3 | 1,508 | $0.08 | 4 | 3 | 3 | 3 | 3 | 2 | 11 |
| The Borrowed Boat | quest | 8 | 6 | 3,577 | $0.19 | 2 | 3 | 3 | 3 | 3 | 3 | 13 |
| Toll | reckoning | 12 | 11 | 6,616 | $0.25 | 2 | 3 | 3 | 3 | 2 | 2 | 22 |
| The Night Shift Letter | courtship | 16 | 16 | 9,003 | $0.34 | 2 | 2 | 2 | 3 | 3 | 2 | 24 |
| Understudy | transformation | 22 | 18 | 10,337 | $0.40 | 2 | 3 | 3 | 3 | 3 | 2 | 20 |
| **Mean** | | | | | | **2.4** | **2.8** | **2.8** | **3.0** | **2.8** | **2.2** | |

**Overall read.** Scene-level craft is good: every lens's "what works" list has real moments, openings are almost
always well placed, and short stories hold together. What fails is *across scenes*: details, secrets, motives and
images that a single scene-writer cannot see beyond its own card. Consistency and prose are the weakest lenses, and
both get worse with length (the 3-scene story scores 4 on consistency; every longer one scores 2).

Issues are ranked by stories affected × severity. Each names the pipeline stage it traces to.

---

## 1. The voice card's imagery palette becomes a per-scene tic — 5/5 stories

**Lenses:** prose (all five), engagement (04). **Stage:** Performance — Voice Card defaults.

Every story's most-repeated image is its preset's `imagery_palette`, verbatim. The writer is handed the same three
images every scene and uses them every scene.

| Story | Preset → palette | What the reader got |
| --- | --- | --- |
| 05 Understudy | lyrical_literary → "light on water", "weather as mood" | a light-on-water simile in all 18 scenes: "rippled like greasy light upon river water" (S1), "like a pool of paraffin caught on black ditch water" (S6), "like an oily ring upon stagnant ditch water" (S13) |
| 04 Night Shift Letter | whimsical_playful → "weather with opinions", "animals behaving as people", "kitchen clutter" | weather throwing a "petulant tantrum" opens or interrupts every scene, ending with S16's "an irritable scullery-maid hurling cold dishwater at a stray tomcat", nearly S5's line again |
| 03 Toll | gothic_brooding → "guttering light", "damp stone and rot" | "tallow" ×9, "guttering" ×6 |
| 01 Apprentice’s Bill | gothic_brooding → "cold weight and enclosure" | "crypt" once in each of the three scenes, plus tomb slab, wake and cadaver |
| 02 Borrowed Boat | fairy_tale_fable → "hearth and ash", "glass and candlelight" | hearth and flue, tallow and fabric similes in five scenes; a fairy-tale palette on a realist grief story |

Also, the preset comes from the *plot shape* (`defaultVoiceCardForPlotShape`), so a quest about scattering a father's
ashes got a fairy-tale voice.

**Recommendation.**
- Treat `imagery_palette` as a *pool to draw from sparingly*, not a per-scene brief. The contract line could be:
  "draw on at most one of these per scene, and not one the imagery ledger shows in the last three scenes".
- Have the imagery ledger cool down at the **domain** level (e.g. "light on water"), not just the exact image, so
  "greasy light on river water" and "paraffin on ditch water" count as the same thing.
- Longer term: pick the preset from the premise's tone, not the plot shape. At minimum, surface
  `voice_card_untouched` (already a lint warning on every one of these) in the Generate flow.

**Should move:** prose, from 2.2. It's the cheapest fix on this list.

---

## 2. Concrete details drift between scenes — 5/5 stories

**Lenses:** consistency (all five), prose, grounding. **Stage:** Performance and digest — a missing memory.

Every detail the prose invents (a material, a number, a name, a backstory) is forgotten by the next scene, which
invents it again.

- **02:** Helen "left Skiff Cove Harbour five winters back for a ledger clerk's stool in Inverness" (S1) becomes
  "You spent three years running railway timetables" in the south (S3). The urn is a brass cylinder (S1), then "the
  sealed tin urn" (S3).
- **01:** Julien sits at "Table 4" (S1) but sends the dessert to "Table nine" (S3). The stolen dish is "the braise"
  in S1 and a quince tart everywhere else.
- **05:** the story's central forgery pushes Maren's entrance "twelve bars" past her music, then makes the cue
  "twenty bars early", then "two speeches late". The escrow is £5,000 (S5), then £20,000 (S12).
- **03:** the bypass pin is brass, then "counterfeit steel", then "turned brass". Hettie's stone is basalt from the
  bread-oven, then a lintel chip, then a "brass hearthstone ring", then river schist.
- **04:** "Julian Miller" becomes "Julian Fromm" (S5). Gable is "she", then "he" (S16). The lease deadline is "the
  thirty-first of January" (S3), then "midnight tomorrow" in November (S14).

**Why.** The writer sees earlier scenes only as digests (event summary, closing situation, imagery), plus the last
paragraph of the scene just before (`renderVerbatimTail`). No digest field records invented specifics.
`grounded_claims` (ADR 0018) covers tracked World Model columns only. Small objects like the wren, the confession
letter and the pin aren't World Model rows at all, so their whereabouts can't be tracked either (04's tin, wren and
confession all move without being shown).

**Recommendation.** Add an `established_details` digest field: short `{entity, attribute, value}` triples the scene
committed to (`urn.material = brass`, `helen.years_away = five winters, Inverness`). Accumulate them per run, and
render the ones for on-stage entities into the next scenes' context as "ESTABLISHED — do not change". The natural home
is extending `grounded_claims` to `bag.<key>` so the existing amnesia check covers them. Also let segmentation add
World Model rows for props that change hands in the arc.

**Should move:** consistency (2.4) and the "details that drift" findings under prose.

---

## 3. Secrets aren't wired into the scene cards, so reveals cheat, repeat or contradict — 4/5 stories

**Lenses:** consistency, payoff, character, engagement, grounding (all five on story 02). **Stage:** Fabula and
segmentation.

- **02, a cheated reveal (the batch's most-flagged defect: 5 lenses).** In S1, "three lines in her father's tidy
  copperplate caught her eye. They were domestic mooring coordinates". Ruth has found something new, and in S2 she
  wonders what Arthur "had hidden". Then in S5: "On his deathbed, while I sat beside his blankets, he … gave me" the
  coordinates and named Clara. In the arc, Ruth always knew (`hidden_02`, and seed `character_knowledge` ck_01). But
  **no event `reveals` or `conceals` the secret**, so segmentation gave every card `must_stay_hidden: []`. The reveal
  card has `reader_must_learn: []`, and `father_second_family_tern_bay` is on no card at all. Card 1's beat says Ruth
  "spots unusual mooring coordinates", and with nothing telling the writer to keep her knowledge offstage, it made
  her ignorant.
- **05, a secret revealed four times.** The forged cue is revealed by Kemper (S6), Maren (S8), Arthur (S9) and
  Hester's confession (S12), each time as news. Trace: `hester_sabotaged_maren_cue` is in `reader_must_learn` on
  **both** scene_06 and scene_08, scene_09 pays off the related ledger fact, and scene_12 `recounts` it.
- **04:** the prank's origin is disclosed in S5 and again as a shock in S13, where Gary reacts as if it's news
  although he confessed it himself in S5.
- **Concealment isn't carried to the reveal (03, 05).** In 03 the duress secret is concealed on scene 1 only and
  revealed in scene 7, with scenes 2–6 unconstrained. 05 is the same (concealed on cards 2–4, revealed later). Only
  04 was fully wired, because its arc happened to list `conceals` on every intermediate event.

**Why.** Wiring depends on whether the arc model fills `reveals`/`conceals` on its events, and nothing checks.
`findWithholding` is a model pass that returned almost nothing here. Lint #180 ("every concealed fact is revealed")
can't fire when nothing is concealed.

**Recommendation** (in order of leverage):
1. **Mechanical withholding.** For a hidden-account fact, or any fact concealed at scene A, set `must_stay_hidden` on
   every scene from A up to its first `reader_must_learn`. Generated arcs know both ends, so no model call is needed.
2. **Lint errors:** (a) a `hidden_account.establishes` fact that no event `reveals` and no card has in
   `reader_must_learn`; (b) the same fact in `reader_must_learn` on two cards (the later one should be `recounts`).
3. **Arc repair:** reject or repair an arc whose hidden account isn't disclosed by some event.
4. **Writer contract:** when a present character knows a fact in `must_stay_hidden`, say so explicitly: "X knows
   this; the narration must not state it, and X must not discover it here."

**Should move:** payoff (2.8) and consistency.

---

## 4. Decisive turns happen off the page — 5/5 stories

**Lenses:** character (all five), engagement, payoff. **Stage:** Fabula (a motive is missing) and cards (turns are
written as outcomes).

- **03:** in S9 Clara tells Hettie that draining the lake cuts off water to five thousand people, and Hettie is
  "unable to answer". S10 opens with her at the lever, and she trips it. Trace: `ev_11_scour_detonation` is
  `caused_by` the archive discovery and Clara's plea, both of which argue *against* the act. No event gives her a
  reason to act now.
- **04:** S13 ends with Julian "entirely undone". S14 opens with him already deciding to give up Hull ("he realized
  with a sharp, hollowing certainty"). The card's beat is itself an outcome: "Julian realizes leaving would be
  running from reality".
- **05:** in S9 Arthur says of betraying Hester, "I would do it again tonight". In S15 she thanks him for having
  "shielded" her, and he answers "my dear". Hester also goes from denial (S8) to public confession (S12) with no
  trigger.
- **01:** Julien's choice to save André's dessert happens between scenes. The only reason given is "not from pride,
  but from the unyielding memory of the labor itself", which explains how his hands move, not why he chose.
- **02:** Helen drops the £200 sale and agrees to share drydock rent with no visible cause.

**Recommendation.**
- **Arc:** promote #192's unmotivated-actions judge criterion to a generation-time check with repair, aimed at climax
  and reversal events: "which earlier event gives this character a reason to do this now, against the reasons given
  not to?"
- **Segmentation:** when a card's beat is a character's decision ("realizes", "decides", "chooses", "confesses"),
  require a preceding beat for the trigger. Render it to the writer as "dramatise the moment of decision on the
  page; do not open the scene after it".

**Should move:** character (3.0) and engagement (2.8).

---

## 5. Stakes raised and dropped, with gaps patched by offstage inventions — 5/5 stories

**Lenses:** payoff, engagement, grounding. **Stage:** Fabula (the ending doesn't answer the setup), then Performance
(the writer papers over the gap).

- **01:** the critic Giles Lambert, set up in S1 as the night's clock, never tastes the dish, so whether anyone learns
  who made it is left open. The arc's final event never mentions him.
- **03:** the five thousand people downstream and the turbine failing "within three weeks" never return.
- **04:** Clara demands the savings envelope and Julian refuses (S14). In S16, "Clara took an envelope stuffed with
  yesterday's manifest duplicates". That swap is not in the arc or on any card: the arc never says what happens to
  the money, so the writer invented an offstage trick to reconcile the two beats. Neil's confession letter, placed in
  the tin in S9, is never read.
- **05:** the deed box Hester locks the ledger in, and Kemper measuring her failing breath, are both set up and never
  used. The ledger moves from the deed box to "the vaults" to Maren's hand to the vanity without being shown.
- **02:** Arthur's debts drive Helen's sale, then vanish.

**Recommendation.**
- **Arc rubric check:** every stake or ticking clock introduced in the first phase is resolved (or explicitly
  abandoned) by an event in the final phase. This is a Fabula check alongside §4.1's gates.
- **Writer contract:** "If the card does not give you the mechanism for an outcome, dramatise it inside this scene.
  Do not report an offstage swap, visit or discovery." Then have the continuity pass flag any new object or event the
  digest introduces that no card or earlier digest has.

**Should move:** payoff and engagement.

---

## 6. Long stories lose their memory: context eviction and re-introductions — 2/5 stories (both long ones)

**Lenses:** prose, grounding. **Stage:** Assembler (volatile-tail budget).

- **04:** the relocation envelope is re-explained in about nine scenes, and locker B-14, the tin, Gable, Gary and
  Clara are each re-introduced as if new.
- **05:** Toby is "the company stage manager whose…" in both S7 and S11, and the dagger's lead plug is explained
  three times.

**Why.** `DEFAULT_VOLATILE_TAIL_BUDGET = 2000` tokens. In 04, **11 of 16 scenes** went over it and dropped "other
character_knowledge" (×11), the "met:" recency slice (×11), and in 6 scenes even "told-ledger rows for this scene's own
facts". Those are exactly the segments that say "the reader already knows X". 05 went over in 6/18 scenes; 01–03 in
0–1. The run reports record this as 46 and 19 `missing_fact` warnings that nobody sees.

**Recommendation.** Raise the budget. Writer prompts here ran 2.1k–5.2k tokens, and one dropped segment is
about 100–200 tokens, so 4,000 costs cents per telling. Also move the told-ledger slices ahead of relationships in
the eviction order. Surface `missing_fact` counts in the run report's summary line.

**Should move:** grounding, and the re-introduction findings under prose.

---

## Smaller things worth a ticket

- **Verbatim tail echo (01):** S3 opens by repeating S2's last line: "The great hand had failed." The tail prompt
  says "open without a seam"; it should add "continue from it; never restate it".
- **Tense ignored (05):** the voice card says `tense: present`, but S1, S10 and S18 are past tense. A cheap post-check
  on the prose would catch it.
- **No length budgets:** every card in all five packages has `length_budget: null`, and 02's S5 hit `MAX_TOKENS` and
  was salvaged. Segmentation could set a default per card.
- **Diagnostic noise:** all 28 `unentailed_reversion` warnings compare free-text `status` strings ("resigned to
  eviction" vs "resigned refugee heading to resettlement camp"). They look like false positives, and they bury real
  signal.
- **Premise pool is 10:** five stories used half of it. Fine for testing, but repeats will be noticeable to a real
  reader of "surprise me".

## What already works (keep it)

- Openings are well placed: the grounding reviewers rarely flagged an unoriented scene start.
- Planted objects that the *arc* pays off land cleanly: the cracked stay and the dismasting (02), the tremor and the
  sugar cage (01), the safety curtain (05), the scour trip and the canal sill (03), the carved wren (04).
- Short arcs hold together. At 3 scenes, consistency scored 4.

## Suggested order of work

1. **Imagery palette as a pool, plus domain cooldown** (#1). Small change, affects every scene of every story.
2. **Mechanical withholding and the two secret lints** (#3). Deterministic, no model calls, fixes the batch's most
   visible defect.
3. **Raise the tail budget** (#6). A one-constant change with a measurable before/after (`missing_fact` → 0).
4. **`established_details` in the digest** (#2). The biggest consistency win, and a schema change, so it needs an ADR
   amendment to 0003/0018.
5. **Motivation and stakes checks on the arc** (#4, #5). Extends existing judge work (#192) into generation.

To check a fix, rerun the same mix of sizes (`--events 5,8,12,16,22`) into a new batch folder, convene the panel,
and compare this table. Consistency and prose are the numbers most likely to move first.
