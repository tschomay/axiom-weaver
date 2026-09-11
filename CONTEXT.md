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
- **Compiled edition** — any persisted run (World Model seed, digests, prose, run report),
  pinned to the `package_version` it was compiled from, re-readable, shareable, and diffable
  against another run of the same `package_version`. Immutable once produced: a Compiled
  edition stays fully correct forever for the version it pins, even after the author advances
  the Story Package further — it is never marked stale and carries no version-drift signal.
  Addressable and shareable by its run ID/URL indefinitely; nothing is ever auto-deleted.
  Sharing an edition's URL exposes only its own content (prose, digests) — never the Story
  Package behind it, which stays an author-only surface. Diffing two editions is scoped to a
  matched `package_version` pair (a cross-version comparison is a different question — see
  Working Draft, below) and compares Scene Digest fields per scene as the primary surface,
  with both editions' full prose available side-by-side — never a line-level text diff of
  prose. This is a direct instantiation of the variance contract, below. See
  [ADR 0015](docs/adr/0015-compiled-editions-and-staleness.md).
- **Library** — the story-scoped, author-gated list of saved Compiled editions a reader can
  return to (the second arm of the read-time run loop's three-way choice, below). Not a
  personal collection per reader — there are no reader accounts. Only the author can
  save/name/delete library entries; a reader can still generate a run and share it by direct
  URL, or rejoin their own still-in-flight run, without library-write access. See
  [ADR 0015](docs/adr/0015-compiled-editions-and-staleness.md).
- **Manuscript** — the author's mutable, unversioned working copy of a Story Package: at most
  one per story, the only thing an edit ever writes, and invisible to every other surface in
  the system. Not prose — it is the score being revised, not the performance — and not the
  **Working Draft**, which is the accumulating sequence of *compiled scenes*. A story with an
  unpublished Manuscript is, to the compiler, the Working Draft, the run loop and every
  edition, unchanged: they all still resolve through the published package pointer. Parsed
  loosely (a story being written from scratch has no scenes yet and satisfies none of the
  package's required fields); the strict parse happens only at publish. Seeded three ways —
  empty, from the story's current package, or duplicated from any retained version of any
  story under a new `story_id`. See
  [ADR 0017](docs/adr/0017-the-manuscript-and-publishing.md).
- **Publish** — the single deliberate act that turns a Manuscript into the next retained
  `package_version`: strict-parse, then lint, then `max(retained) + 1`, then retain and
  repoint. The author no longer increments `package_version` by hand. Blocked by any linter
  **error** (a defect that would otherwise fail at compile time, further from the field that
  caused it) and never by a **warning** (a judgment about craft the author is allowed to
  disagree with). Because it is the only write that advances the version, it is also the only
  moment **staleness** propagates — which is the deliberate-edit boundary blunt propagation
  always assumed. Publishing leaves the Manuscript in place; **discard** is its own action.
  See [ADR 0017](docs/adr/0017-the-manuscript-and-publishing.md).
- **Working Draft** — the single per-story, author-time-only sequence of scenes built up via
  stepwise author-time compiles (see Compile occasions, below), always tracking the current
  `package_version` on a per-scene basis. **Staleness is a property of the Working Draft
  only** — never of a Compiled edition. Editing a Scene Card and recompiling it compares the
  scene's freshly produced Scene Digest against the digest it replaces, scoped to
  `facts_revealed`, `entities_on_stage`, `closing_situation`, and `plants_opened`
  (`payoffs_closed` only ever references an earlier plant so can't create a forward
  dependency, already covered by the plant-obligation walk's own validation;
  `imagery_signature`/`reanchor_used`/`event_summary` carry no downstream dependency). Any
  diff in those fields flags every later scene in the Working Draft stale — bluntly, for v1,
  never auto-recompiled or cascaded — carrying the source scene's diff summary rather than a
  computed per-scene relevance judgment. Stale-but-standing is legitimate: nothing nags the
  author, and a Working Draft with stale scenes remains fully readable. See
  [ADR 0015](docs/adr/0015-compiled-editions-and-staleness.md).
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
  `reanchor_used`/`grounded_claims`, never `facts_revealed`/`plants_opened`/`payoffs_closed`/
  `state_updates`. Runs author-time with full authority, and read-time once per scene against the
  persisted edition (never a live reader, since read-time generation is batch — see Compile
  occasions); a repair's downstream effect is handled by marking later scenes **stale**, not by
  cascading or re-checking itself. Working on abstractions is what lets it scale to novel length.
  Its repair primitives are also called from outside the pass, by the state-update validator's
  prose-grounding checkpoint (see State-update tiers, below) — a second caller of the same
  locate-and-swap machinery, not a fourth mode. `reanchor_used` self-reports now carry a short
  `anchor_text` extract, checked for internal consistency against the claimed band — narrowing,
  not yet closing, ADR 0009 §8's "self-reported and not independently re-verified" gap. See
  ADR 0011, ADR 0018.
- **State-update tiers** — the authority boundary on what the engine may commit:
  **physical** (location, possessions, time, injury) and **epistemic** (who now knows
  what) are engine-writable and auto-committed; **volitional/relational** (goals,
  allegiances, feelings) may only be *proposed*. A property's tier is a column attribute.
  A P/E update is accepted only if it satisfies or merely extends the Scene Card's
  `exit_state` — never contradicts it, and never reverts a previously committed value the
  card gave no grounds to touch (the **amnesia guard**). A volitional proposal is applied
  if compatible with the card's invariants, otherwise dropped; silence is always inaction,
  never invention, so cross-run divergence on a volitional column is accepted variance,
  identical in kind to dialogue and imagery. The amnesia guard's same test also runs over
  `grounded_claims` — physical/epistemic claims the writer extracts from its own generated
  prose about World-Model-tracked entities — catching a contradiction that lives only in prose
  and never touches `state_updates` for that column; since nothing was actually written wrong,
  this repairs the prose (via the continuity pass's repair machinery) rather than falling back
  to a prior value. See ADR 0005, ADR 0018.
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
- **Stale** — a Working Draft scene whose upstream digest changed on `facts_revealed`,
  `entities_on_stage`, `plants_opened`, or `closing_situation`. A property of the Working
  Draft only, never of a Compiled edition (see Working Draft, above). Flagged, never
  auto-recompiled. Stale-but-standing is a legitimate state.
- **State-update commit log** — a per-story, per-scene append-only ledger,
  `{scene_index, entity_id, column, tier, previous_value, new_value, status}`
  (`status`: `committed` / `proposed_applied` / `proposed_dropped`), recording every World
  Model change ADR 0005 accepted or resolved — not a new authority, just keeping what ADR
  0005 already decided instead of only the final value. "World Model as of scene N" is the
  seed replayed through every `committed`/`proposed_applied` entry with
  `scene_index ≤ N`; nothing else persists per-scene World Model state. Also the proposals
  queue's backing store — a proposal is a log entry not yet resolved. Persisted at
  `story/{storyId}/draft/state-log.json` (Working Draft) and
  `edition/{runId}/state-log.json` (Compiled edition, immutable once the run completes).
  See [ADR 0016](docs/adr/0016-author-surfaces-and-the-state-log.md).
- **Author surfaces** — four screens, not the six an early read of the candidates suggested:
  the **scene compile view** (diagnostics + the proposals queue, scoped to the card just
  compiled — author-time compiling is stepwise, one card at a time, so there's always
  exactly one card in view when either fires); the **World & Discourse inspector** (World
  Model + told-ledger as two tabs over one scene-index scrubber — both answer "state as of
  scene N" pointed at a different one of the two memories); **stale badges** as inline
  decoration on the Working Draft's scene list, not a screen of their own; and the **run
  report** with manual Baked-promotion. At author-time, a volitional proposal is never
  auto-applied or auto-dropped the way ADR 0005 §3 resolves it at read-time (that rule is
  explicitly framed around no author being present) — it sits in the proposals queue until
  the author accepts or rejects it, and leaving it pending never blocks compiling the next
  scene. Diagnostic severity decides *which surface*, not just how loud: `error`/`warn`
  render live in the scene compile view at author-time, `info` (an already-resolved
  volitional commit) is run-report-only, never surfaced live, since that was the one
  category issue #21 flagged as risking becoming noise. See
  [ADR 0016](docs/adr/0016-author-surfaces-and-the-state-log.md).

## The seam-failure rubric

The map's acceptance test: every failure mode below pairs with a mechanism, or is
consciously accepted as unaddressed. Since the author fixes the whole scene sequence up
front, none of these are plot failures — they are all **surface** (Performance-layer)
failures, ordered here worst to least severe.

| Mode | Reader notices via | Digest-detectable? | Mechanism owner |
| --- | --- | --- | --- |
| **Amnesia** | Narration contradicts a fact they already hold true | Partially — `grounded_claims` catches a claim the writer surfaces about a tracked entity; a contradiction the extraction step misses entirely still isn't caught | State-update validator (`unentailed_reversion` + `prose_grounding_mismatch`, ADR 0005, ADR 0018) |
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
