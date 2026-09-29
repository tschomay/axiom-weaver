# Story Review Panel — batch 2026-09-29-random, curated

The generalisation check for #194 (#204): a default `npm run review-sample` run (five random premises at 5, 8, 12, 16
and 22 events) after #195–#203 landed, generated locally with `env -u BLOB_READ_WRITE_TOKEN NODE_USE_ENV_PROXY=1`.
Prose on `gemini-3.8-flash`; arcs on `gemini-3.8-flash` or `gemini-3.7-flash` (01). Six-reviewer panel as in
`docs/agents/story-review-panel.md`; 24 raw reviews in each story's `reviews/`. Compare with the same-premise batch,
[`../2026-09-29-after/CURATION.md`](../2026-09-29-after/CURATION.md), and the baseline,
[`../2026-09-29/CURATION.md`](../2026-09-29/CURATION.md).

**Four stories, not five.**
- **`03-review-terms-of-sale`** was refused at publish on the first attempt (`hidden_fact_never_revealed` ×2, the #196
  lint). The retry passed (`index-3.json`).
- **Salt Road** (22 events) was refused the same way on the first attempt. The retry passed lint — its package is kept
  in `05-review-salt-road/package.json` — but the telling died on `429 RESOURCE_EXHAUSTED` (the project's monthly spend
  cap), so it has no story and no reviews.
- **Two of the five random premises repeat baseline ones**, at different sizes: Understudy (8 events, not 22) and Toll
  (16, not 12). They are different arcs, but the premise overlap weakens this as a test of generalisation.

**Verification.** As for the after batch: every major's quotes were checked against `story.md`, with the unmatched
ones grepped by hand. All 53 majors stand; every "unmatched" quote was a reviewer paraphrase or a nested quote.

## Scores

| Story | Shape | Events | Scenes | Words | Cost | Cons | Grnd | Eng | Char | Pay | Prose | Majors |
| --- | --- | ---: | ---: | ---: | ---: | :-: | :-: | :-: | :-: | :-: | :-: | ---: |
| Second Pressing | mystery | 5 | 5 | 3,192 | $0.15 | 3 | 4 | 3 | 3 | 3 | 3 | 8 |
| Understudy | transformation | 8 | 5 | 4,092 | $0.21 | 2 | 3 | 4 | 3 | 4 | 3 | 9 |
| Terms of Sale | courtship | 12 | 10 | 7,612 | $0.33 | 2 | 3 | 2 | 3 | 3 | 2 | 18 |
| Toll | reckoning | 16 | 13 | 9,012 | $0.36 | 2 | 3 | 2 | 2 | 3 | 2 | 18 |
| **Mean (random)** | | | | | | **2.25** | **3.25** | **2.75** | **2.75** | **3.25** | **2.5** | **13.3** |
| Mean (after) | | | | | | 2.4 | 3.0 | 3.0 | 3.0 | 3.0 | 2.4 | 15 |
| Mean (baseline) | | | | | | 2.4 | 2.8 | 2.8 | 3.0 | 2.8 | 2.2 | 18 |

The random batch has no 22-event story, which flatters its majors per story; scaled per 1,000 words it is 2.2 majors
against the after batch's 2.1 and the baseline's 2.9.

## Mechanical checks

| Check | Ticket | Random batch | |
| --- | --- | --- | --- |
| `missing_fact` tail evictions at priority ≤ 4 | #197 | 0 in every story | pass |
| `MAX_TOKENS` writer calls | #202 | 0 | pass |
| `unentailed_reversion` on `status` | #203 | 1 (01) | fail |
| A fact in `reader_must_learn` on two cards; withholding gaps | #196 | 0; 0 | pass |
| `hidden_fact_never_revealed` refusals at publish | #196 | **2 of 5 first attempts** (03, Salt Road) | new problem, §1 |
| `tense_mismatch` / `tail_echo` | #201 | 0 / 0 | pass |
| `detail_drift` | #198 | 0, with 11–28 details recorded per story and **no key ever repeated** | §2 |
| Motive beats installed / stakes declared | #199 / #200 | 1 (01) / 2–3 per story, all with a resolving event | §3 |

---

## 1. The secrets lint now refuses stories at publish — 2 of 5 first attempts

**Stage:** Fabula → segmentation, #196's `hidden_fact_never_revealed`.

The new lint is an error, and arc repair (mechanical, then one model pass) did not fix it on two of five random arcs,
so `review-sample` — and the Generate flow, which lints the same way — refused them. Both premises passed on a
second generation, so it is a property of individual arcs, not of the premise. The refused arcs were not kept (the
script now writes `refused-package.json` and `refused-lint.json` on refusal, so the next one can be traced).

