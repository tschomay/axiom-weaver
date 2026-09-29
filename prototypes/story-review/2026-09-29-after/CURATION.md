# Story Review Panel — batch 2026-09-29-after, curated

The acceptance run for #194 (#204): the **same five premises at the same event counts** as the baseline batch
[`../2026-09-29/CURATION.md`](../2026-09-29/CURATION.md), regenerated after #195–#203 landed (PRs #205–#212, #214).
Generated locally with `env -u BLOB_READ_WRITE_TOKEN NODE_USE_ENV_PROXY=1 npm run review-sample -- --premises … --events
5,8,12,16,22`. Arc: `gemini-3.8-flash` or its capacity fallback `gemini-3.7-flash` (01, 03, 05); segmentation and every
scene's prose: `gemini-3.8-flash`. Six-reviewer panel as in `docs/agents/story-review-panel.md`; the 30 raw reviews are
in each story's `reviews/`.

**Verification.** Every major finding's quotes were checked mechanically against `story.md` (curly quotes, dashes and
ellipses normalised), and every quote the check could not match was grepped by hand. All 75 majors stand; each
"unmatched" quote was either a reviewer's suggested wording ("Reader needed: … e.g. *set but not turned*") or a quote
nested inside another. No finding was dropped.

## Scores

| Story | Shape | Events | Scenes | Words | Cost | Cons | Grnd | Eng | Char | Pay | Prose | Majors |
| --- | --- | ---: | ---: | ---: | ---: | :-: | :-: | :-: | :-: | :-: | :-: | ---: |
| The Apprentice’s Bill | reckoning | 5 | 4 | 2,748 | $0.13 | 3 | 4 | 3 | 3 | 3 | 3 | 11 |
| The Borrowed Boat | quest | 8 | 6 | 4,518 | $0.23 | 3 | 3 | 3 | 3 | 4 | 3 | 9 |
| Toll | reckoning | 12 | 9 | 5,742 | $0.22 | 2 | 3 | 3 | 3 | 2 | 2 | 18 |
| The Night Shift Letter | courtship | 16 | 15 | 8,820 | $0.41 | 2 | 2 | 3 | 3 | 3 | 2 | 21 |
| Understudy | transformation | 22 | 19 | 13,301 | $0.48 | 2 | 3 | 3 | 3 | 3 | 2 | 16 |
| **Mean (after)** | | | | | | **2.4** | **3.0** | **3.0** | **3.0** | **3.0** | **2.4** | **15** |
| Mean (baseline) | | | | | | 2.4 | 2.8 | 2.8 | 3.0 | 2.8 | 2.2 | 18 |

Stories are longer (35,129 words vs 31,041) and cost about the same per word ($1.47 vs $1.26 in total).

**Overall read.** The mechanical fixes all landed and show in the run reports: no tail evictions, no double reveal on
any card, no tense switch, no tail echo, no palette tic as any story's top prose finding. Reader-facing quality moved
only a little: +0.2 on four lenses, flat on consistency and character, and three fewer majors per story. Most of what
the panel still finds is the same *cross-scene* failure the baseline found, but it has moved: from secrets and palette
images (fixed) to the parts no card carries — which object is where, what day it is, how old someone was, and why a
person changes their mind.

---

## Mechanical checks (from `run.json`, `package.json` and the local edition store)

| Check | Ticket | Baseline | After | Bar | |
| --- | --- | --- | --- | --- | --- |
| `missing_fact` tail evictions at priority ≤ 4 | #197 | 46 + 19 warnings, 11/16 and 6/18 scenes | **0** in every story (`tail_eviction_scenes` 0) | 0 | pass |
| Writer calls finishing `MAX_TOKENS` | #202 | 1 (02 S5) | **1** (04 S6: 2 beats, 550-word budget; recovered, not degraded) | 0 | **fail** |
| `unentailed_reversion` on `status` | #203 | 28 | **11** (02: 1, 04: 9, 05: 2); 21 multi-word rewordings now `free_text_drift` | 0 | **fail** |
| A fact in `reader_must_learn` on two cards | #196 | several | **0** | 0 | pass |
| Secret withheld on every card up to its reveal | #196 | 1 of 5 stories | 4 of 5; **05** `helen_sabotage_exposed` hidden at S14, not S15, revealed S16 | all | near |
| `tense_mismatch` / `tail_echo` post-checks | #201 | (05: 3 tense switches, 01: 1 echo) | **0 / 0**; 05's present tense held in all 19 scenes | 0 | pass |
| `detail_drift` diagnostics | #198 | — | **0**, with 10–25 `established_details` recorded per story | — | see §1 |
| Motivation gate, motive beats installed | #199 | — | 1 (04) | — | see §2 |
| Stakes declared / `stake_unresolved` repairs | #200 | — | 2–4 per story / 0 | — | see §4 |

