# Context: Axiom Weaver — the Dynamic Novel Compiler

A story is authored once as a structured **Story Package** and *performed* into prose on
every read. Same story, told uniquely each time.

This file is the project's ubiquitous language. Use these terms exactly; the glossary
names the synonyms we deliberately avoid.

## The three layers

The original framing had two layers (Fabula → Syuzhet). It has three, and the engine
owns only the last one.

| Layer | Owned by | What it is |
| --- | --- | --- |
| **Fabula** | Author | The world and its events in chronological order — who exists, what is true, what happens. |
| **Syuzhet** | Author | The arrangement — the ordered scene sequence, POV, what is shown vs. withheld, what is revealed when. |
| **Performance** | Engine | The actual sentences: dialogue, interiority, imagery, rhythm. The compiled artifact. |

The author writes the score; the engine performs it. "The author defines the person and
the engine acts out the situation" is literally true — actors with dossiers, performing a
fixed script.

> **Avoid**: using "Syuzhet" for prose generation. Under this model the engine never
> touches arrangement. If you mean the words, say **Performance**.

## Core objects

- **Story Package** — everything the author ships: World Model seed, the ordered Scene
  Cards, the Voice Card. The compiler's source input.
- **Scene Card** — the unit the author authors. Order, POV, location, characters present,
  dramatic function, **required beats**, what the reader must learn here, what must stay
  hidden, entry state → exit state, tone, length budget, and the scene's **invariants**.
- **Required beats** — the tuning dial. Few beats = the actors improvise widely between
  reads; many = tightly the same story every time. Also the *variance* dial (see below).
- **Voice Card** — the narrator as a first-class object: person, tense, narrative
  distance, register, sentence rhythm, imagery palette, dialogue density, and an optional
  hand-written **style exemplar**, empty by default. **Style presets** (Fairy-Tale/Fable,
  Gothic/Brooding, Whimsical/Playful, Hardboiled/Terse, Lyrical/Literary validated so far)
  expand into a fully materialized, editable Voice Card rather than acting as opaque tags;
  an edited field lives in the card itself, never as a diff against the shared preset, so
  editing a preset later can't silently change a story already told in it. A Scene Card's
  `tone` never edits the Voice Card — it's a separate instruction, layered alongside it,
  that governs imagery selection and emphasis for that scene only. See ADR 0007.

## The two memories

Two separate stores that constantly diverge — that divergence *is* secrets, lies, and
dramatic irony. Collapsing them is why story engines read flat.

- **World Model** — relational tables (characters, locations, objects, relationships)
  holding cold, queryable ground truth *at the current moment*. Fixed core columns plus an
  open key-value bag for author-invented attributes. Answers **what is true**.
- **Discourse Record** — the Scene Digests plus the **told-ledger** of what the reader has
  learned and when. Answers **what the reader has been told**.

Every fact therefore has two states: true-in-world and known-to-reader. The World Model
stops the engine contradicting itself; the Discourse Record stops it repeating itself.

- **Scene Digest** — the compressed record emitted by the writer in the *same* structured
  call as the scene's prose (no separate extraction call), and the only thing that
  circulates in long-range context. Carries: event summary, entities on stage, facts
  revealed, plants opened, payoffs closed, **imagery signature** (the concrete images
  actually used, capped at 3, each entry domain-tagged against the Voice Card's
  `imagery_palette` — `{image, domain}`, `domain: null` for an ad hoc image outside the
  palette; added by ADR 0010), **closing situation** (where everyone stands physically
  *and emotionally* at the end — the sole home for emotional state; there is no separate
  "emotional register" field), and **`reanchor_used`** (the introduce/assume/reanchor/
  reintroduce band the writer self-reports per touched entity, added by ADR 0009). Target
  ~150–220 tokens. A **rollup** (Chapter/Part Digest)
  shares this schema but aggregates over its window rather than concatenating: event
  summary is freshly synthesized, list fields union, imagery signature re-caps to 3 by
  recency, closing situation inherits the window's last scene. See ADR 0003.
- **Imagery ledger** — the recency instruction built from prior scenes' `imagery_signature`
  entries, grouped by domain tag, and rendered to the writer after the Voice Card block:
  domains already drawn from (with a short gist), plus palette items not yet drawn from.
  Governs reuse of the *vehicle within* a domain — a palette domain is itself a licensed
  **motif** and may recur across the whole telling on purpose; the ledger never suppresses
  a domain, only nudges away from repeating the same phrasing inside it. Framed positively
  ("already drawn from" + "not yet drawn from"); a raw blocklist was tried and rejected —
  it can't tell "don't repeat this phrasing" from "don't touch this domain," so it
  suppresses imagery the Voice Card wants kept. See
  [ADR 0010](docs/adr/0010-repetition-and-voice-drift-control.md).
