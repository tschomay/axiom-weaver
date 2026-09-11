# Glossary

Every non-standard term used in this codebase, as a quick reference. [`CONTEXT.md`](./CONTEXT.md)
is the canonical ubiquitous language and the detailed read — use these terms exactly, the way it
says to. This file is a lookup table, not a substitute for it.

Grouped the way `CONTEXT.md` groups them; alphabetical within each group.

## The three layers

| Term | How | What | Why |
| --- | --- | --- | --- |
| Fabula | Not authored separately — it's whatever the World Model seed and Scene Cards jointly establish. | The world and its events in chronological order. Owned by the author. | Separating "what happened" from "how it's shown" is what makes secrets and dramatic irony possible. |
| Performance | Never authored — it's the writer's output for a Scene Card. | The actual sentences: dialogue, interiority, imagery, rhythm. The only layer the engine owns. | Confines variance between readings to prose alone; plot stays fixed while phrasing stays fresh. |
| Syuzhet | Authored as the ordered Scene Cards (`order`, `pov`, `reader_must_learn`, `must_stay_hidden`). | The arrangement: scene order, POV, what's shown vs. withheld. | Fixed at authoring time so arrangement never drifts between tellings — the engine never touches it. |

## Core objects

| Term | How | What | Why |
| --- | --- | --- | --- |
| Required beats | Set per Scene Card; density via `tight`/`normal`/`loose` (ADR 0006). | The variance dial: few beats = wide improvisation, many = tight repetition. | One dial per scene beats a global setting that can't account for scenes needing different freedom. |
| Scene Card | Author one per beat; only 8 fields are required. | The authored unit: order, POV, location, beats, entry/exit state, invariants. | The granularity the engine performs and the compiler checks against — never inferred from prose. |
| Story Package | `npm run load-fixtures`, or write one following an existing fixture. | World Model seed + Scene Cards + Voice Card — the compiler's entire input. | Bundling these three is what lets a story compile unattended, repeatedly, like source code. |
| Style exemplar | Optional; write a passage in the target voice. | A hand-written passage on the Voice Card demonstrating tone instead of describing it. | Some voice qualities are easier to show than to specify as discrete fields. |
| Style presets | Pick one as a Voice Card's starting point, then edit freely. | Five validated starting voices (Fairy-Tale, Gothic, Whimsical, Hardboiled, Lyrical). | Expands into an editable card, not an opaque tag — editing the preset later can't retroactively change an already-told story. |
| Voice Card | Start from a preset or write from scratch; edit fields directly (ADR 0007). | The narrator as data: person, tense, distance, register, rhythm, imagery palette. | Authored, stable voice data survives dozens of writer calls better than one prompt instruction would. |

## The two memories

| Term | How | What | Why |
| --- | --- | --- | --- |
| Bag | Add author-invented scalar attributes as needed. | The open key-value column on any World Model row for attributes with no dedicated column. | A fixed schema can't anticipate every attribute; the bag is the escape hatch, kept flat on purpose. |
| Discourse Record | Inspect via the told-ledger tab of the World & Discourse inspector. | Scene Digests + told-ledger: what the reader has been told, and when. | Tracks reader knowledge — the World Model's counterpart, so exposition doesn't repeat. |
| Imagery ledger | Built automatically; not author-facing (ADR 0010). | The recency instruction (domains drawn from vs. not) shown to the writer after the Voice Card. | Framed positively so a palette domain can recur on purpose as a motif, never outright banned. |
| Re-anchoring policy | Force a band via a Scene Card's `force_reintroduce` field (ADR 0009). | The introduce/assume/reanchor/reintroduce decision per entity per scene. | Stops both over-explaining every scene and under-explaining after a long absence. |
| Rollup | Produced automatically once a zoom level's window fills. | A Chapter/Part/Book Digest: same schema as a Scene Digest, aggregated over a window. | Synthesizing instead of concatenating keeps context growing logarithmically, not linearly. |
| Scene Digest | Never authored — writer output, validated and stored automatically (ADR 0003). | The compressed record (event summary, facts revealed, imagery, closing situation) emitted with the prose. | One call for both prose and digest keeps novel-length tellings affordable. |
| Tier legend (P/E/V) | Fixed per column at the schema level; nothing to configure. | Physical / Epistemic / Volitional — the authority class of every World Model property. | Not every fact deserves equal trust; volitional facts are too subjective to auto-commit. |
| Told-ledger | Inspect "state as of scene N" via the World & Discourse inspector. | The table of `{fact_ref, first_learned_scene, last_touched_scene, centrality}`. | Tracking *when* a fact was learned, not just whether, is what drives re-anchoring decisions. |
| World Model | Query `GET .../world-model?scene=N`, or the inspector screen. | Relational tables of cold, queryable ground truth at the current moment. | Lets the engine check a scene's claims mechanically instead of trusting prose to stay consistent. |

## Context assembly

| Term | How | What | Why |
| --- | --- | --- | --- |
| Plant obligations | Authored as `pays_off: [{fact_ref, plant: scene_id \| null}]` (ADR 0004). | Derived per-scene obligations from a backward walk over `pays_off` links. | A scene that knows it owes a future plant can seed it deliberately; an undeclared plant is a hard authoring error, not a guess. |
| Zoom levels | Not configured — sized automatically by scene count (ADR 0008). | The recursive Scene → Chapter → Part → Book digest rollup hierarchy. | Rolling up windows, not a fixed two-level scheme, is what makes context grow logarithmically with book length. |

