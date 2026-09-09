# ADR 0014: The read-time run loop

## Status

Accepted — settled in [The read-time run loop](https://github.com/tschomay/axiom-weaver/issues/19).

## Context

Every other read-time mechanism (the writer prompt contract, state-update authority, the
continuity pass, the variance contract) had been designed in isolation. This ticket is where
they compose into the actual end-to-end loop: what happens when a reader presses play.

The ticket's own text asked about streaming the current scene to a reader while generating the
next, and about a reader "closing the tab at scene 12 and returning tomorrow" — both of which
presume a reader watching generation happen live, scene by scene. But
[The continuity pass over digests](https://github.com/tschomay/axiom-weaver/issues/15)
(ADR 0011) had already settled that the primary read-time pathway is **batch**: the whole
compiled edition is generated before a reader ever opens it. And the map's own **Out of scope**
section rules out "a reader watching the story generate in front of them, scene by scene, in
real time" as a future expansion, not this destination. The ticket's original framing was
written before that was locked down and needed reconciling before anything else could be
decided.

[Vercel runtime research](https://github.com/tschomay/axiom-weaver/issues/6)
(`docs/research/vercel-runtime.md`) had already fixed the execution shape — a Vercel Workflow,
one step per scene, no maximum run duration, a resumable stream keyed by run ID, persistence to
Blob flushed at scene boundaries — but its own "recommended arrangement" leaned on that
resumable stream as a reader-facing prose pipe, which is exactly the shape the map rules out.
This ADR uses the same durability primitive for a narrower purpose instead.

## Decision

1. **No live streaming of prose to a present reader, ever, at v1.** Pressing "generate a new
   telling" starts a durable Workflow run. The reader never watches prose stream in during
   compilation — they see only a progress state until the run completes, then read the finished
   edition exactly as they would a Baked one. Live, interactive generation stays the named
   future expansion the map already excludes; nothing here forecloses it, since the mechanism
   used for progress (below) already generalizes to a content stream if that expansion is ever
   built.

2. **One Workflow step per scene.** Each step runs, in sequence, inside a single
   `"use step"` boundary: the writer call (with its own internal bounded retry, per
   [ADR 0012](0012-writer-prompt-contract.md)) → state-update validation
   ([ADR 0005](0005-state-update-authority.md)) → the continuity pass
   ([ADR 0011](0011-continuity-pass-over-digests.md)) → a digest rollup if a window closes
   ([ADR 0008](0008-zoom-level-context-assembler.md)) → a Blob flush. These sub-operations are
   fast and none needs its own durability boundary — the writer call already owns its retry —
   so splitting them into separate steps would only inflate the billed Workflow Events count
   (the actual metered/billed axis, not wall-clock time) with no reliability upside.

3. **The reader-facing choice is three-way: Baked / a saved version from the library / generate
   a new telling.** Baked is the default — deterministic, zero compile latency. "Generate a new
   telling" is opt-in and explicit, mints a **brand-new run ID every time** ("every read of the
   story is a fresh run by design"), and is never silently reused. The **only** thing ever
   rejoined is the reader's own still-in-flight run, via the run ID already in their session or
   URL — never a previous completed run or another reader's abandoned one. Every completed run
   persists via this loop's own scene-boundary Blob flush and is never auto-deleted by this
   ticket's mechanism. The library itself — its UI, naming, sharing, diffing, and any
   retention/GC policy — is
   [Compiled editions and staleness](https://github.com/tschomay/axiom-weaver/issues/20)'s to
   design; this ticket only establishes that the three-way choice exists and that nothing here
   throws a completed run away.

4. **Progress UI is scene-count, not a percentage or a generic spinner**: "compiling scene 7 of
   14," sourced from step completion. It is delivered over the same resumable stream already
   built for reconnect-safety (decision 2's Workflow primitive), carrying status events only —
   never prose, never diagnostics, never any other compiler artifact. One mechanism serves both
   reliability and the progress UI, rather than a second polling path duplicating the same
   reconnect edge cases.

5. **A pre-generation estimate shows wall-clock time only, never cost.** Before a reader commits
   to "generate a new telling," they see an estimate like "about 2–4 minutes," computed from the
   story's scene count (known from its Scene Cards) times a rolling average of that story's own
   measured per-scene compile time, falling back to a project-wide default average before any
   run data exists for that story. Cost is an author/ops concern already covered by the run
   report (decision 8); a pre-generation cost estimate would need per-scene token projections
   with no principled basis before the scene is actually written, so it is not shown.

6. **Budget is soft-logged, never a hard cap.** No global per-run token/dollar ceiling aborts a
   run. Exceeding an expected budget is a run-report flag for the author to notice later
   (decision 8), never surfaced to the reader and never blocking, consistent with the map's
   standing "unattended, never blocking" rule.

7. **Failure handling distinguishes systemic outage from per-scene content failure.** Per-scene
   failures already resolve via ADR 0005's and ADR 0012's existing "one bounded retry, then
   accept-and-log, never blocking" shape — unchanged, not re-decided here. A
   systemic/provider-outage-shaped failure (repeated hard errors, not a content issue) halts
   forward progress on that step and lets the Workflow's own retry/backoff resume it — invisible
   to the reader beyond stalled progress. Past a threshold of roughly 90 seconds with no scene
   completing, the reader is offered an escape hatch: read the Baked edition while the live run
   keeps compiling, unattended, in the background regardless of whether they take the offer. If
   more than roughly 20% of a run's scenes degrade to fallback, the whole run is marked
   `degraded` in the run report and is never auto-promoted to Baked (decision 9) — but the
   reader who requested it can still read it.

8. **The run report captures, per scene, whatever diagnostics/retries/fallbacks/repairs already
   exist in the established taxonomy** (ADR 0005's and ADR 0012's diagnostic types, ADR 0011's
   continuity repairs), plus this ticket's own run-level budget and `degraded` flags — and never
   the request envelope sent to Gemini, per the secret-exposure warning in
   `docs/research/vercel-runtime.md`. It aggregates across runs grouped by Scene Card id, so an
   author can see, e.g., "Scene 13 has degraded on 4 of 20 reads" — the signal that names which
   cards are underspecified. Stored as Blob documents alongside the edition, per the layout
   `docs/research/vercel-runtime.md` already sketches.

9. **Promotion to Baked is manual, author-initiated, from the run report/author surface**
   ([#21](https://github.com/tschomay/axiom-weaver/issues/21)) — never automatic, and never
   available for a `degraded` run (decision 7).

10. **Pacing: the whole story is delivered at once** once a run completes. Gated or serialized
    delivery (chapter by chapter, or gated on reading position) is a content-strategy feature
    orthogonal to the compiler's job — nothing in the settled ADRs requires it, and designing it
    here would be new product surface the map's destination doesn't need. Left undesigned rather
    than speculatively ticketed.

## Consequences

- `CONTEXT.md` gains a "Read-time run loop" entry in the Compilation section describing this
  shape, and the three-way reader choice supersedes any earlier assumption that "live" meant a
  single always-current run.
- [Compiled editions and staleness](https://github.com/tschomay/axiom-weaver/issues/20) inherits
  the library ownership named in decision 3 — its own scope already covers this ("a reader who
  loves a telling should be able to return to it, share it, or set it beside another run"), so
  nothing here narrows or widens it, only confirms the boundary.
- [Author surfaces that feed the mechanics](https://github.com/tschomay/axiom-weaver/issues/21)
  inherits the run report's shape (decision 8) and the manual-promotion affordance (decision 9)
  as concrete surfaces to design screens for.
- `docs/research/vercel-runtime.md`'s recommended arrangement (resumable stream as a reader-facing
  content pipe) is adopted for its durability properties only; its content is narrowed to status
  events, per decision 4.
- The map's "Cost and latency envelope per read at novel scale" fog item still needs a *measured*
  per-scene cost/latency once this loop is actually built and run — this ADR settles the design,
  not the measurement, which is implementation work outside a wayfinder ticket.