- **Told-ledger** — a single table of `{fact_ref, first_learned_scene, last_touched_scene,
  centrality}`, driving introduce / assume / re-anchor decisions. A **fact** is an
  author-declared or auto-generated slug — not required to correspond to a World Model
  row/column — so it can name things the schema has no column for ("the will was forged").
  Entity introduction ("has the reader met Marcus?") rides the same mechanism via an
  auto-generated `met:<entity_id>` fact, not a parallel structure.
- **Re-anchoring policy** — the introduce / assume / reanchor / reintroduce decision for each
  entity present in a scene, driven by `scenes_since_last_touch` and the told-ledger's
  `centrality` (a `low`/`medium`/`high` ordinal, not a continuous score). Expressed to the
  writer as a per-entity annotated list; plot facts stay owned by `reader_must_learn` /
  `must_stay_hidden` instead. The writer self-reports the band it actually used per entity in
  the digest's `reanchor_used` field, which is what makes **told-ledger miscalibration**
  (see the rubric below) checkable by the continuity pass. See
  [ADR 0009](docs/adr/0009-reanchoring-policy.md).

## Context assembly

- **Zoom levels** — the "concentric circles" are *resolution levels*, not categories, and the
  hierarchy is **recursive and unbounded in depth**, not fixed at two rollup levels: Scene
  Digests roll up into **Chapter Digests** once a window fills, Chapter Digests roll up into
  **Part Digests**, and Part Digests roll up into **Book Digests** (`L3`, `L4`, …) for a long
  enough telling — each level holding at most a fixed window of items before it rolls up into
  the next, like carrying a digit in base-W counting. This — not a fixed chapter/part pair — is
  what actually makes context grow logarithmically with book length; a fixed two-level scheme
  degrades to linear growth in the Part-Digest band. Chapter/Part/Book here are
  compiler-internal resolution windows sized by scene count, not the authored book's chapter
  breaks. Plus the verbatim tail — the *final paragraph of the previously generated prose* — of
  the immediately preceding scene. The original scopes (characters present, this location)
  survive as the *filter* applied within each level, off the Scene Card's own fields, never
  inferred from prose. See [ADR 0008](docs/adr/0008-zoom-level-context-assembler.md).
- **Plant obligations** — derived, not authored: a Scene Card's `pays_off` names, per fact,
  which earlier scene must plant it (or marks it grounded in the World Model seed), and the
  compiler walks the sequence backwards to turn those links into per-scene obligations. A
  scene that knows it owes a plant three scenes ahead writes differently from one that does
  not. The compiler never invents *where* a plant lands — an undeclared plant is a hard
  authoring error, not a guess. See ADR 0004.

## Compilation

- **Compile occasions** — *author-time* (stepwise, human in the loop, iterating a card) and
  *read-time* (unattended). One engine, two supervision modes. The primary pathway for
  read-time is **batch**: the whole compiled edition is generated before a reader ever opens
  it, not performed live in front of one token by token. Live, interactive generation in front
  of an active reader is a future expansion, out of scope for this map — "unattended" means no
  human in the loop, not a race against a reader's eyes. See ADR 0011.
- **Baked edition** — a fixed, known-good run shipped as the default so a reader's first
  experience is not a coin flip.
- **Compiled edition** — any persisted run (seed, digests, prose), re-readable, shareable,
  and diffable against another run.
- **Read-time run loop** — pressing "generate a new telling" starts a durable Vercel Workflow
  run, one step per scene (writer call → state-update validation → continuity pass → digest
  rollup if a window closes → Blob flush), *never* streamed to a present reader — the reader
  sees only scene-count progress ("compiling scene 7 of 14") over the same resumable stream
  built for reconnect-safety, then reads the finished edition once the run completes. The
  reader's choice is three-way — **Baked** / a saved version from their **library** / **generate
  a new telling** — and every completed run persists via the loop's own scene-boundary flush;
  library semantics (naming, sharing, retention) belong to Compiled editions and staleness,
  below. A brand-new run ID is minted on every "generate a new telling"; only the reader's own
  still-in-flight run is ever rejoined. A pre-generation estimate shows wall-clock time only
  (never cost), from scene count × that story's rolling average per-scene compile time. Budget
  is soft-logged, never a hard cap. Per-scene failures resolve via the existing
  retry-then-accept-and-log shape; a systemic outage halts and lets the platform's own
  retry/backoff resume it, offering the reader a Baked fallback past ~90s of stalled progress. A
  run with >20% of its scenes degraded to fallback is marked `degraded` and can never be
  auto-promoted to Baked (promotion is always manual, author-initiated). See
  [ADR 0014](docs/adr/0014-read-time-run-loop.md).