## Compilation

| Term | How | What | Why |
| --- | --- | --- | --- |
| Author surfaces | Reach via `/stories/{storyId}`, `/inspector`, `/runs`, `/read` (ADR 0016). | The four author screens: compile view, inspector, stale badges, run report. | These four are what the authoring loop actually needs, not the six an early design considered. |
| Baked edition | Promoted manually from a completed, non-degraded run. | The fixed, known-good edition shipped as the default telling. | Guarantees a reliable first read instead of a coin flip on whichever run compiled. |
| Compile occasions | Author-time: Working Draft compile. Read-time: "generate a new telling." | Author-time (stepwise) vs. read-time (unattended, batch) — two supervision modes, one engine. | Iteration and a finished telling are different needs; they don't require two separate compilers. |
| Compiled edition | Diff two editions of the same `package_version` via digest fields. | Any persisted run, pinned to its `package_version`, immutable once produced (ADR 0015). | Immutability means an edition stays correct forever, even as the Story Package keeps evolving. |
| Continuity pass | Runs automatically: full authority author-time, once per scene read-time. | A digest-only repair pass for cold opens, told-ledger miscalibration, and stale imagery (ADR 0011). | Working on digests, not full prose, is what lets it scale to novel length without re-reading everything. |
| Degraded | Reported per-scene and per-run in the run report. | A scene/run that fell back to a lesser writer path (digest-only, retry, or lighter model). | Naming the fallback explicitly is what keeps a degraded run from ever auto-promoting to Baked. |
| Diagnostics | Surface as compile warnings (author-time) or run-report entries (read-time). | Signals the writer self-reports, or the compiler derives after a call returns. | Visible failure beats silently papering over an unsatisfiable beat. |
| Library | Author saves, names, and deletes entries. | The author-curated list of saved Compiled editions a reader can return to. | Distinct from a reader's ability to revisit any run by direct URL — this is the curated subset. |
| Proposals queue | Author reviews and resolves from the scene compile view. | Pending volitional state changes the engine can't auto-commit. | Volitional facts are where blind trust would hurt most; queuing forces a human decision. |
| Read-time run loop | `npm run telling -- <fixture>`, or `POST .../tellings`. | The unattended run: writer call → validation → continuity pass → rollup → flush, per scene (ADR 0014). | Batch generation with resumable progress survives a restart; live streaming would not. |
| Recitation control | Not configured — a single check on the API response (ADR 0013). | Detection defined as exactly `finishReason: RECITATION`, nothing else. | The compiler holds no canonical source prose to diff against locally, so the API's own signal is the only reliable one. |
| Stale | Shown as an inline badge on the Working Draft, with a diff popover. | A Working Draft scene whose upstream digest changed since it was compiled. | Flagging, not auto-recompiling, protects author-approved prose from being silently discarded. |
| State-update commit log | Written automatically; never edited directly (ADR 0016). | The append-only ledger of every committed/proposed World Model change, per scene. | Keeping the log, not just the final value, is what makes "World Model as of scene N" replayable. |
| State-update tiers | Nothing to configure — tier is fixed per column (ADR 0005). | The authority rule: P/E auto-commit if compatible with `exit_state`; V may only be proposed. | Stops the engine both contradicting known facts (the amnesia guard) and inventing motivations outright. |
| Variance contract | Set `required_beats` density via `tight`/`normal`/`loose` (ADR 0006). | Invariants a Scene Card declares as fixed; everything unnamed is free to vary. | Naming what must hold lets a story stay itself across tellings while reading freshly written each time. |
| Working Draft | Compile the next card, or "Compile the rest." | The per-story, author-time sequence of scenes built up via stepwise compiles. | Lets an author iterate incrementally and see which compiled scenes are now out of date. |
| Writer prompt contract | Inspect via the debug view or `npm run compile-scene -- <fixture> --verbose`. | The fixed call shape: `prose → scene_digest → state_updates → diagnostics`, ordered coarsest-to-volatile (ADR 0012). | Prose-first lets a reader stream words immediately; coarsest-to-volatile ordering maximizes cache hits. |

## The seam-failure rubric

Eight named ways a telling can go wrong at the Performance layer — never the plot, since the
author fixed Fabula/Syuzhet up front. See [ADR 0002](docs/adr/0002-seam-failure-rubric-and-mechanism-ownership.md).

| Mode | Looks like | Digest-detectable? | Caught by |
| --- | --- | --- | --- |
| Amnesia | Narration contradicts a fact the reader already holds true. | No | State-update validator (`unentailed_reversion`) |
| Character-voice homogenization | Dialogue/interiority reads interchangeable across characters. | No | Generation-time only (Voice Card), unverified |
| Cold opens / hard resets | A scene ignores the prior scene's closing situation. | Yes | Continuity pass |
| Dropped setup | An unpaid plant, or a payoff with no plant. | Yes | Plant-obligation walk |
| Stale imagery | The same concrete image/metaphor recycled. | Yes | Continuity pass |
| Told-ledger miscalibration | "Didn't I already know that?" or a redundant re-explanation. | Yes | Continuity pass |
| Uniform beat shape | Cumulative monotony across many scenes. | Partially | Consciously accepted, unaddressed for v1 |
| Voice drift | The narrator's own register/distance/rhythm shifts scene to scene. | No | Generation-time only (Voice Card), unverified |
