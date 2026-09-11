# ADR 0011: The continuity pass over digests

## Status

Accepted — settled in [The continuity pass over digests](https://github.com/tschomay/axiom-weaver/issues/15).

## Context

[The seam-failure rubric](https://github.com/tschomay/axiom-weaver/issues/3) (ADR 0002) originally
gave this pass four digest-detectable failure modes. [The plant-and-payoff obligation walk](https://github.com/tschomay/axiom-weaver/issues/8)
(ADR 0004) then gave dropped-setup detection entirely to its own reverse-index validator — a
narrower scope than ADR 0002 first assigned, already reflected in `CONTEXT.md`'s rubric table but
not yet corrected on this ticket itself. [Re-anchoring policy](https://github.com/tschomay/axiom-weaver/issues/13)
(ADR 0009) and [Repetition and voice-drift control](https://github.com/tschomay/axiom-weaver/issues/14)
(ADR 0010) each added a digest field — `reanchor_used`, and a domain tag on `imagery_signature` —
specifically to make this pass's remaining modes checkable.

The map's Notes fix read-time compiles as unattended and never blocking on an absent author. This
ticket also settles a fact those Notes left implicit: the primary pathway batch-generates the
*entire* compiled edition before a reader ever opens it — there is no reader watching a read-time
compile in progress. Live, token-by-token generation in front of an active reader is a future
expansion, out of scope for this map (see `CONTEXT.md` addendum below). That fact is what makes a
streaming-compatible pass tractable at all: "unattended" means no human in the loop, not a race
against a reader's eyes.

## Decision

1. **Scope: three modes, not four.** Cold opens/hard resets, told-ledger miscalibration, stale
   imagery. Dropped setup is explicitly excluded — it is fully owned by the plant-obligation walk's
   own pre-generation validation and read-time retry-then-log (ADR 0004), and routing it through
   the continuity pass too would be a duplicate, weaker check on data that walk already owns
   outright. This corrects ADR 0002's original four-mode assignment; issue #15's own stale
   scoping comment is superseded by this ADR.

2. **It runs twice: author-time (full authority) and read-time (bounded).** Author-time, over a
   card being iterated with a human present, it may inspect and repair freely, no retry limits.
   Read-time, it runs once per scene, immediately after that scene's digest is available and
   before the compiled edition is exposed to any reader — comparing the just-finished scene's
   digest against the immediately preceding scene's digest and the told-ledger state, the same
   adjacent-pair shape the ticket's own premise describes ("it reads the abstraction, decides a
   seam is broken, and only then pulls the specific passage it needs to repair"). There is no
   separate "full-draft-only" mode: since read-time already means "before any reader," the
   per-scene form is the complete read-time pass, not a lesser fallback for one.

3. **Repair target: the persisted edition, never a live reader.** Because generation is batch and
   unattended (decision 2), a caught-and-repaired seam is fixed before the compiled edition is
   ever shown to anyone — there is no "too late, already streamed to this reader" case to worry
   about in the primary pathway. This still matters as a stated rule because it settles that a
   repair is a rewrite of stored prose plus its digest, not an intervention in some live display
   loop that issue #19 (the read-time run loop, still open) hasn't specified yet.

4. **Edit authority is a field-level rule, not a prompt promise.** A repair call may only change
   the affected scene's prose text and, correspondingly, `closing_situation` / `imagery_signature`
   / `reanchor_used` — the fields a seam fix can legitimately touch. `facts_revealed`,
   `plants_opened`, `payoffs_closed`, `entities_on_stage`, and any `state_updates` from the
   original scene are carried over verbatim and diffed byte-for-byte against their pre-repair
   values; a mismatch discards the repair and logs it, the same accept/reject-by-field shape
   ADR 0005 already uses for state-update authority. This is what turns "may edit seams, may not
   change events" from a prompt-level instruction into something code can check.

5. **Repair granularity is per-mode, not uniform — two repair-call shapes.**
   - **Cold opens / told-ledger miscalibration**: rewrite only the affected scene's opening
     beat/transition, via a small targeted call fed the prior scene's `closing_situation` and the
     told-ledger state at that scene's entry. Never regenerates the scene body.
   - **Stale imagery**: a small call locates and swaps just the offending phrase/sentence in the
     scene's stored prose, identified by the domain-tag collision (ADR 0010) that triggered the
     check. Never rewrites anything else in the scene.

   Both shapes obey decision 4's field rule. A single uniform "always regenerate the opening
   paragraph" mechanism was considered and rejected: stale imagery isn't reliably confined to a
   scene's opening, so a single shape would miss it.

6. **Cascade: reuse staleness, don't build a second cascade.** A repair may change
   `closing_situation` / `imagery_signature` / `reanchor_used` as a side effect, which can
   invalidate the next scene's seam check. Rather than the pass re-checking or iterating on its
   own repairs, one repair attempt per caught seam is made, and every downstream scene is marked
   **stale** via the mechanism `CONTEXT.md` already defines and issue #20 (compiled editions and
   staleness) already owns. No bounded-iteration loop is built for this ticket.

7. **Cost: a per-scene bound, no global ceiling.** Each scene can trip at most a few small,
   targeted repair calls (never a full-scene regeneration), so the worst case is already bounded
   per scene, the same shape as ADR 0004/0005's "one bounded retry." No separate cap on total
   repairs per read is added — there is no cost problem here to solve yet.

## Consequences

- Issue #15's own outdated scoping comment (quoting ADR 0002's original four-mode list) is
  superseded by decision 1; this ADR is the current source of truth for the pass's scope.
- `CONTEXT.md`'s "Continuity pass" bullet and its Compilation section gain the batch-pregeneration
  clarification (decision 2's premise) as a standalone addendum, since it is a project-wide fact
  that also bears on issues #6, #19, and #20 — not something specific to this ticket alone.
- Issue #16 (the writer prompt contract) is unaffected in scope, but its per-scene step is where
  decision 2's "run immediately after each scene's digest is available" hook lives once the
  read-time run loop (#19) is built.
- Issue #19 (the read-time run loop) implements the per-scene continuity-pass invocation as part
  of its per-scene step, and must not assume any live-display buffering beyond what decision 3
  already settles (none needed).
- Issue #20 (compiled editions and staleness) is the mechanism decision 6 hands cascade
  responsibility to — no new staleness semantics are introduced, this ticket just routes into it.
- A new fog item is added to the map's "Not yet specified": whether ADR 0006's must_stay_hidden
  "log-only, can't be un-shown" reasoning still holds now that read-time is confirmed batch
  pre-generation rather than live streaming to an active reader — flagged, not reopened here,
  since it belongs to issue #10's territory, not this ticket's.

## Amendment (2026-09-11)

Two implementation findings from the first live run that reached the pass (issues #58, #59). Both
are refinements inside decisions 4–7, not reopenings of them.

**A repair no longer asks for `closing_situation`.** Decision 4 *permits* a repair to touch it, and
the implementation duly put it in the opening-rewrite response schema — but decision 5 confines an
opening rewrite to the opening beat and says it "never regenerates the scene body", so a rewrite of
how a scene picks up cannot legitimately move where it ends. Asking for the field only created a
way to get it wrong, and it did: `repairPrompt` shows the model the **previous** scene's closing
situation, because that is the seam being repaired against, and never the scene's own. The model
echoed the previous one back, decision 4's field check passed it (the field was on the repairable
list), and a scene's ending was overwritten with the one before it. `closing_situation` is now
carried over verbatim on both repair shapes. Decision 4's permission is unchanged — nothing exercises
it, which is the point.

**Repair primitives get a second caller.** [ADR 0018](0018-prose-grounding.md)
(prose grounding) reuses this ADR's repair machinery from outside the pass itself:
`REPAIRABLE_DIGEST_FIELDS` gains `grounded_claims` so a `prose_grounding_mismatch` finding from
the state-update validator can repair via the same locate-and-swap primitive §5 built for
`imagery_swap`, and `told_ledger_miscalibration` gains a second detection path
(`reanchor_underreport`, checking the new `reanchor_used[].anchor_text` field for internal
consistency) that reuses the existing `opening_rewrite` shape. Both go through
`checkRepairAuthority` unchanged. Neither adds a fourth mode or reopens decision 1's three-mode
scope — ownership of *deciding* something is wrong stays where ADR 0002 put it (amnesia with the
state-update validator, told-ledger miscalibration with this pass); only the repair mechanics are
shared, the same way any two callers of the same function share it.

**Findings that repair the same words are repaired in one call.** Decision 5's two shapes are per
*mode*; the implementation read that as per *finding*, so a scene with three `opening_rewrite`
findings spent three calls each rewriting what the last one produced, each handed a `detail`
describing an opening that no longer existed. Only the last survived, and the earlier seams were
reported repaired without being. Every `opening_rewrite` finding on a scene now goes into one call
that states all of them; `imagery_swap` stays one call per finding, since each names a distinct
phrase in a distinct place — which is why decision 5 kept two shapes rather than one. Decision 7's
per-scene bound is unchanged and is the reason this matters: a bound that scales with findings that
all touch one paragraph is not a bound.
