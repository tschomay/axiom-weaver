# Glossary

Every non-standard term used in this codebase and its docs, in one place. [`CONTEXT.md`](./CONTEXT.md)
is the canonical ubiquitous language — use these terms exactly, the way it says to. This file
exists to *explain* them: what each one does, why it exists rather than something simpler, and
how to actually use it, for anyone arriving without the ADR history in their head.

Entries are grouped the way `CONTEXT.md` groups them, and each links to the ADR that settled it
where one exists.

---

## The three layers

### Fabula

**What:** The world and its events in chronological order — who exists, what is true, what
happens, regardless of how or when it's revealed. Owned by the author.

**Why:** Separating "what happened" from "how it's shown" is what makes secrets and dramatic
irony possible at all — you can't withhold a fact from the reader if there's no representation of
that fact independent of the telling.

**How:** Authored as the `world_model_seed` in a Story Package, plus everything Scene Cards assert
happens. There's no separate "Fabula document" — it's the sum of what the World Model and the
scene sequence together establish as true.

### Syuzhet

**What:** The arrangement — the ordered scene sequence, POV, what's shown vs. withheld, what's
revealed when. Owned by the author.

**Why:** Same distinction as Fabula, from the other side: a story can tell the same events in a
different order, from a different POV, to completely different effect. The engine never touches
this — it's fixed the moment the Story Package is authored.

**How:** Authored as the ordered list of Scene Cards. Each card's `order`, `pov`,
`reader_must_learn`, and `must_stay_hidden` fields *are* the Syuzhet for that scene.

> **Avoid:** using "Syuzhet" to mean prose generation. Under this model the engine never touches
> arrangement — if you mean the words, say **Performance**.

### Performance

**What:** The actual sentences: dialogue, interiority, imagery, rhythm. The one layer the engine
owns and the only thing that varies between two readings of the same story.

**Why:** This is the whole point of the project — the author fixes Fabula and Syuzhet once, and
the engine performs them differently every time, the way an actor performs a fixed script
differently each night. Constraining variance to this one layer is what keeps the story
recognizably the same story across readings while still feeling freshly told.

**How:** Produced by the writer call, one Scene Card at a time. Never authored directly — it's a
compiler output, not an input.

---

## Core objects

### Story Package

**What:** Everything the author ships for one story: the World Model seed, the ordered Scene
Cards, and the Voice Card. The compiler's entire source input.

**Why:** Bundling these three together (rather than, say, generating a scene from a bare prompt)
is what lets a story be authored once and compiled unattended, over and over, from the same
inputs — the way source code compiles to a program.

**How:** See `docs/schema/story-package.md` for the exact envelope shape. Load one with
`npm run load-fixtures`, or write a new one following an existing fixture in `fixtures/`.

### Scene Card

**What:** The unit the author actually authors: order, POV, location, characters present,
dramatic function, required beats, what the reader must learn here, what must stay hidden, entry
state → exit state, tone, length budget, and the scene's invariants.

**Why:** This is the granularity at which the author exerts control and the engine performs — one
writer call compiles one Scene Card. Everything the compiler checks (state-update authority, the
variance contract, plant obligations) is checked against a Scene Card's declared fields, never
inferred from prose.

**How:** Author one per beat of the story. A thin, transitional scene can legitimately declare
only the eight required fields (`id`, `order`, `pov`, `location_id`, `characters_present`,
`dramatic_function`, `entry_state`, `exit_state`) — everything else defaults to empty.

### Required beats

**What:** The list of beats a scene must hit — the tuning dial for how much a telling can vary.
Few beats = the actors improvise widely between reads; many = tightly the same story every time.

**Why:** This is the single dial that controls the variance/consistency tradeoff per scene,
rather than a global temperature setting that would apply the same looseness everywhere
regardless of how much a given scene actually needs to vary.

**How:** Set per Scene Card as a list of beat descriptions, with density controlled via a
`tight`/`normal`/`loose` preset (never model temperature). The writer self-reports which beats it
satisfied via the `beat_unsatisfied` diagnostic — required beats are never independently
re-verified against the prose. See [ADR 0006](docs/adr/0006-variance-contract.md).

### Voice Card

