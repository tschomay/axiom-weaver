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
  hand-written **style exemplar**. **Style presets** (mystery, adventure, whimsical, …)
  expand into an editable Voice Card rather than acting as opaque tags.

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
  actually used, capped at 3), and **closing situation** (where everyone stands physically
  *and emotionally* at the end — the sole home for emotional state; there is no separate
  "emotional register" field). Target ~150–220 tokens. A **rollup** (Chapter/Part Digest)
  shares this schema but aggregates over its window rather than concatenating: event
  summary is freshly synthesized, list fields union, imagery signature re-caps to 3 by
  recency, closing situation inherits the window's last scene. See ADR 0003.
- **Told-ledger** — a single table of `{fact_ref, first_learned_scene, last_touched_scene,
  centrality}`, driving introduce / assume / re-anchor decisions. A **fact** is an
  author-declared or auto-generated slug — not required to correspond to a World Model
  row/column — so it can name things the schema has no column for ("the will was forged").
  Entity introduction ("has the reader met Marcus?") rides the same mechanism via an
  auto-generated `met:<entity_id>` fact, not a parallel structure.

## Context assembly

- **Zoom levels** — the "concentric circles" are *resolution levels*, not categories: full
  Scene Digests for the current chapter, rolled-up **Chapter Digests** for the current
  part, **Part Digests** for the whole book, plus the verbatim tail of the immediately
  preceding scene. Context grows logarithmically with book length. The original scopes
  (characters present, this location) survive as the *filter* applied within each level.
- **Plant obligations** — derived, not authored: a Scene Card's `pays_off` names, per fact,
  which earlier scene must plant it (or marks it grounded in the World Model seed), and the
  compiler walks the sequence backwards to turn those links into per-scene obligations. A
  scene that knows it owes a plant three scenes ahead writes differently from one that does
  not. The compiler never invents *where* a plant lands — an undeclared plant is a hard
  authoring error, not a guess. See ADR 0004.

## Compilation

- **Compile occasions** — *author-time* (stepwise, human in the loop, iterating a card) and
  *read-time* (a reader opens the story and it performs start to finish, unattended). One
  engine, two supervision modes.
- **Baked edition** — a fixed, known-good run shipped as the default so a reader's first
  experience is not a coin flip.
- **Compiled edition** — any persisted run (seed, digests, prose), re-readable, shareable,
  and diffable against another run.
- **Variance contract** — each Scene Card declares its **invariants** (required beats,
  facts revealed, exit state). Everything unnamed is free to vary: dialogue, imagery,
  interiority, micro-beat order, which details get attention.
- **Continuity pass** — a pass over **digests, never full prose**, that may edit seams
  (openings, transitions, first-mention violations, recycled imagery) but may **not**
  change events. Working on abstractions is what lets it scale to novel length.
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
- **Diagnostics** — the writer reports unsatisfiable beats and contradictions rather than
  silently papering over them. Author-time they surface as compile warnings; read-time the
  engine resolves autonomously within the invariants and logs to a **run report**. A
  read-time `error` gets one bounded retry, then falls back to the World Model's pre-scene
  value and logs — the World Model is never committed a contradiction outright. No
  diagnostic severity aborts a read-time run (ADR 0005).
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
