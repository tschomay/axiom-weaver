# ADR 0015: Compiled editions and staleness

## Status

Accepted — settled in [Compiled editions and staleness](https://github.com/tschomay/axiom-weaver/issues/20),
part of [Map: The Narrative Machine](https://github.com/tschomay/axiom-weaver/issues/1).

## Context

Two connected questions: how a read-time run is persisted and kept, and what happens to the
rest of a story when the author edits one Scene Card that earlier scenes were already
compiled downstream of.

[ADR 0014](0014-read-time-run-loop.md) already fixed the reader-facing shape — a three-way
choice of Baked / a saved library version / generate a new telling — and explicitly deferred
this ticket the library's own semantics (naming, sharing, retention) and the diffing
mechanic, without narrowing either. [`docs/schema/story-package.md`](../schema/story-package.md)
already defines `package_version` as the author-incremented integer a Compiled edition pins,
at the granularity that matters for diffing runs — but its persistence path
(`story/{storyId}/package.json`) was a single overwritten pointer with no history, which
turns out to matter: an edition's pinned `package_version` isn't actually dereferenceable
without one, and staleness detection needs an old-vs-new comparison to diff against.

The ticket's own staleness scenario — "the author edits scene 5 of 40; scenes 6 onward were
written against the old scene 5" — doesn't fit anywhere in the model as it stood. A
Compiled edition is read-time, batch, and immutable once produced (ADR 0011); nothing in the
settled ADRs has the author editing a card that a frozen edition depends on, and a frozen
edition can't meaningfully "go stale" without contradicting its own immutability. The
scenario only makes sense against a *different* object: the accumulating, author-time
sequence CONTEXT.md's existing "Compile occasions" already gestures at ("author-time:
stepwise, human in the loop, iterating a card") but had never named.

## Decision

1. **New term: Working Draft.** A single per-story, author-time-only sequence of scenes,
   built up via stepwise author-time compiles, that always tracks the current
   `package_version` on a per-scene basis (each scene records which `package_version` it was
   compiled against). **Staleness is a property of the Working Draft only.** A Compiled
   edition pinned to `package_version` N stays fully correct and unlabeled forever, even
   after the author advances the package to N+1 — it is never marked stale, and there is no
   reader-facing "this predates the current version" signal on it. That information matters
   only to the author, and the Working Draft's own staleness badges already serve it. This
   directly answers the ticket's "what happens to editions when the Story Package changes
   underneath them": nothing — a Compiled edition doesn't reference the live package at all
   after it's compiled, only the immutable snapshot it pinned (decision 2).

2. **Story Package versions are retained as immutable snapshots.** Every `package_version` is
   written to its own path, `story/{storyId}/package/{version}.json`;
   `story/{storyId}/package.json` becomes a convenience pointer to the current version. This
   is what makes "pins the `package_version` it was compiled from" more than a label, and is
   the substrate staleness diffing (decision 3) reads from.

3. **Staleness mechanics.** Triggered when the author recompiles an edited Scene Card in the
   Working Draft: the scene's freshly produced Scene Digest is compared against the digest it
   is about to replace — the one later Working Draft scenes were originally built against, no
   extra history needed beyond what's already there. The comparison is field-scoped:
   `facts_revealed`, `entities_on_stage`, `closing_situation`, `plants_opened` are diffed.
   `payoffs_closed` is excluded — a payoff only ever references an *earlier* plant, so it
   can't create a forward dependency; a change there is already caught by
   [ADR 0004](0004-plant-obligation-walk.md)'s own plant-walk validation, a different
   mechanism. `imagery_signature`, `reanchor_used`, and `event_summary` are excluded too —
   self-reported style/pacing metadata or free text, with no downstream dependency (see
   [ADR 0003](0003-scene-digest-and-told-ledger.md) for the full digest field set). On any
   diff in the scoped fields, propagation is **blunt for v1**: every later scene in the
   Working Draft is flagged stale, unconditionally — never auto-recompiled or cascaded,
   flagging only. The flag carries the source-scene diff summary (e.g. "scene 5 changed:
   facts_revealed added X, removed Y; closing_situation changed"), not a computed per-scene
   relevance judgment. A precise, dependency-tracked propagation — a scene flags only if it
   actually declares a dependency on the changed fact/entity, reusing the deterministic-join
   approach [ADR 0008](0008-zoom-level-context-assembler.md) and ADR 0004 already use — is the
   natural refinement if blunt-flagging proves too noisy in practice; not built now.
   Stale-but-standing is legitimate: nothing auto-recompiles, nothing nags the author, and a
   Working Draft (or a Compiled edition made from it) with stale scenes remains fully
   readable. The concrete stale-badge UI is
   [Author surfaces that feed the mechanics](https://github.com/tschomay/axiom-weaver/issues/21)'s
   job; this ADR only fixes the underlying data — which scenes are flagged and what summary
   they carry.

4. **Compiled edition contents and Blob layout.** A Compiled edition holds the World Model
   seed, the `package_version` it was compiled from, per-scene prose + Scene Digest, and the
   run report ([ADR 0014](0014-read-time-run-loop.md)). Layout follows
   [`docs/research/vercel-runtime.md`](../research/vercel-runtime.md)'s sketch:
   `edition/{runId}/manifest.json` (status, pinned `package_version`, scene index, run report
   reference), `edition/{runId}/scene-{n}.json` (prose + digest per scene),
   `edition/{runId}/world-model.json`, `edition/{runId}/discourse.json`. The Working Draft
   mirrors this shape at a per-story path prefix instead of per-run:
   `story/{storyId}/draft/manifest.json` (per-scene `compiled_against_package_version` and
   stale flags) and `story/{storyId}/draft/scene-{n}.json`.

5. **Identity, sharing, and the library.** Every completed read-time run is a Compiled
   edition — CONTEXT.md's existing definition ("any persisted run... re-readable, shareable,
   and diffable") already covers this, unnarrowed — addressable and shareable by its run
   ID/URL indefinitely; nothing is ever auto-deleted, matching ADR 0014's existing "never
   auto-deleted by this ticket's mechanism." Sharing an edition's URL exposes only that
   edition's own content (prose, digests) — never the Story Package (Scene Cards, World Model
   seed, Voice Card) behind it, which stays an author-only surface no matter how many editions
   are shared. The **library** — the second option in ADR 0014's three-way reader choice — is
   a single story-scoped flat list, not a personal collection per reader (the map's Out of
   scope already excludes multi-user auth), and is **author-gated**: only the author can
   save/name/delete entries in it. A reader can still generate a run and share it by direct
   URL, or rejoin their own still-in-flight run (ADR 0014), without needing library-write
   access — fully satisfying the ticket's "a reader who loves a telling should be able to
   return to it, share it, or set it beside another run" without opening a shared,
   unmoderated list to anonymous write access.

6. **Diffing two editions is scoped to the same `package_version` only.** Cross-version
   comparison is a different question — what an author's edit did to the story — already
   owned by the Working Draft/staleness mechanism (decisions 1–3); conflating the two would
   confuse authored change with generation variance. Within a matched pair, the comparison
   surface is structured: per-scene Scene Digest field differences
   (`facts_revealed`/`entities_on_stage`/`closing_situation`/`imagery_signature`/`event_summary`
   gist) as the primary view, with both editions' full prose available side-by-side for
   reading — never a line-level text diff of prose. This is a direct instantiation of the
   variance contract ([ADR 0006](0006-variance-contract.md)): a way to see exactly what the
   engine chose to vary between two tellings of the same invariants.

## Consequences

- `CONTEXT.md` gains **Working Draft** as a first-class term alongside Compiled edition and
  Baked edition, and its Compilation section records that staleness is exclusively a Working
  Draft property.
- [`docs/schema/story-package.md`](../schema/story-package.md)'s persistence path note is
  superseded: `package.json` is now a pointer, not the sole record — historical
  `package_version` snapshots exist at their own paths.
- [Author surfaces that feed the mechanics](https://github.com/tschomay/axiom-weaver/issues/21)
  inherits: the stale-badge data shape (source-scene diff summary, blunt-flagged scene list)
  to design a screen for, the Working Draft as a distinct authoring surface from the run
  report, and the library's author-gated save/name/delete affordance.
- No reader-facing surface is added by this ADR — the three-way choice, the "no two reads are
  quite the same" disclosure (ADR 0006), and the run-ID rejoin rule (ADR 0014) are all
  unchanged; this ADR only fills in what "the library" and "diffing" concretely mean.
- The map's "Not yet specified" fog item about whether a Compiled edition ever needs a
  version-drift signal is resolved as: no — deliberately not built, per decision 1.