**What:** The narrator as a first-class object: person, tense, narrative distance, register,
sentence rhythm, imagery palette, dialogue density, and an optional hand-written style exemplar.

**Why:** Treating voice as authored data rather than an implicit prompt instruction is what keeps
it stable across dozens of writer calls in one telling, and what makes a style preset editable
without the edit leaking back into stories already told under the original.

**How:** Start from a style preset (see below) or write one from scratch; edit any field
directly — an edited field lives in the card itself, never as a diff against the shared preset. A
Scene Card's `tone` layers alongside the Voice Card for that one scene only; it never edits the
card. See [ADR 0007](docs/adr/0007-voice-card-and-style-presets.md).

### Style presets

**What:** Five validated starting points for a Voice Card — Fairy-Tale/Fable, Gothic/Brooding,
Whimsical/Playful, Hardboiled/Terse, Lyrical/Literary.

**Why:** They expand into a fully materialized, editable Voice Card rather than acting as an
opaque tag, so choosing "Gothic/Brooding" gives the author something to look at and tweak instead
of a black box.

**How:** Pick one as a Voice Card's starting point, then edit fields freely — the preset is a
seed value, not a live reference, so later changes to the preset itself never retroactively
change a story already told from it.

### Style exemplar

**What:** An optional hand-written passage on the Voice Card showing, rather than describing, the
target voice. Empty by default.

**Why:** Some qualities of voice are easier to demonstrate than to specify as discrete fields
(register, rhythm, register); the exemplar gives the writer model a concrete anchor alongside the
structured fields.

**How:** Write a short passage in the target voice and attach it to the Voice Card. Optional —
most Scene Cards compile fine from the structured fields alone.

---

## The two memories

Two separate stores that constantly diverge — that divergence *is* secrets, lies, and dramatic
irony. Collapsing them into one memory is why naive story engines read flat.

### World Model

**What:** Relational tables (`character`, `location`, `object`, `relationship`,
`character_knowledge`) holding cold, queryable ground truth *at the current moment*. Fixed core
columns plus an open key-value **bag** for author-invented attributes. Answers: **what is true**.