Two of the failures are misses in the fixes themselves, not in the stories:

- **#203.** All 11 remaining reversions are *one-word* mood statuses: `char_julian.status` "chilled" → "alerted",
  `char_arthur.status` "exhausted" → "cornered". #203's rule treats a one-word status as enumerable (`alive`/`dead`) on
  purpose, and this arc used single mood adjectives for `status`. **Fix:** let the arc prompt keep `status` physical
  (`alive`, `injured`, `asleep`), and route moods elsewhere; or treat a one-word value that is not in a small closed
  vocabulary as free text.
- **#196.** The one gap is an ordering bug. `findWithholding` (a model pass) runs *after* `wireSecrets`, so a
  concealment it adds at scene 14 is never extended to scene 15. **Fix:** run the extension step again after
  `findWithholding`.

---

## 1. Concrete details still drift between scenes — 5/5 stories

**Lenses:** consistency (all five), prose (all five), grounding (04, 05). **Stage:** Performance / digest —
`established_details` (#198) is recorded but never collides.

| Story | What the reader got |
| --- | --- |
| 01 | the commis who drops the tray is "a girl" (S3), then "the boy's shattered tray at seven" (S4); the kitchen doors are brass and mahogany (S1), then oak (S3) |
| 02 | the halyard is cut and the sail comes down (S2), yet "The sail hung limp from the pine spar" (S5); the keel is oak, then pine |
| 03 | the reservoir holds "thirty fathoms" in some scenes and "eighty fathoms" in others; "before summer" turns into "bitter autumn air" the next morning |
| 04 | the locker key hangs from a wire clip, a ring, a nail, a magnetic clip, a bent pin and a bracket; the £740 is in a boot toe, the flue, the boot he is wearing, then £300 + £500 |
| 05 | the ledger is black velvet (S2), plum cloth (S6), gilt-cornered (S16); the gown is green velvet (S10), crimson (S11), green silk (S14); the play is *The Last Corisande* (S4) and *The Glass Scythe* (S10) |

**Trace.** The field works mechanically: every scene of every story reported `established_details`, and 10–25 per
story reached the ledger. But across all five stories no `(entity_id, attribute)` pair was reported twice, so
`detail_drift` could never fire. What the writer records is incidental texture — Henderson's "peppermint lozenges",
a thermos's "peeling tartan tinware", a bucket's "galvanized" material — not the load-bearing specifics that drift:
where the key hangs, where the cash is, what the play is called. And a later scene that changes a detail coins a
*new* attribute, or doesn't report it at all, so the ledger shows nothing to keep consistent with.

**Recommendation.**
- Ask for the details *most likely to be referenced again* — objects the plot uses, money, ages, dates, titles,
  where a thing is kept — and tell the writer to **reuse** an entity and attribute already in the ESTABLISHED
  DETAILS list whenever it mentions that thing again, rather than coining one.
- Seed the ledger from the package: a card's objects, the World Model's props, the arc's stakes. That way the load-bearing entities
  have keys before scene 1, and the writer fills in their values.
- Make `detail_drift` a continuity-pass repair target (ADR 0011's opening/imagery repair already rewrites prose).

**Should move:** consistency, still 2.4.

## 2. Turns of heart are still stated, not staged — 5/5 stories

**Lenses:** character (all five, top finding in four), engagement (all five), payoff (01, 03, 05).
**Stage:** Fabula — the motivation gate (#199) passes these.

- 01: Kane goes from a gloating "monument" to a weeping, confessing man with nothing on the page between; Julian never
  asks for the retraction he came for.
- 02: the sisters' reconciliation happens between S5 and S6; Ruth never confronts Cleo's secret.
- 04: Arthur drops the Leeds plan he has chased for twelve scenes in one paragraph, then gives the brother who bullies
  him £500.
- 05: Clara's September bargain, the story's turn, is first mentioned in S13; Helen relapses from S13's grace to S14's
  screaming with no trigger.

**Trace.** The motivation gate installed one motive beat in five arcs (04). The judge, asked "does the skeleton show a
reason *before* the act?", accepted events whose reason is a summary word ("undone", "broken"), because the arc
states one. Segmentation's `stageDecisionTriggers` fired once (04); elsewhere no card opened on a decision beat,
because the change of heart is carried in narration inside a scene, not in a beat. The engagement reviewer noted the pattern
across all four of 01–04: each ending leans on the antagonist's sudden confession.

**Recommendation.** Tighten the gate's question to "which earlier *event* changes this character's mind, and is that
event on the page?", and flag an antagonist's confession or collapse in the final phase with no preceding pressure
event. Add a card-level check: a `dramatic_function` or beat containing "reconcile", "forgive", "confess" or "give up"
needs a beat with the other party present.

**Should move:** character, still 3.0 (bar 3.5).

## 3. Timelines and calendars don't add up — 4/5 stories

**Lenses:** consistency, grounding. **Stage:** Performance — no time is tracked.

03's autumn/summer and eleven-year-old/adult Teresa; 04's November week that ends on New Year's Eve with "a fortnight"
and "six more weeks" still to run, and S11 that reads as continuous with S10's morning but is the evening lockout;
05's tour that is in Redcar while "the Dunford run does not conclude until Saturday", and a matinee called "the first"
that Scene 4 set for Thursday and Saturday. 02's night between "fled at daybreak" and "Back already".

**Trace.** Scene Cards carry no time of day or date, and nothing records one. The digest's `closing_situation` often
names a time, but nothing forces the next scene to agree with it.

**Recommendation.** Carry a `story_time` (day, time of day) per card from the arc, or make "when" a required
established detail for the scene itself. Render the previous scene's time in the verbatim-tail header, so a jump has
to be marked.

## 4. Stakes and setups still dropped or resolved by assertion — 4/5 stories

**Lenses:** payoff, engagement. **Stage:** Fabula — stakes are declared at too high a level.

01's bill (the title, and Julian's "he will pay Kane's prices") never returns, and the blacklist retraction is
dropped. 03's town is "saved" by assertion although S6–S7 set up that the plan would cost it power and flood it. 04's
sixty-pound shortfall is built over three scenes and then Arthur simply has £800. 05's locked trunk and key, sealed
severance envelope and dry-rot cornice go nowhere.

**Trace.** Every arc declared 2–4 stakes, and every one had a `resolved_by` event, so `stake_unresolved` never fired.
The stakes the stories drop are ones the arc did not list (the bill, the shortfall), or ones "resolved" by an event
whose summary asserts the outcome.

**Recommendation.** Derive candidate stakes mechanically too: every `reveals` fact whose statement names a number, a
deadline or a threat, and every seed object mentioned in two events. Ask the judge (§2's call) whether the resolving
event shows the resolution or only asserts it.

## 5. Recaps: a known fact is retold as if new — 3/5 stories

**Lenses:** payoff, prose, grounding. **Stage:** Performance — `recounts` is rendered as licence to retell.

04's Kieran dare is revealed on the page in S6 and told again in S12 (twice), S14 and S15; 05's Kenneth pension story
is told in full in S7, S15 and S16; 02 recaps the anchor, Toby's warning and the Lowood revelation. On every card the
fact is in `reader_must_learn` once (#196 holds): the repetition is in prose.

**Recommendation.** Render `recounts` as "the reader knows this; refer to it in a clause, never re-narrate it", and
show the writer which scene told it.

## 6. New prose tics replace the palette tic — 5/5 stories

**Lenses:** prose (all five). **Stage:** Performance.

The palette domain is no longer the top prose finding anywhere (#195). What recurs instead: 05 opens 11 of 19 scenes
with a list of what the place smells of; 03 tags Teresa with "grease-burn scars along her jaw" in six scenes; 02 has
"blistered" on Cleo's hands six or more times; "It was not X; it was Y" appears in 01 and 05; most scenes of 03 and 05
end on an aphorism or a narrator's statement of the emotion.

**Recommendation.** The imagery ledger's rest rule works on domains; add a small *phrase* ledger over scene openings
(first sentence shape) and character tags (a recurring descriptive clause attached to a name), fed from the digest.

---

## Bars from #204

| Ticket | Bar | After batch | |
| --- | --- | --- | --- |
| #195 imagery palette | prose ≥ 3.0; palette not the top prose finding | 2.4; palette gone from top findings, other tics replace it | **fail** (moved +0.2) |
| #196 secrets | 0 cheats or double reveals of a central secret | no card-level double reveal; 04's dare is re-revealed in prose | **fail** (prose-level, §5) |
| #197 tail budget | 0 evictions; re-intro ≤ 1 per long story | 0 evictions; 05 re-introduces Maren, Julian, Toby (minor) | **pass** / near |
| #198 details | consistency ≥ 3.0; drift ≤ 1 per story | 2.4; 2–6 drifting details per story | **fail** (§1) |
| #199 decisions | character ≥ 3.5; no off-page decision as top character finding | 3.0; top finding in 4/5 | **fail** (§2) |
| #200 stakes | ≤ 1 dropped major stake per story; 0 offstage inventions | 01, 03, 04 drop one each; 02's reconciliation is offstage | near / **fail** |
| #201 tail echo / tense | 0 findings | 0 tense or echo findings | **pass** |
| #202 length | 0 truncations | 1 `MAX_TOKENS`, recovered | **fail** (narrowly) |
| #203 status noise | 0 on `status` | 11, all one-word moods | **fail** (§ mechanical) |
