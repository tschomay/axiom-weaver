# ADR 0002: Seam-failure rubric and mechanism ownership split

## Status

Accepted — settled in [The seam-failure rubric](https://github.com/tschomay/axiom-weaver/issues/3).

## Context

The map's acceptance test requires every "reads like separately generated scenes" failure
mode to pair with a mechanism, or be consciously accepted as unaddressed. Before any of
the mechanism tickets (state-update authority #9, the continuity pass #15, repetition and
voice-drift control #14, the writer prompt contract #16) could be scoped precisely, the
rubric itself had to be named and each mode assigned an owner.

The central finding: Scene Digests abstract *content* (events, facts revealed, plants,
emotional register, imagery signature, closing situation) — never prose style or dialogue
craft. The continuity pass (`CONTEXT.md`, Continuity pass) is constitutionally restricted
to operating on digests, never full prose. That constraint, applied to each candidate
failure mode, is what determines whether the continuity pass can own it at all.

## Decision

1. **Eight named failure modes**, replacing the ticket's original eight candidates:
   "re-introduction" and "over-recap" merge into **told-ledger miscalibration** (one root
   cause — a told-ledger read error — in two directions); **character-voice
   homogenization** is added as a ninth candidate that survives as a named mode; the
   remaining five (stale imagery, voice drift, cold opens/hard resets, dropped setup,
   amnesia, uniform beat shape) survive with voice drift explicitly rescoped to the
   *narrator's* register now that character-voice homogenization exists as a separate
   mode.
2. **Mechanism ownership splits three ways**, not one:
   - **Continuity pass (#15)**: cold opens/hard resets, told-ledger miscalibration, stale
     imagery, dropped setup — all digest-detectable.
   - **State-update validator (#9)**: amnesia. It is a World Model contradiction, not a
     Discourse Record continuity problem, so it does not belong on the continuity pass
     even though it is arguably the most severe mode.
   - **Generation-time only, via the Voice Card (#16, #14)**: voice drift and
     character-voice homogenization. Neither is digest-detectable, so neither can be
     verified after generation — only constrained at prompt-construction time. No
     post-hoc mechanism catches a drift that already happened.
3. **Uniform beat shape is consciously accepted as unaddressed for v1.** Weakest reader
   detectability (cumulative, rarely visible scene-to-scene) and no digest field
   represents it. Named in the rubric so it isn't silently forgotten; revisit only if it
   proves visible at novel scale.
4. **A per-character dialogue signature (digest field) is deferred, not adopted.** It
   would make character-voice homogenization digest-detectable, symmetric with imagery
   signature for stale imagery. Speculative until generation-time Voice Card constraint is
   shown insufficient in practice — recorded in `CONTEXT.md`'s Not yet specified fog, not
   built now.

## Consequences

- Ticket #15 (continuity pass) is scoped to exactly four failure modes, not "seams" in
  general — it should not be asked to catch amnesia, voice drift, or character-voice
  homogenization.
- Ticket #9 (state-update authority) picks up amnesia detection as part of its validator,
  in addition to its existing physical/epistemic/volitional write-authority question.
- Tickets #14 (repetition and voice-drift control) and #16 (the writer prompt contract)
  must treat voice drift and character-voice homogenization as generation-time-only
  concerns — no verification step exists for them, so the Voice Card constraint has to
  carry the full weight alone.
- Uniform beat shape gets no ticket. If it resurfaces as a real problem at novel scale,
  that is new fog, not a reopening of this decision.