**Recommendation.** Before making this an error at publish, make segmentation able to satisfy it. For a hidden fact no
event reveals and no card pays off, reveal it on the card holding the brief's final-phase event (as
`assignConcealedReveals` already does for a mystery's solution) — or keep it an arc repair target but a warning at
publish, so a generated story is never lost to it.

## 2. `established_details` never collides, so drift goes unseen — 4/4 stories (and 5/5 in the after batch)

**Lenses:** consistency (all four; top finding in three), prose (all four). **Stage:** Performance / digest.

Second Pressing's carboy smells "sweet and flat" and of "fresh grape pulp" (S1–S2), then held pressings "already turned
sour … Full of active mother" (S4); the yield loss is 30% and then 50%. Understudy's Hester has played Malcor for
"eleven unbroken years" (S1, S4) and "thirty years" (S2–S3). Toll's flood is ten years, "three summers" and "twenty
years" ago. Terms of Sale's afternoon cannot fit before its own four o'clock sluice.

Across all ten runs of this re-run (both batches), 205 established details were recorded and **no
`(entity_id, attribute)` key was reported twice**. The mechanism is sound; what the writer reports is the wrong
set — new trivia, never the recurring specifics — and a changed value is recorded under a new key or not at all. Same
recommendation as the after batch §1: ask for the load-bearing, re-referenced details, seed the keys from the
package, and tell the writer to reuse a listed key.

## 3. Endings contradict what the story just established — 3/4 stories

**Lenses:** engagement, character, payoff, consistency (agreement across four lenses).
**Stage:** Fabula — the arc's own reveal is overridden by its climax.

Toll: S9 establishes that the lake's weight is "the only thing" holding up a karst cavern, and draining it means
"tearing the plug from a hollow mountain"; in S11 Teresa opens the scour gate anyway ("The town will endure silt …
They will not drown in a tidal wave") and the collapse never comes. Terms of Sale: Jean lies about the sash ("Just the
coastal damp") and the cellar in S3 and S7, and the ending clears her as the woman who "had warned him about the
southern bay window". Second Pressing: the planted clue (sweet, unsulphited must) points to a different crime from
the one confessed.

**Trace.** In every case the arc's final events were checked by the #199 gate and passed: the act has a stated reason.
What the gate does not ask is whether that reason is consistent with a fact revealed earlier.

**Recommendation.** Extend §2 of the after batch's recommendation: the gate should show the judge the facts revealed
before the climax and ask whether the climactic act contradicts one of them.

## 4. Confessions and turns on demand — 4/4 stories

**Lenses:** character, engagement. Second Pressing's Bruno confesses method, dose and timing the moment he is asked;
Understudy's Hester goes from "She chooses the knife" to coaching Maisie with nothing between; Toll's Pike
volunteers the diversion and Kroll has a seizure on cue; Terms of Sale's Nicholas goes from vengeful to tender between
S4 and S6. Same finding and recommendation as the after batch §2.

## 5. Time, period and place are not tracked — 3/4 stories

Terms of Sale's mobile phone ("the signal is terrible") in a world of gaslamps and vesta cases, and its afternoon; Toll's
elapsed years; Understudy's "tomorrow night" that becomes tonight. Same as the after batch §3.

## 6. Recaps and recycled tags — 4/4 stories

Second Pressing S5 re-explains S4's reveal; Terms of Sale reveals the waiver twice (S8 and S9) and spells out the
combination twice; Toll's chisel or key sits "against her ribs" about ten times and "cold weight" seven times, with one
sentence copied from S2 into S11. The palette-domain tic of the baseline is not the top prose finding in any story.

## Bars from #204, random batch

| Ticket | Bar | Random batch | |
| --- | --- | --- | --- |
| #195 imagery palette | prose ≥ 3.0 | 2.5; palette tic gone, tags recycled instead | fail (moved) |
| #196 secrets | 0 cheats / double reveals | no card double reveal; Terms of Sale's waiver re-revealed in prose; 2 publish refusals | fail |
| #197 tail budget | 0 evictions; re-intro ≤ 1 | 0; Toll re-introduces characters (minor) | pass / near |
| #198 details | consistency ≥ 3.0; drift ≤ 1 per story | 2.25; several per story | fail |
| #199 decisions | character ≥ 3.5 | 2.75 | fail |
| #200 stakes | ≤ 1 dropped stake; 0 offstage inventions | Toll's cavern threat dropped; Terms of Sale's cellar move offstage | fail |
| #201 tail echo / tense | 0 | 0 | pass |
| #202 length | 0 truncations | 0 | pass |
| #203 status noise | 0 | 1 | fail (narrowly) |