**Why:** A structured, queryable store of world state is what lets the engine check a scene's
claims mechanically (does this character have the item they're about to hand over?) instead of
trusting the prose to stay self-consistent by luck.

**How:** Seeded once via a Story Package's `world_model_seed`, then updated per scene through the
state-update authority (see State-update tiers, below). Query "as of scene N" via the
`GET /api/stories/{storyId}/world-model?scene=N` route, or the World & Discourse inspector screen.
See `docs/schema/story-package.md` and [ADR 0001](docs/adr/0001-world-model-identity-and-tiering.md).

### Bag

**What:** The flat, open key-value column on every World Model row for attributes the fixed
schema has no column for (an epithet, an atmosphere note). Scalars only — string, number,
boolean, or a short string array; no nested objects.

**Why:** A fixed schema can't anticipate every attribute an author will want on an entity, but an
unconstrained JSON blob would defeat the point of having a structured, queryable World Model at
all. The bag is the escape hatch, deliberately kept flat: the moment a value needs structure,
that's the signal it should graduate to a real column instead.

**How:** Add whatever author-invented scalar attributes a character, location, object, or
relationship needs. Bag values carry no tier — they're author-only and never engine-writable
unless promoted to a core column.

### Tier legend (P / E / V)

**What:** The per-column authority classification on every World Model property: **P**hysical
(location, possessions, time, injury), **E**pistemic (who now knows what), or **V**olitional/
relational (goals, allegiances, feelings).

**Why:** Not every fact deserves the same trust. Physical and epistemic facts are objective enough
that the engine can commit them automatically; volitional facts are subjective enough that letting
the engine invent or silently rewrite them (a character's sudden change of heart) would be a much
worse failure than a small amount of unresolved variance.

**How:** Tier is fixed per-column at the schema level, not per-row — `char.location_id` is always
P, `char.goal` is always V. See State-update tiers, below, for what each tier is allowed to do.
[ADR 0001](docs/adr/0001-world-model-identity-and-tiering.md), [ADR 0005](docs/adr/0005-state-update-authority.md).

### Discourse Record

**What:** The Scene Digests plus the told-ledger of what the reader has learned and when.
Answers: **what the reader has been told**.

**Why:** This is the World Model's counterpart — every fact has both a true-in-world state and a
known-to-reader state, and only tracking the former is what makes engines repeat exposition the
reader already has, or forget to reveal something on schedule.

**How:** Built up automatically as a byproduct of the writer's structured output — never authored
directly. Inspect it via the told-ledger tab of the World & Discourse inspector screen.

### Told-ledger

**What:** A single table of `{fact_ref, first_learned_scene, last_touched_scene, centrality}`
driving introduce/assume/re-anchor decisions. A **fact** is an author-declared or
auto-generated slug that need not correspond to any World Model row or column, so it can name
things the schema has no column for (e.g. "the will was forged").

**Why:** Tracking *when* the reader learned something, not just *whether* they know it, is what
lets the engine decide whether to re-explain a fact, assume it, or reintroduce it after a long
gap — the single mechanism behind the "didn't I already know that?" and "why is this being
re-explained" failure modes.

**How:** Entity introduction rides the same table via an auto-generated `met:<entity_id>` fact,
rather than a parallel structure. Inspect "state as of scene N" via the World & Discourse
inspector. See [ADR 0003](docs/adr/0003-scene-digest-and-told-ledger.md).

### Scene Digest

**What:** The compressed record emitted by the writer in the *same* structured call as the
scene's prose — no separate extraction call. Carries the event summary, entities on stage, facts
revealed, plants opened, payoffs closed, the imagery signature, the closing situation, and
`reanchor_used`. Target ~150–220 tokens. The only thing that circulates in long-range context.

**Why:** Extracting a compressed summary in the same call that writes the prose (rather than a
second pass over the finished prose) is what keeps a novel-length telling affordable — full prose
for every prior scene would blow the context window and the cache long before a book-length
telling finished.

**How:** Never authored — it's writer output, validated and stored automatically after each scene
compiles. See [ADR 0003](docs/adr/0003-scene-digest-and-told-ledger.md).

### Rollup (Chapter / Part / Book Digest)

**What:** A Scene Digest's aggregate counterpart at a coarser zoom level: same schema, but the
event summary is freshly synthesized (not concatenated), list fields union, imagery re-caps to 3
by recency, and closing situation inherits the window's last scene.

**Why:** Concatenating every prior Scene Digest verbatim would make context grow linearly with
book length; rolling a full window up into one digest-shaped summary before moving to the next
tier is what makes context grow logarithmically instead. See Zoom levels, below.

**How:** Produced automatically once a zoom level's window fills — never authored or triggered
manually. See [ADR 0008](docs/adr/0008-zoom-level-context-assembler.md).

### Imagery ledger

**What:** The recency instruction built from prior scenes' `imagery_signature` entries, grouped
by domain tag and rendered to the writer after the Voice Card block: domains already drawn from
(with a short gist), plus palette items not yet drawn from.

**Why:** A raw blocklist of used images was tried and rejected — it can't distinguish "don't
repeat this exact phrasing" from "don't touch this domain at all," so it ends up suppressing
imagery the Voice Card deliberately wants kept as a recurring motif. Framing it positively (drawn
from / not yet drawn from) lets a domain recur on purpose while still nudging away from repeating
the same phrasing inside it.

**How:** Built automatically from the `imagery_signature` field of prior Scene Digests — not
author-facing. See [ADR 0010](docs/adr/0010-repetition-and-voice-drift-control.md).

### Re-anchoring policy (introduce / assume / reanchor / reintroduce)

**What:** The decision, per entity present in a scene, of how much to re-establish that entity for
the reader — driven by `scenes_since_last_touch` and the told-ledger's `centrality` (a
low/medium/high ordinal). Expressed to the writer as a per-entity annotated list.

**Why:** Without an explicit policy, a writer model either over-explains every entity every scene
(tedious) or under-explains a character absent for ten scenes (confusing). Making the band
explicit, and having the writer self-report which band it actually used (`reanchor_used`), is what
makes told-ledger miscalibration checkable after the fact instead of only noticeable by a human
reader.

**How:** Computed automatically per scene; force a specific band via a Scene Card's
`force_reintroduce` field when the author needs an entity re-established regardless of the
computed band. See [ADR 0009](docs/adr/0009-reanchoring-policy.md).

---

## Context assembly

### Zoom levels

**What:** A recursive, unbounded-depth resolution hierarchy: Scene Digests roll up into Chapter
Digests once a window fills, Chapter Digests into Part Digests, Part Digests into Book Digests
(`L3`, `L4`, …), each level holding a fixed window before rolling into the next — like carrying a
digit in base-*W* counting.

**Why:** This, not a fixed two-level chapter/part scheme, is what actually makes prompt context
grow logarithmically rather than linearly with book length. A fixed scheme degrades to linear
growth once a story is long enough to fill the top level.

**How:** Not configured per story — it's a property of the context assembler, sized by scene
count. Chapter/Part/Book here are compiler-internal resolution windows, not the authored book's
own chapter breaks. See [ADR 0008](docs/adr/0008-zoom-level-context-assembler.md).

### Plant obligations (plant-obligation walk)

**What:** Derived, not authored: a Scene Card's `pays_off` field names, per fact, which earlier
scene planted it (or marks it grounded in the World Model seed), and the compiler walks the scene
sequence backwards to turn those links into a per-scene obligation ("you owe this plant three
scenes from now").

**Why:** A scene that knows it owes a future plant writes differently — it can seed a detail
deliberately — than one generated with no awareness a payoff is coming. Deriving obligations from
`pays_off` rather than having the compiler guess where a plant should land keeps an undeclared
plant a hard authoring error instead of a silent guess.

**How:** Authored as `pays_off: [{fact_ref, plant: <scene_id> | null}]` on the paying-off Scene
Card; `plant: null` means the fact is grounded in the World Model seed rather than any scene. See
[ADR 0004](docs/adr/0004-plant-obligation-walk.md).

---

## Compilation

### Compile occasions (author-time / read-time)

**What:** The two supervision modes for the same compiler: **author-time** (stepwise, human in
the loop, iterating one card at a time) and **read-time** (unattended, batch — the whole edition
is generated before a reader opens it).

**Why:** An author iterating on a single scene needs immediate feedback and the ability to accept
or reject a proposal; a reader waiting for a telling needs the whole thing to just finish. Rather
than build two compilers, both run the same engine with different supervision.

**How:** Author-time via the Working Draft's "Compile the rest" or per-card compile; read-time via
"generate a new telling." See [ADR 0011](docs/adr/0011-continuity-pass-over-digests.md).

### Baked edition

**What:** A fixed, known-good Compiled edition shipped as the default telling.

**Why:** A reader's first experience of a story shouldn't be a coin flip on whichever run happened
to compile — a Baked edition guarantees a reliable default while runs generated live remain
available as an alternative.

**How:** Promoted manually by the author from a completed, non-degraded Compiled edition — never
automatic. See [ADR 0014](docs/adr/0014-read-time-run-loop.md) §9, [ADR 0015](docs/adr/0015-compiled-editions-and-staleness.md).

### Compiled edition

**What:** Any persisted run — World Model state, digests, prose, run report — pinned to the
`package_version` it was compiled from. Immutable once produced, addressable and shareable by its
run ID indefinitely.

**Why:** Immutability is what lets a Compiled edition stay fully correct forever for the version
it pins, even as the author keeps editing the Story Package — it's never marked stale, unlike a
Working Draft scene.

**How:** Produced by the read-time run loop or promoted from author-time compiling. Diff two
editions of the same `package_version` via their Scene Digest fields (never a line-level prose
diff). See [ADR 0015](docs/adr/0015-compiled-editions-and-staleness.md).

### Library

**What:** The story-scoped, author-gated list of saved Compiled editions a reader can return to.

**Why:** Not every generated telling deserves to be kept forever visible to readers — the Library
is the author's curated subset, distinct from a reader's ability to still revisit any run by
direct URL.

**How:** Author saves/names/deletes entries; a reader picks from Baked / Library / "generate a new
telling" on the read screen. See [ADR 0015](docs/adr/0015-compiled-editions-and-staleness.md).

### Manuscript

**What:** The author's mutable, unversioned working copy of a Story Package — at most one per
story, and the only thing an edit ever writes.

**Why:** A retained `package_version` is immutable because Compiled editions pin it and must
dereference to the bytes they were compiled from forever. An author editing a scene produces a
write every few seconds. The Manuscript is where those writes go, so the immutability invariant
never has to bend and staleness never fires on a keystroke.

**Not:** prose — it is the score being revised, not the performance. And not the **Working
Draft**, which is the accumulating sequence of *compiled scenes*. The two are different objects
with confusingly adjacent names; a story can have either, both, or neither.

**How:** Seeded empty, from the story's current package, or duplicated from any retained version
of any story. Parsed loosely; strict-parsed only at publish. See
[ADR 0017](docs/adr/0017-the-manuscript-and-publishing.md).

### Publish

**What:** The single deliberate act that turns a Manuscript into the next retained
`package_version`.

**Why:** It concentrates into one moment three things that would otherwise be scattered across
every save — the strict schema parse, the linter gate, and staleness propagation. ADR 0015's
blunt staleness propagation assumed a version bump was a deliberate authorial act; publishing is
what keeps that true now that editing is a screen.

**How:** Strict-parse → lint → `package_version = max(retained) + 1` → retain → repoint. Any
linter `error` blocks it; a `warn` never does. The Manuscript survives the publish, so the next
edit continues where the author was; discarding is a separate action. See
[ADR 0017](docs/adr/0017-the-manuscript-and-publishing.md).

### Working Draft

**What:** The single per-story, author-time-only sequence of scenes built up via stepwise
author-time compiles, tracking the current `package_version` per scene.

**Why:** An author iterating on a long story needs to compile incrementally without re-running
everything, and needs to know which already-compiled scenes are now out of date relative to edits
made since — that's what staleness (below) tracks, and it's a property of the Working Draft only.

**How:** Compile the next uncompiled card, or "Compile the rest" to build every remaining card in
order. See [ADR 0015](docs/adr/0015-compiled-editions-and-staleness.md).

### Stale

**What:** A Working Draft scene whose upstream digest changed on `facts_revealed`,
`entities_on_stage`, `plants_opened`, or `closing_situation` since it was compiled. Flagged,
never auto-recompiled.

**Why:** Auto-recompiling every downstream scene on every edit would be expensive and could
silently discard author-approved prose; flagging instead lets the author decide when a stale scene
actually needs redoing. Stale-but-standing is a legitimate, fully readable state.

**How:** Shown as an inline badge on the Working Draft's scene list, carrying the source scene's
diff summary as a popover. See [ADR 0015](docs/adr/0015-compiled-editions-and-staleness.md) §6.

### Read-time run loop

**What:** What "generate a new telling" starts: a durable run, one step per scene (writer call →
state-update validation → continuity pass → rollup if a window closes → flush), never streamed
live — the reader sees only scene-count progress, then the finished edition.

**Why:** Streaming a novel-length telling live, scene by scene, in front of a waiting reader would
couple generation latency directly to reading experience; running it as a batch job with a
resumable progress stream instead makes a serverless restart or a dev-server bounce recoverable
rather than fatal to the run.

**How:** `npm run telling -- <fixture>` locally, or `POST /api/stories/{storyId}/tellings` in the
app. A run with >20% of scenes degraded to fallback is marked `degraded` and can never be
auto-promoted to Baked. See [ADR 0014](docs/adr/0014-read-time-run-loop.md).

### Variance contract

**What:** Each Scene Card declares its invariants (required beats, facts revealed, exit state);
everything unnamed is free to vary. `reader_must_learn` / `must_stay_hidden` / `exit_state` are
checked mechanically against the digest; `required_beats` is self-reported by the writer, never
independently re-verified.

**Why:** Naming exactly what must hold true, rather than trying to pin down every word, is what
lets a story stay recognizably itself across many tellings while still reading freshly written
each time — and naming what's *not* checked (required beats) is an honest acknowledgment of what
the compiler can and can't verify.

**How:** Set the `required_beats` density via a per-scene `tight`/`normal`/`loose` preset (never
model temperature). A miss gets one bounded retry at read-time then accept-and-log — except
`must_stay_hidden`, which is log-only at read-time, since prose streams before the digest is
checkable and a leak can't be un-shown. See [ADR 0006](docs/adr/0006-variance-contract.md).

### Continuity pass

**What:** A pass over digests only — never full prose — scoped to exactly three digest-detectable
failure modes: cold opens/hard resets, told-ledger miscalibration, and stale imagery. May edit
seams (openings, transitions, recycled imagery) but may never change events.

**Why:** Working on digest abstractions rather than full prose is what lets this scale to
novel-length tellings without re-reading (and re-paying for) every prior scene's prose on every
step. Restricting it to exactly three modes, enforced field-by-field (it may only touch prose plus
`closing_situation`/`imagery_signature`/`reanchor_used`), keeps it from silently rewriting plot.

**How:** Runs automatically — author-time with full authority, read-time once per scene against
the persisted edition. A repair's downstream effect is handled by marking later scenes stale, not
by cascading. See [ADR 0011](docs/adr/0011-continuity-pass-over-digests.md).

### State-update tiers

**What:** The authority boundary on what the engine may commit, per the P/E/V tier legend above:
physical and epistemic updates are auto-committed if they satisfy or merely extend the Scene
Card's `exit_state`; volitional updates may only be *proposed*.

**Why:** This is what stops the engine from either contradicting a fact it has no grounds to touch
(the **amnesia guard** — never reverting a previously committed value the card gives no grounds to
change) or inventing a character's motivation outright. Silence on a volitional column is always
inaction, never invention — cross-run divergence there is accepted variance, same in kind as
dialogue or imagery.

**How:** Nothing to configure — tier is fixed per column at the schema level. Review pending
volitional proposals via the proposals queue. See [ADR 0005](docs/adr/0005-state-update-authority.md).

### Proposals queue (volitional proposal)

**What:** A volitional (goal/allegiance/feeling) state change the writer produced but the engine
can't auto-commit, sitting until the author accepts or rejects it. At read-time (no author
present), an incompatible proposal is simply dropped rather than queued.

**Why:** Volitional facts are exactly the ones where silently trusting the model would be worst —
queuing them for a human decision at author-time is the check that keeps a character's motivation
from drifting unnoticed.

**How:** Author-time: review and resolve from the scene compile view; leaving one pending never
blocks compiling the next scene. Backed by unresolved entries in the state-update commit log
(below). See [ADR 0016](docs/adr/0016-author-surfaces-and-the-state-log.md) §3.

### State-update commit log

**What:** A per-story, per-scene append-only ledger —
`{scene_index, entity_id, column, tier, previous_value, new_value, status}` — recording every
World Model change accepted or resolved.

**Why:** Keeping the log, not just the final World Model value, is what makes "World Model as of
scene N" reconstructable by replay rather than requiring a full snapshot at every scene. It also
doubles as the proposals queue's backing store — a proposal is just a log entry not yet resolved.

**How:** Written automatically; never edited directly. Persisted at
`story/{storyId}/draft/state-log.json` (Working Draft) or `edition/{runId}/state-log.json`
(Compiled edition, immutable once the run completes). See
[ADR 0016](docs/adr/0016-author-surfaces-and-the-state-log.md).

### Writer prompt contract

**What:** The single structured call that produces a scene, in fixed response order:
`prose → scene_digest → state_updates → diagnostics`. Payload assembled coarsest-to-most-volatile
(explicit-cache header → digest hierarchy → previous scene's verbatim tail → volatile tail).

**Why:** Ordering the response so prose comes first is what lets a streaming reader see words
immediately, with everything after written *about* prose that already exists. Ordering the prompt
coarsest-to-volatile is what maximizes cache hits across scenes — a stable prefix that survives
into the next scene's prompt is the difference between a cheap call and an expensive one.

**How:** Not author-facing — this is the compiler's own call shape. Inspect it via the assembled-
prompt debug view, or `npm run compile-scene -- <fixture> --verbose`. See
[ADR 0012](docs/adr/0012-writer-prompt-contract.md).

### Recitation control

**What:** Detection for a memorized-source fixture, defined as exactly `finishReason: RECITATION`
from the API — nothing else.

**Why:** The compiler's data model never holds canonical source prose, so there's nothing local to
diff generated prose against; diffing against a Scene Card's own text would falsely flag a writer
correctly following an author-mandated quotation. The API's own signal is the only reliable one.

**How:** Not configured — it's a single check on the API response, tagged `recitation_flagged` and
handled by the existing one-retry-then-fail shape. See
[ADR 0013](docs/adr/0013-recitation-control.md).

### Diagnostics

**What:** Structured signals the writer reports (`beat_unsatisfied`, `missing_fact`) or the
compiler derives after the call returns (`entry_state_mismatch`, `exit_state_contradiction`,
`unauthorized_entity_update`, `unentailed_reversion`, a missed plant, a `must_stay_hidden` leak, a
truncated or failed scene).

**Why:** Having the writer self-report what it couldn't satisfy, rather than silently papering
over an unsatisfiable beat, is what makes those failures visible instead of only discoverable by a
human re-reading the prose.

**How:** Surface as compile warnings at author-time; read-time the engine resolves autonomously
within the invariants and logs to the run report. No diagnostic severity aborts a read-time run.
See [ADR 0012](docs/adr/0012-writer-prompt-contract.md).

### Author surfaces

**What:** The four screens an author works from: the scene compile view, the World & Discourse
inspector, stale badges on the Working Draft's scene list, and the run report with manual Baked
promotion.

**Why:** These four, not the six an early design pass considered, are what the actual authoring
loop needs — everything else (naming, sharing) is a write concern layered on top rather than a
separate screen.

**How:** `/stories/{storyId}` (Working Draft + compile view), `/stories/{storyId}/inspector`,
`/stories/{storyId}/runs`, `/stories/{storyId}/read`. See
[ADR 0016](docs/adr/0016-author-surfaces-and-the-state-log.md).

---

## The seam-failure rubric

**What:** The project's acceptance test for prose quality — eight named ways a telling can go
wrong at the Performance layer (never the plot, since the author fixed Fabula/Syuzhet up front),
each paired with the mechanism that owns it or consciously left unaddressed:

| Mode | What it looks like | Caught by |
| --- | --- | --- |
| Amnesia | Narration contradicts a fact the reader already holds true | State-update validator (`unentailed_reversion`) |
| Character-voice homogenization | Dialogue/interiority reads interchangeable across characters | Generation-time only (Voice Card), unverified |
| Voice drift | The narrator's own register/distance/rhythm shifts scene to scene | Generation-time only (Voice Card), unverified |
| Cold opens / hard resets | A scene ignores the prior scene's closing situation | Continuity pass |
| Told-ledger miscalibration | "Didn't I already know that?" or a redundant re-explanation | Continuity pass |
| Dropped setup | An unpaid plant, or a payoff with no plant | Plant-obligation walk |
| Stale imagery | The same concrete image/metaphor recycled | Continuity pass |
| Uniform beat shape | Cumulative monotony across many scenes | Consciously accepted, unaddressed for v1 |

**Why:** Naming every failure mode up front — and being explicit about which ones the mechanism
*can't* catch (amnesia and the two voice-level modes are undetectable from digests alone, since
digests abstract content, not prose style) — keeps the project honest about what it actually
guarantees versus what it merely hopes for.

**How:** Not a runtime mechanism itself — it's the design document's checklist for whether a new
failure mode needs a new mechanism or is being knowingly deferred. See
[ADR 0002](docs/adr/0002-seam-failure-rubric-and-mechanism-ownership.md).

---

## Degraded

**What:** The state of a scene (or a run, if more than 20% of its scenes qualify) that fell back
to a lesser writer path — the digest-only fallback, a retry that still failed, or the lighter
`gemini-3.5-flash-lite` model — rather than a full clean writer call.

**Why:** Naming this explicitly, rather than treating a fallback scene as indistinguishable from a
normal one, is what makes a run report honest about quality and is why a `degraded` run can never
be auto-promoted to Baked.

**How:** Reported per-scene and aggregated per-run in the run report; the compile view and read
screen always name which model or path actually wrote a given scene. See
[ADR 0012](docs/adr/0012-writer-prompt-contract.md), [ADR 0014](docs/adr/0014-read-time-run-loop.md).
