# ADR 0016: Author surfaces and the World Model commit log

## Status

Accepted — settled in [Author surfaces that feed the mechanics](https://github.com/tschomay/axiom-weaver/issues/21),
prototyped on the throwaway branch `prototype/author-surfaces`
([prototype file](https://github.com/tschomay/axiom-weaver/blob/prototype/author-surfaces/prototypes/author-surfaces.prototype.html)).

## Context

The ticket named six candidates, each of which exists because some other settled ticket produces
information with nowhere to go: compile diagnostics (ADR 0005/0012), the proposals queue
(ADR 0005's volitional proposals), World Model inspection (ADR 0001/0005), the told-ledger view
(ADR 0003/0009), stale badges (ADR 0015), and run reports (ADR 0014). The job here was to rough
them in as screens, decide which are essential to the POC, which collapse into a shared inspector
rather than six panels, and which are noise — and, along the way, two real gaps surfaced that no
prior ticket had actually closed.

## Decision

### 1. Six candidates collapse to four surfaces

- **Scene compile view** — compile diagnostics *and* the proposals queue, scoped to the card just
  compiled. Author-time compiling is stepwise, one card at a time (`CONTEXT.md`, Compile
  occasions), so there is always exactly one card in view when either fires; a separate build log
  would divorce the diagnostic from the exact field the author needs to edit.
- **World & Discourse inspector** — World Model inspection *and* the told-ledger view, as two tabs
  over one scene-index scrubber. Both answer the same question ("state as of scene N") pointed at
  a different one of `CONTEXT.md`'s two memories.
- **Stale badges** — not a screen at all. Inline decoration on the Working Draft's scene list,
  reusing ADR 0015 §6's existing field-scoped diff as the popover content rather than inventing a
  second diff mechanic.
- **Run report** — aggregated across read-time runs, per Scene Card, plus the manual
  Baked-promotion action ADR 0014 §9 requires exist *somewhere*.

All four ship for the POC; none was cut. What *is* cut is a category of information within them —
see decision 4.

### 2. New schema: the World Model commit log

Prototyping the inspector's scrubber exposed a real gap: nothing in the settled schema persists
World Model state *per scene*. `docs/schema/story-package.md` and
[ADR 0015](0015-compiled-editions-and-staleness.md) §4 only ever write current/final state
(`edition/{runId}/world-model.json` is a single snapshot at the close of a run) — there is nothing
to reconstruct "what the world looked like right before scene 6" from.

Every committed World Model change is now appended to a per-story, per-scene **state-update
commit log**: `{scene_index, entity_id, column, tier, previous_value, new_value, status}`, with
`status` one of `committed` (an auto-accepted P/E update, ADR 0005 §2) or `proposed_applied` /
`proposed_dropped` (a resolved volitional proposal). It is an append-only ledger, not a new
authority — ADR 0005 still decides what's accepted or dropped; this only keeps what ADR 0005
decided instead of only keeping the final value. "World Model as of scene N" is the World Model
seed replayed forward through every `committed`/`proposed_applied` entry with
`scene_index ≤ N`. The log is also the proposals queue's backing store: a proposal is a log entry
not yet resolved.

Persistence follows ADR 0015's existing convention: `story/{storyId}/draft/state-log.json` for the
Working Draft, `edition/{runId}/state-log.json` for a Compiled edition (same shape, immutable once
the run completes).

### 3. Author-time volitional resolution: a queue, closing a silence in ADR 0005

[ADR 0005](0005-state-update-authority.md) §3 ("Unattended resolution has one rule: apply, or
don't") is framed explicitly around read-time — "at read time there's no author to confirm a
volitional proposal." It never claims to cover author-time, where an author *is* present. Issue
#21's own framing of the proposals queue ("accepting one edits the World Model — so this is an
authoring surface, not just a notification") is exactly this silence asking to be filled, not a
reason to relitigate ADR 0005.

**Decision:** at author-time, a volitional proposal is never auto-applied or auto-dropped — it sits
in the proposals queue as `proposed` until the author explicitly accepts or rejects it. Accept
commits the log entry as `proposed_applied`; reject as `proposed_dropped`. Leaving it untouched
keeps it pending and does **not** block compiling the next scene — a later scene's entry-state
check reads the World Model's last *resolved* value, exactly as if the pending proposal didn't
exist, matching the map's "unattended, never blocking" preference even though an author is present
here. At read-time, ADR 0005 §3's existing apply-or-drop invariant test is unchanged — this ticket
narrows nothing there.

### 4. Severity decides which surface, not just how loud

ADR 0005 §5's three severities now map to where they render, so the scene compile view doesn't
accumulate log lines the author will learn to skim past:

| Severity | Example | Surface |
| --- | --- | --- |
| `error` | `exit_state_contradiction`, `unentailed_reversion`, `entry_state_mismatch`, `unauthorized_entity_update` | Scene compile view, named against the exact contradicted field. Also logged to the run report. |
| `warn` | writer-reported `beat_unsatisfied`/`missing_fact`; a volitional proposal auto-dropped at read-time | Scene compile view at author-time; run report only at read-time (no author watching live). |
| `info` | an accepted volitional commit that needed no live decision because an earlier author-time accept already resolved it | **Run report only, never surfaced live.** The one category issue #21 flagged as risking becoming noise — cut from live display rather than shown quietly. |

## Consequences

- `docs/schema/story-package.md` gains the state-update commit log as a new persisted artifact
  alongside the World Model tables; its persistence-path note should point here rather than
  restating the shape.
- `CONTEXT.md` gains **Author surfaces**, the **state-update commit log**, and the author-time
  proposals-queue rule as terms in the Compilation section.
- [ADR 0005](0005-state-update-authority.md) is unchanged — this ADR fills a silence it left
  around author-time, it does not revise §3's read-time rule.
- [ADR 0015](0015-compiled-editions-and-staleness.md) §6's field-scoped diff is reused as the
  stale-badge popover content rather than duplicated.
- The map's fog item "a global story clock / time of day" is untouched by this ticket — run state,
  not an entity the commit log tracks.
