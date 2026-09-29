# Curation working notes (in progress — superseded by CURATION.md)

## Story 02 The Borrowed Boat — coordinates contradiction (4 lenses: consistency, payoff, engagement, character, grounding)
- Fabula: Ruth KNOWS (hidden_02 deathbed confession; seed character_knowledge ck_01 char_ruth → deathbed_confession_to_ruth).
  Hidden from the *reader*, not from Ruth.
- Segmentation: scene 1 required_beat says Ruth "spots unusual mooring coordinates… in his logbook" — phrased as discovery.
  reader_must_learn includes tern_bay_coordinates_in_logbook. must_stay_hidden: [] (!) although the second family is
  withheld until scene 5.
- Performance: writer rendered "discovery" literally → Ruth puzzled. Scene 5 then pays off the fact as Ruth's prior knowledge.
- Candidate root cause: the beat wording + no POV-knowledge / concealment signal on the card. TODO check whether the writer
  prompt carries POV character_knowledge.

## Story 02 other
- Scene 5 writer call hit MAX_TOKENS → salvaged/digest fallback. Double arrival (Low Water Creek end S4 / Tern Bay Creek S5).
- Detail drift across scenes: urn brass→tin, hull wood, Helen's backstory (Inverness 5 winters vs south 3 years), wheel vs tiller.

## Story 01 The Apprentice's Bill
- Braise vs quince tart; Table 4 vs Table nine; critic dropped (never tastes); vow kept on a kitchen ticket never shown to carry the name.
- Scene 3 opens repeating Scene 2's last line. "crypt" x3.

## ROOT CAUSE (story 02): hidden account never wired into reveals/conceals
- _fabula events: no event `conceals` anything; ev_07 (the revelation) `reveals: []`.
- So segment.ts: carried reveals/conceals empty → revealedAt lacks the secret → findWithholding never asked about it →
  every card must_stay_hidden: []; scene 5 reader_must_learn: [] (the reveal scene!) — secret paid off only as
  `plant: null` seed-grounded payoffs (deathbed_confession_to_ruth, boat_buyer_deposit_tern_bay).
  father_second_family_tern_bay appears in NO card's reader_must_learn.
- Writer for scene 1: told "Ruth knows: deathbed confession" (priority-5 broader knowledge) but beat says she "spots
  unusual mooring coordinates" and no concealment instruction → resolved by making Ruth ignorant.
- Lint #180 (every concealed fact revealed) can't fire: nothing concealed. Missing check: hidden_account fact with no
  revealing event / no reader_must_learn anywhere.
- Also: all cards length_budget null; scene 5 hit MAX_TOKENS.

## Story 03 Toll — concealment partially wired
- ev_01 conceals flooding_order_signed_under_duress; ev_08 reveals it → scene 1 must_stay_hidden, scene 7 reader_must_learn.
  But scenes 2–6 must_stay_hidden: [] (withholding pass added nothing between conceal and reveal).
- hidden valley_condemnation_executive_decree: never in any reveals / reader_must_learn.
- Story 01 has no hidden account (5-event arc). Every card in 01–03 has length_budget null.