- **Variance contract** — each Scene Card declares its **invariants** (required beats,
  facts revealed, exit state). Everything unnamed is free to vary: dialogue, imagery,
  interiority, micro-beat order, which details get attention. `reader_must_learn` /
  `must_stay_hidden` / `exit_state` are checked mechanically against the digest;
  `required_beats` is self-reported by the writer's own diagnostics, never independently
  re-verified. A miss gets one bounded retry at read-time then accept-and-log (never
  blocking), immediate warning at author-time — except **`must_stay_hidden`**, which is
  log-only at read-time: prose streams before the digest is checkable, so a leak can't be
  un-shown. The dial is `required_beats` density via per-scene `tight`/`normal`/`loose`
  presets (never temperature); reproducibility is **persistence-only** — Gemini's `seed`
  doesn't guarantee determinism, so re-reading means reading the stored Compiled edition,
  never re-running the model. The reader is told once, unobtrusively (a landing-page line),
  not per-read. See [ADR 0006](docs/adr/0006-variance-contract.md).
- **Continuity pass** — a pass over **digests, never full prose**, scoped to exactly three
  digest-detectable modes (cold opens/hard resets, told-ledger miscalibration, stale imagery —
  dropped setup is owned entirely by the plant-obligation walk instead). It may edit seams
  (openings, transitions, recycled imagery) but may **not** change events, enforced as a
  field-level rule: a repair may only touch prose plus `closing_situation`/`imagery_signature`/
  `reanchor_used`, never `facts_revealed`/`plants_opened`/`payoffs_closed`/`state_updates`.
  Runs author-time with full authority, and read-time once per scene against the persisted
  edition (never a live reader, since read-time generation is batch — see Compile occasions);
  a repair's downstream effect is handled by marking later scenes **stale**, not by cascading
  or re-checking itself. Working on abstractions is what lets it scale to novel length. See
  ADR 0011.
- **State-update tiers** — the authority boundary on what the engine may commit:
  **physical** (location, possessions, time, injury) and **epistemic** (who now knows
  what) are engine-writable and auto-committed; **volitional/relational** (goals,
  allegiances, feelings) may only be *proposed*. A property's tier is a column attribute.
  A P/E update is accepted only if it satisfies or merely extends the Scene Card's
  `exit_state` — never contradicts it, and never reverts a previously committed value the
  card gave no grounds to touch (the **amnesia guard**). A volitional proposal is applied
  if compatible with the card's invariants, otherwise dropped; silence is always inaction,
  never invention, so cross-run divergence on a volitional column is accepted variance,
  identical in kind to dialogue and imagery. See ADR 0005.
- **Writer prompt contract** — the single structured call that produces a scene:
  `prose → scene_digest → state_updates → diagnostics`, in that response order, so a
  streaming reader sees words immediately and everything after prose is written *about*
  prose that already exists. Payload order, coarsest to most volatile: the explicit-cache
  header (contract prose, Voice Card, World Model column/tier legend) → the implicit-cache
  digest hierarchy → the verbatim tail of the previous scene's prose → the volatile tail
  (Scene Card, payoff-side plant instructions, the re-anchoring list, the imagery ledger,
  scene `tone`, filtered World Model rows, told-ledger slice). `MAX_TOKENS` truncation is a
  required code path, not an edge case: when prose survived the cut, a cheap **digest-only
  fallback call** recovers `scene_digest`/`state_updates` from the recovered prose alone;
  when prose itself was cut mid-clause, the whole scene gets one retry with a larger output
  budget before falling back. Every failure path — truncation, malformed output, recitation,
  content filters — resolves to the map's one existing shape: a single bounded retry, then
  accept-and-log, never blocking a read-time run. See
  [ADR 0012](docs/adr/0012-writer-prompt-contract.md).
