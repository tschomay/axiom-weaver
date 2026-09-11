# ADR 0018: Prose grounding — checking generated prose against World Model state

## Status

Accepted — settled in [Generated prose is never checked against World Model state or the
told-ledger](https://github.com/tschomay/axiom-weaver/issues/101).

## Context

Every guardrail this project has — the state-update validator (ADR 0005), the re-anchoring
policy's `reanchor_used` self-report (ADR 0009 §8), the continuity pass (ADR 0011) — verifies
*structured, self-reported side-channels* against each other or against authored Scene Card text.
Nothing verified the actual prose sentences a reader reads against the World Model or the
told-ledger. Issue #101 found two live instances: a tracked location re-established from scratch
one scene after it was first established (nothing about it changed), and a physical-state
contradiction — prose describing an object as being where it no longer is, carried forward as a
fixed descriptive tag rather than regenerated from current World Model state. Neither produced a
diagnostic, because nothing was looking.

Two things this ADR is careful not to be:

- **Not a new call.** ADR 0003 §3 already settled that digest emission never gets its own call —
  it rides the one structured response the writer already produces. A verification mechanism that
  needed a second per-scene call would be exactly the "whole day's writer budget" cost `AGENTS.md`
  warns about, for every story regardless of length, and would need re-litigating that decision.
- **Not a reopening of "digest-only, never full prose."** `CONTEXT.md`'s continuity pass
  constraint is about not re-reading *past* scenes' prose — prose isn't part of what circulates in
  long-range context, digests are. It has never meant the *current* scene's own prose, still in
  memory in the same response that produced it, is off-limits to same-scene checks. Both checks
  below stay inside "the mechanism reads structured fields it already has, never text search over
  arbitrary stored prose."

## Decision

### 1. Two extraction fields, both piggybacked on the existing writer call

Both are new Scene Digest fields (ADR 0003 §2), emitted in the same structured response as
`prose`, `state_updates`, and the rest of the digest — no second call, per ADR 0003 §3.

- **`grounded_claims: {entity_id, column, asserted_value}[]`** — the physical/epistemic-tier
  claims the prose makes about entities present in the scene (ADR 0008 §4's existing "present"
  join — no new join). Naturally sparse (most scenes don't restate old facts about most on-stage
  entities), so uncapped like the digest's other sparse list fields (ADR 0003 §5).
- **`reanchor_used[].anchor_text: string | null`** — extends the existing `reanchor_used` entry
  (ADR 0009 §8) with a short extract of the actual clause the writer used to place that entity;
  `null` when the band is `assume` (nothing was written to anchor it). Capped at roughly a
  clause's length, in the same spirit as ADR 0009 §6's craft rule ("a distinguishing clause, not a
  re-explanation") and enforced the same way `TWO_SENTENCE_CHARS`/`trimToCap` already enforce the
  digest's other length budgets — trimmed, never rejected.

Scope is deliberately narrow: `grounded_claims` only covers entities the told-ledger already
tracks a row for, not every entity on stage. Both pieces of evidence in issue #101 are about
tracked entities (a World Model location, a World Model object); there's no case in hand for the
wider, more expensive scope, and it can be widened later without a schema break if one shows up.

### 2. `grounded_claims` is checked exactly like `unentailed_reversion` — same test, new input

ADR 0005 §2's `unentailed_reversion` rule already exists: a value is rejected if it changes a
column away from its currently committed value and that new value appears nowhere in
`entry_state`, `exit_state`, or `required_beats`. This decision runs the identical test over
`grounded_claims` instead of `state_updates` — no new rule, the same predicate against a second
input. Unlike `state_updates`, `grounded_claims` is never committed and there is nothing to accept
or reject: it's a read-out of what the prose already asserts, not a proposed write. A mismatch
can't fall back to "keep the World Model's pre-scene value" the way `unentailed_reversion` does
(the World Model was never wrong — only the prose reads as if it disagrees with it), so this is a
new diagnostic, `prose_grounding_mismatch`, checked at the same post-generation checkpoint ADR
0005 §1 already runs `state_updates` through, and repaired rather than rejected (see decision 4).

### 3. `anchor_text` is checked as an internal-consistency length test, not against the prose

`bandMismatches` (already implemented, `src/assembler/reanchoring.ts` via
`continuity-pass.ts`'s `told_ledger_miscalibration` mode) already catches a self-reported band
that disagrees with what the *re-anchoring policy* expected. It cannot catch a self-reported band
that disagrees with what the writer *actually wrote*, because nothing about that check reads what
was written — the exact gap issue #101 evidence 1 exploits. This decision closes that specific
gap: a light band (`assume`/`reanchor`) claimed alongside an `anchor_text` long enough to have been
truncated (hit the cap from decision 1) is inconsistent on its face — a light re-anchor is
supposed to produce a clause, not something that needs trimming. New diagnostic
`reanchor_underreport`.

This is a heuristic on internal consistency (does the claimed band match the reported length of
what was claimed to have been written), not independent proof `anchor_text` truly reflects the
prose word-for-word — the same honestly-scoped limitation `isEntailedByCard`
(`state-update-authority.ts`) already documents for its own phrase-matching heuristic. Verifying
`anchor_text` against the prose itself (e.g. via the same `tokens()`/`containsPhrase()` primitive
`isEntailedByCard` already uses) is a strictly stronger check and stays available as a later
tightening, not required to close the gap this ADR is scoped to.

### 4. Repair reuses the continuity pass's existing repair primitives — no new call shape

- **`prose_grounding_mismatch`** repairs via the same locate-and-swap primitive ADR 0011 §5 built
  for `imagery_swap` (locate and swap just the offending phrase/clause in the stored prose) — a
  second caller of that primitive, not a new shape. `REPAIRABLE_DIGEST_FIELDS`
  (`continuity-pass.ts`) gains `grounded_claims`, so a repair may also correct the corresponding
  claim entry (otherwise it goes stale against the prose it was extracted from) — the same
  "fields a seam fix can legitimately touch" reasoning ADR 0011 §4 already uses, extended by one
  field for the same reason `reanchor_used` is already on that list.
- **`reanchor_underreport`** repairs via the existing `opening_rewrite` shape — already the shape
  `told_ledger_miscalibration` uses (`shapeFor`, `continuity-pass.ts`), and both evidence cases in
  issue #101 are opening-beat placements, consistent with ADR 0011 §5 already grouping cold-opens
  and told-ledger miscalibration under one shape.

Both findings go through `checkRepairAuthority` unchanged (ADR 0011 §4's byte-for-byte guard on
every non-repairable field), including from their new callers — the guard is a function, not a
comment scoped to the continuity pass's own call sites, and ADR 0011 §4's own reasoning already
anticipated a caller other than the pass's narrow repair calls.

**Ownership stays where ADR 0002 put it.** `grounded_claims` checking lives in the state-update
validator (ADR 0002 already assigned amnesia there, on the grounds that it's a World Model
contradiction, not a Discourse Record continuity problem) and dispatches into the continuity
pass's repair machinery as a shared utility — it does not make amnesia a fourth continuity-pass
*mode*, and does not reopen ADR 0011 §1's three-mode scope. `anchor_text` checking is a new
finding inside the *existing* `told_ledger_miscalibration` mode (a second way that mode can fire,
alongside the already-implemented `bandMismatches` and `facts_revealed` checks in
`detectSeams`), not a new mode either.

### 5. Severity: repair, never block — same reasoning as every existing mode

Read-time generation is batch and unattended (ADR 0011 §2's premise): prose has already been
generated by the time either check runs, so there is no "block the writer" option, only "repair
the persisted edition before any reader sees it" — identical to the three existing continuity-pass
modes, and to `required_beats`' "self-reported, one bounded retry then accept-and-log" trust level
(ADR 0006). Author-time, both run with the same full inspect-and-repair authority ADR 0011 §2
already grants the existing three modes — there's no separate author-time design needed, it's the
same dual invocation. Cascade handling (a repair invalidating downstream scenes) reuses ADR 0011
§6's existing staleness mechanism unchanged — these are two more findings a repair can produce,
not a new kind of downstream effect.

### 6. Cost: no new ceiling, because there's no new call to bound

Extraction costs a few dozen extra output tokens on a call that already runs once per scene, for
every story regardless of length — not a budget line. The checks themselves are pure code (the
same `unentailed_reversion` predicate, a length comparison), zero model cost, zero marginal cost
for a longer story beyond the linear-in-scene-count cost every other per-scene mechanism already
has. Repair calls are the only marginal spend, and they're bounded exactly like ADR 0011 §7
already bounds the existing three modes: a few small, targeted calls per scene, never a full-scene
regeneration, no global ceiling because there's no cost problem to solve — the same statement ADR
0011 §7 already made, unchanged by adding two more finding types that produce the same kind of
bounded repair call.

## Consequences

- `docs/adr/0003-scene-digest-and-told-ledger.md` gains an addendum: the digest field set extends
  with `grounded_claims`, and `reanchor_used` entries extend with `anchor_text`.
- `docs/adr/0005-state-update-authority.md` gains an addendum: §2's `unentailed_reversion` test
  now also runs over `grounded_claims`, surfacing `prose_grounding_mismatch` instead of falling
  back to the World Model's pre-scene value (there is nothing to fall back from).
- `docs/adr/0009-reanchoring-policy.md` gains an addendum: §8's "self-reported and not
  independently re-verified against the prose" caveat is partially closed — verified for internal
  consistency against `anchor_text`, still not verified word-for-word against the prose itself.
- `docs/adr/0011-continuity-pass-over-digests.md` gains an addendum: `REPAIRABLE_DIGEST_FIELDS`
  gains `grounded_claims`; `told_ledger_miscalibration` gains a second detection path
  (`reanchor_underreport`) alongside its existing `bandMismatches`/`facts_revealed` checks, still
  one mode, still `opening_rewrite`.
- `CONTEXT.md`'s seam-failure rubric table: the **Amnesia** row's "Digest-detectable?" cell
  changes from "No" to "Partially" — detectable when the writer surfaces a claim in
  `grounded_claims`, not detectable for a contradiction the extraction step misses entirely (the
  extraction is itself a model call, not exhaustive prose parsing). Mechanism owner gains
  `prose_grounding_mismatch` alongside `unentailed_reversion`, same owner (state-update
  validator), not a new row. The **Told-ledger miscalibration** row's answer is unchanged ("Yes"),
  since only the reliability behind that "Yes" improves, not the digest-detectability verdict
  itself.
- The writer prompt contract (ADR 0012, `response-schema.ts` / `scene-digest.ts`) needs
  `grounded_claims` and `reanchor_used[].anchor_text` added to the output schema, with the same
  `propertyOrdering`/caps discipline the rest of the schema already follows.
- `state-update-authority.ts` needs the `grounded_claims` checkpoint (decision 2), reusing
  `isEntailedByCard`'s existing `StateValue`/`WorldModel` shapes rather than inventing new ones.
- `continuity-pass.ts` needs `reanchor_underreport` added to `CONTINUITY_MODES`/`detectSeams`
  (decision 3), `grounded_claims` added to `REPAIRABLE_DIGEST_FIELDS` (decision 4), and a
  `prose_grounding_mismatch`-shaped call path from the validator into the existing `imagery_swap`
  repair primitive.
- No change to the read-time run loop's (#19) invocation shape: both new findings ride the
  existing per-scene continuity-pass invocation and the existing post-generation validator
  checkpoint — there's no new pipeline stage to wire in.