## Story 03 Toll — panel (all six in): cons 2, ground 3, engage 3, char 3, payoff 2, prose 2
- Climax unmotivated (4 lenses): ev_11 caused_by [archive_discovery, sister_intervention] — both causes argue AGAINST
  the act; no event gives her a reason to trip the scour now. Fabula-level: causal link present, motive absent.
  (#192's unmotivated-actions criterion lives in the judge, not as a generation gate.)
- "I am Hettie Rann" recognition: card beat 10 "reveals her identity as the girl from Low Meadow" — but nothing in
  seed/facts says she works under an alias; writer in S1/S5/S8 freely names her. Card beat implies a concealment that
  was never modelled.
- Detail drift again (pin brass/steel, stone basalt/lintel/brass ring/schist, 20 vs 30 years, cubits/fathoms/metres,
  horsemen+parchment vs telemetry). Pattern across 02 and 03: invented concrete details not carried scene to scene.
- Dropped threads: turbine failing in 3 weeks, the 5,000 downstream, never returned to.
- Stone-in-pocket closer at end of scenes 4–9; "tallow" x9.

## MECHANISM: why concrete details drift (02, 03, 01)
- Writer's view of earlier scenes = digest hierarchy (event_summary, closing_situation, imagery_signature, facts) +
  verbatim tail (last paragraph of previous scene only; context-assembler.ts renderVerbatimTail).
- Details the prose itself invents (urn brass, Table 4, braise, Inverness/5 winters, pin brass, stone basalt) are
  recorded nowhere → next scene re-invents. grounded_claims (ADR 0018) is scoped to tracked World Model columns only.
- Candidate fix: digest field `established_details` [{entity_id, attribute, value}] (or extend grounded_claims to
  `bag.<key>`), accumulated into the told-ledger / world-model bag and rendered as "ESTABLISHED DETAILS — do not
  change" for entities on stage.
- Verbatim tail also invites echo: 01 Scene 3 opens with Scene 2's last line verbatim ("The great hand had failed.").
  Contract should say "continue from, do not repeat".

## Story 04 Night Shift Letter — concealment WELL wired (contrast case)
- neil_deceptive_replies: conceals ev_04–ev_08 → must_stay_hidden S4–S8; reveals ev_12 → S12. gary_prank_origin revealed S5.
- neil_assigned_locker (hidden) never revealed — minor.
- So hidden-account wiring varies by arc: 02 none, 03 partial (conceal only at the first event), 04 full. The arc generator
  sometimes fills reveals/conceals and sometimes doesn't; nothing checks. → a lint/repair gate on the Fabula.

## Story 04 Night Shift Letter — panel: ground 2, engage 2, char 3, payoff 3, prose 2 (cons pending)
- Envelope decoy (payoff/engage/char): NOT in Fabula or cards. S14 beat "Clara… demands the savings envelope / Julian
  confesses he cannot go"; S16 beat "admits he forfeited his Hull deposit". Arc never says what happens to the money →
  writer invents an offstage swap to reconcile. Pattern: writer patches Fabula gaps with unseen offstage mechanics
  (cf. 01 cold-cream rescue, 03 pin mechanics).
- Romance told not shown: none of Neil's letters on the page. Fabula has ev_04 "Julian first reply" etc. but beats
  summarise correspondence; nothing asks the writer to show a letter.
- S13→S14 reversal off-page: S14 has 2 beats; decision "Julian realizes leaving would be running from reality" is a
  narrator-able beat with no trigger event.
- Prose: "petulant" weather-tantrum simile opens all 16 scenes (imagery ledger not catching a *structural* repeat);
  envelope re-explained in ~9 scenes (reanchoring over-firing?). Names drift: Miller/Fromm; Gable he/she; £5/£20 notes.

## Engine diagnostics that fired but didn't change the prose
- 04: 11/16 scenes over tail budget (other stories: 02 1/6, 01 & 03 0). Dropped: other character_knowledge x11,
  met: recency slice x11, character_knowledge tied to scene facts x6, told-ledger rows for THIS scene's facts x6,
  relationships x10. 46 missing_fact = volatile-tail budget (2000 tok) exhausted → dropped "character_knowledge", "broader told-ledger
  recency slice (met: facts)", etc. Those are exactly the segments that stop re-introductions & knowledge errors.
- unentailed_reversion (04: 8, 03: 8) all on free-text `status` (e.g. "resigned to eviction" vs "resigned refugee…") —
  looks like noise from comparing free-text status strings, not real reversions.
- 04 objects: wren and confession letter are not World Model objects → untrackable; tin's S15 return never in exit_state.

## Story 05 Understudy — package
- Concealment again only at the conceal-event scenes (cards 2–4), then nothing until the reveal scenes
  (hester_sabotaged: conceal ev_03 → reveal ev_10; kemper ledger: conceal ev_02 → reveal ev_07). Same as 03.
  → the gap between "concealed at" and "revealed at" is not carried forward by segmentation; findWithholding adds
  nothing. Across 5 stories: 02 none, 03/05 first-scene-only, 04 full (because the arc itself listed `conceals` on every
  intermediate event).
- 6/18 scenes over tail budget (char knowledge, met: slice, glossed terms).
- All stories: length_budget null on every card.
