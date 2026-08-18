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

- **Scene Digest** — the compressed record emitted alongside each scene's prose, and the
  only thing that circulates in long-range context. Carries: event summary, entities on
  stage, facts revealed, plants opened, payoffs closed, emotional register at open and
  close, **imagery signature** (the concrete images actually used), and **closing
  situation** (where everyone stands physically and emotionally at the end).
- **Told-ledger** — per-fact and per-entity record of when the reader learned something,
  driving introduce / assume / re-anchor decisions.

## Context assembly

- **Zoom levels** — the "concentric circles" are *resolution levels*, not categories: full
  Scene Digests for the current chapter, rolled-up **Chapter Digests** for the current
  part, **Part Digests** for the whole book, plus the verbatim tail of the immediately
  preceding scene. Context grows logarithmically with book length. The original scopes
  (characters present, this location) survive as the *filter* applied within each level.
- **Plant obligations** — derived, not authored: Scene Cards declare what they pay off,
  and the compiler walks the sequence backwards to compute, per scene, what it must plant.
  A scene that knows it owes a plant three scenes ahead writes differently from one that
  does not.

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
- **Diagnostics** — the writer reports unsatisfiable beats and contradictions rather than
  silently papering over them. Author-time they surface as compile warnings; read-time the
  engine resolves autonomously within the invariants and logs to a **run report**.
- **Stale** — a scene whose upstream digest changed on facts-revealed, plants, or closing
  situation. Flagged, never auto-recompiled. Stale-but-standing is a legitimate state.
