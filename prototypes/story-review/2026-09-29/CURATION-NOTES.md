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