- **Recitation control** — detection for a memorised-source fixture is
  `finishReason: RECITATION` from the API and nothing else: the compiler's data model
  (Scene Cards, World Model, digests) never holds canonical source prose, so there is
  nothing to diff generated prose against locally, and diffing against the Scene Card's
  own text would just detect the writer following author-mandated quotations
  (`required_beats` may legitimately embed a source's exact wording — an authoring
  choice, not recall). Mitigation is the existing one-retry-then-`scene_generation_failed`
  shape, tagged `recitation_flagged`; no new mechanism. See
  [ADR 0013](docs/adr/0013-recitation-control.md).
- **Diagnostics** — the writer reports unsatisfiable beats and contradictions rather than
  silently papering over them, via exactly two self-reported types, `beat_unsatisfied` and
  `missing_fact` — every other diagnostic (`entry_state_mismatch`,
  `exit_state_contradiction`, `unauthorized_entity_update`, `unentailed_reversion`, a missed
  plant, a `must_stay_hidden` leak, a truncated or failed scene) is the compiler grading the
  writer's other outputs after the call returns, not a self-report; the full taxonomy is in
  [ADR 0012](docs/adr/0012-writer-prompt-contract.md). Author-time diagnostics surface as
  compile warnings; read-time the engine resolves autonomously within the invariants and
  logs to a **run report**. A read-time `error` gets one bounded retry, then falls back to
  the World Model's pre-scene value and logs — the World Model is never committed a
  contradiction outright. No diagnostic severity aborts a read-time run (ADR 0005).
- **Stale** — a scene whose upstream digest changed on facts-revealed, plants, or closing
  situation. Flagged, never auto-recompiled. Stale-but-standing is a legitimate state.

## The seam-failure rubric

The map's acceptance test: every failure mode below pairs with a mechanism, or is
consciously accepted as unaddressed. Since the author fixes the whole scene sequence up
front, none of these are plot failures — they are all **surface** (Performance-layer)
failures, ordered here worst to least severe.

| Mode | Reader notices via | Digest-detectable? | Mechanism owner |
| --- | --- | --- | --- |
| **Amnesia** | Narration contradicts a fact they already hold true | No — it's a World Model contradiction, not a digest-continuity one | State-update validator (`unentailed_reversion`, ADR 0005) |
| **Character-voice homogenization** | Dialogue/interiority reads interchangeable across characters | No — no digest field captures it | Generation-time only (Voice Card), unverified |
| **Voice drift** | The *narrator's* register, distance, or rhythm shifts scene to scene | No | Generation-time only (Voice Card), unverified |
| **Cold opens / hard resets** | A scene ignores the prior scene's closing situation | Yes — `closing situation` | Continuity pass |
| **Told-ledger miscalibration** | "Didn't I already know that?" (under-told) or a redundant re-explanation (over-told) | Yes — the told-ledger | Continuity pass |
| **Dropped setup** | An unpaid plant, or a payoff with no plant | Yes — `plants opened` / `payoffs closed` | Plant-obligation walk |
| **Stale imagery** | The same concrete image/metaphor/verb recycled | Yes — `imagery signature` | Continuity pass |
| **Uniform beat shape** | Cumulative monotony; rarely visible scene-to-scene | Partially, only in aggregate | Consciously accepted, unaddressed for v1 |

**Told-ledger miscalibration** replaces the earlier separate notions of "re-introduction"
and "over-recap" — they are the same root cause (a told-ledger read error) in opposite
directions, not two independent failure modes.

**Character-voice homogenization** is distinct from voice drift: voice drift is the
*narrator's* register sliding; this is characters' dialogue and interiority becoming
indistinguishable from each other (or from the narrator). Both are undetectable from
digests alone, since digests abstract content, not prose style — so neither can be caught
by the continuity pass. A future per-character dialogue signature (mirroring imagery
signature) could make character-voice homogenization digest-detectable, but that's
speculative until generation-time Voice Card constraint is proven insufficient.

> **Avoid**: assuming the continuity pass can catch every seam failure. It is
> constitutionally digest-only (see Continuity pass, above), so amnesia and the two
> voice-level modes are structurally outside its reach.

**Recitation is deliberately not a ninth row here.** It's a source-fidelity concern —
does the Performance layer reproduce someone else's fixed prose — not a
Fabula/Syuzhet-continuity one, so it doesn't fit this rubric's axis. See Recitation
control, above, and ADR 0013.
