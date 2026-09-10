# ADR 0012: The writer prompt contract

## Status

Accepted — settled in [The writer prompt contract](https://github.com/tschomay/axiom-weaver/issues/16),
prototyped on the throwaway branch `prototype/writer-prompt-contract`
([prototype file](https://github.com/tschomay/axiom-weaver/blob/prototype/writer-prompt-contract/prototypes/writer-prompt-contract.prototype.html)).

## Context

This is the ticket where the map's separate threads meet: assembled context ([ADR
0008](0008-zoom-level-context-assembler.md)), plant obligations ([ADR
0004](0004-plant-obligation-walk.md)), re-anchoring ([ADR
0009](0009-reanchoring-policy.md)), the imagery ledger ([ADR
0010](0010-repetition-and-voice-drift-control.md)), the Voice Card ([ADR
0007](0007-voice-card-and-style-presets.md)), the variance dial ([ADR
0006](0006-variance-contract.md)), and state-update tiering ([ADR
0005](0005-state-update-authority.md)) all arrive in one prompt, and one structured
response has to carry prose, digest, state updates, and diagnostics back out.
[Gemini capabilities](https://github.com/tschomay/axiom-weaver/issues/5)
(`docs/research/gemini-capabilities.md`) had already fixed several load-bearing
constraints this ticket had to build inside: `responseJsonSchema` over the
deprecated `responseSchema`, `propertyOrdering` pinned to `prose` first, no tools
in the writer call, and — critically — that `MAX_TOKENS` under a schema returns
truncated, unparseable JSON with no partial-object recovery, making a
digest-only fallback call "a required component, not an optimisation."

## Decision

1. **Output schema.** `prose → scene_digest → state_updates → diagnostics`, in that
   `propertyOrdering`, using `responseJsonSchema` with `$defs`/`$ref`. `scene_digest`
   is exactly ADR 0003/0009/0010's field set (`event_summary`, `entities_on_stage`,
   `facts_revealed`, `plants_opened`, `payoffs_closed`, `imagery_signature` as
   `{image, domain}` capped at 3, `closing_situation`, `reanchor_used`) — no new
   digest field. `state_updates` is `{updates: {entity_id, column, value}[],
   new_relationships: [...], new_character_knowledge: [...]}`: the writer proposes
   values only, never a tier — tier is looked up from the column name at validation
   time (ADR 0001/0005), so asking the writer to reason about it would be redundant
   schema weight. `diagnostics` carries exactly two writer-facing types,
   `beat_unsatisfied` and `missing_fact` — every other diagnostic named in
   `CONTEXT.md` (`exit_state_contradiction`, `unauthorized_entity_update`,
   `unentailed_reversion`, `entry_state_mismatch`, dropped-plant misses,
   `must_stay_hidden` leaks) is the compiler grading the writer's other outputs
   *after* the call returns, not a self-report — see the full taxonomy in the
   prototype's tab 5. The schema stays deliberately lean: it is billed as input on
   every call and cannot be cached (research finding #4), so every field earns its
   place the same way ADR 0003's digest fields did.

2. **Instruction layering resolves a real seam between three ADRs.** ADR 0007 and
   ADR 0010 both describe the imagery ledger as rendered "after the Voice Card
   block, before the scene's tone instruction" — but ADR 0008 places the Voice Card
   in the explicit-cache header and `tone` (a Scene Card field) in the volatile
   tail, so those two placements can't be textually adjacent across a cache
   boundary. Resolved by treating "after Voice Card, before tone" as describing the
   volatile tail's *own* internal order: the ledger (which mutates every scene, so
   cannot live in the cached header regardless of what ADR 0007/0010 say) renders
   inside the tail, immediately before the Scene Card's `tone` line. Full assembled
   payload order, coarsest to most volatile:

   - **Explicit-cache header** (`systemInstruction`, created once per read): writer
     contract prose (role, output order, state-update tiering rules in plain
     language, `must_stay_hidden` emphasized as absolute since prose streams before
     it's checkable, diagnostics usage, length framing), the Voice Card rendered
     per ADR 0007 §3, the World Model column/tier legend (columns and their tier,
     not row data).
   - **Implicit-cache digest hierarchy** (ADR 0008 §1/§3): Book → Part → Chapter →
     open Scene Digests, oldest first, append-only.
   - **Uncached verbatim tail**: the final paragraph of the previous scene's actual
     prose (ADR 0008 §3).
   - **Uncached volatile tail**, this ticket's own internal ordering: Scene Card
     core fields → this scene's `pays_off` obligations rendered as a **payoff-side
     instruction** ("this scene resolves: `<fact>` — report it in
     `payoffs_closed`") → the re-anchoring annotated list (ADR 0009 §4) → the
     imagery ledger block (ADR 0010 §5) → the Scene Card's `tone` line → filtered
     World Model rows (ADR 0008 §4) → the told-ledger slice (ADR 0009 §5).

3. **A payoff-side instruction is a new, symmetric addition ADR 0004 didn't
   specify.** ADR 0004 templated only the *plant*-side instruction ("make the
   reader register `<fact>` without dwelling on it"), given to the scene that owes
   the plant. The scene that *pays off* a fact needs its own instruction — not to
   invent the resolution (the required beats usually already narrate it), but to
   tell the writer which `fact_ref` to report in `payoffs_closed` so the compiler's
   post-hoc plant-obligation check has something to verify against.

4. **Length control is a soft target with an asymmetric tolerance band**, not a
   hard constraint: "aim for approximately `length_budget` words; a little over is
   fine if the beats need room, well under is a sign a beat got cut." Asymmetric
   because undershoot usually means a dropped beat (a variance-contract miss),
   while overshoot only costs output budget. `maxOutputTokens` is set to roughly
   2× the length budget in tokens (research recommendation), sized to cover prose
   *and* the digest/state_updates/diagnostics tail that follows it in the same
   response. The prototype's hand-written scene landed at 390 words against a
   450-word budget (87%, inside an 0.8–1.3× band) — evidence the framing produces a
   reasonable result, not proof at scale (a single hand-written sample can't be).

5. **Truncation salvage is two moves, matched to how much of `prose` survived.**
   `MAX_TOKENS` under `propertyOrdering: prose first` most often cuts the
   digest/state_updates/diagnostics tail after prose has already completed and
   already streamed to the reader. When `prose`'s closing quote is present in the
   truncated buffer (recoverable via the same incremental JSON-string parser the
   streaming reader already needs — research §3 confirmed partial JSON chunks
   concatenate cleanly), the compiler runs a **digest-only fallback call**
   (`gemini-3.5-flash-lite`, `thinking_level: LOW`, schema narrowed to
   `{scene_digest, state_updates}`, diagnostics dropped since the writer never
   finished the call the diagnostics would have come from) over the recovered
   prose plus the Scene Card's fact-relevant fields. Logged `truncated_scene` at
   `info` once recovered. When `prose` itself is cut mid-clause, the *whole* scene
   is retried once with `maxOutputTokens` raised ~50% and a one-line concision
   instruction added — the same "one bounded retry, then accept-and-log" shape
   every prior ADR on this map already uses (ADR 0004/0005/0006), applied here to
   a new failure class rather than inventing a new policy.

6. **Other finish reasons get the same one-retry-then-fallback shape, each with a
   reason-specific retry instruction.** `MALFORMED_RESPONSE` retries the identical
   prompt once (often non-reproducible). `RECITATION` retries once with a
   paraphrase instruction, then hands off to [issue #17](https://github.com/tschomay/axiom-weaver/issues/17)
   (which owns detection/measurement for the famous-prose fixture) rather than
   this ticket owning mitigation policy. `SAFETY`/`PROHIBITED_CONTENT`/`BLOCKLIST`/`SPII`
   retries once with a fiction-framing reminder. Any failure surviving its one
   retry becomes `scene_generation_failed`: whatever prose exists is committed (a
   stub only in the total-failure case), the digest is built conservatively —
   empty `facts_revealed`/`plants_opened`/`payoffs_closed` rather than inventing
   that something happened, `closing_situation` copied forward with a note — logged
   at `error`, and the run continues.

7. **Diagnostics taxonomy, consolidated.** The full writer-vs-compiler split (item
   1) is written out as a single table in the prototype's tab 5, collecting
   diagnostic types that had previously been scattered one-per-ADR
   (`entry_state_mismatch`/ADR 0005, `plant_obligation_missed`/ADR 0004,
   `must_stay_hidden_violation`/ADR 0006) alongside this ticket's own call-level
   types (`truncated_scene`, `scene_generation_failed`, `recitation_flagged`,
   `content_filtered`) into the one place a reader would look for "what can this
   compiler log."

## What the prototype showed

Built against Cinderella's `scene_13_the_fitting` — chosen because it lands
immediately after a digest-hierarchy rollup (window `W=4`, ADR 0008), so the
cached prefix is exactly three Chapter Digests rather than a longer, messier mix;
it carries a live plant-payoff obligation (`cinderella_kept_second_slipper`,
planted at scene 11); and its re-anchoring bands span both `assume` (Cinderella,
the gentleman-in-waiting) and `reanchor` (both stepsisters, at exactly 4
scenes-since-touch) in the same scene. The full assembled prompt, the hand-written
generated response, and a beat-by-beat/invariant-by-invariant evaluation are all
in the prototype file. Two authoring-fixture gaps surfaced along the way, flagged
for whoever next touches [issue #18](https://github.com/tschomay/axiom-weaver/issues/18)'s
fixtures rather than fixed here (out of this ticket's scope):

- The godmother has an on-page required beat in scene 13 but is not listed in its
  `characters_present`, so ADR 0008's deterministic join never surfaces her World
  Model row. `characters_present` should list every character with an on-page
  beat, not only those whose state changes.
- The fixture's `exit_state` for scene 13 has `char_prince` learning a fact despite
  his absence from `characters_present` — a footprint violation under ADR 0005 §2
  (`unauthorized_entity_update`). A correctly-instructed writer must simply not
  propose that row; the prototype's `state_updates` drops it. The fixture's fix is
  moving the character or the knowledge row.

## Amendment (2026-09-10)

Issue #40 shipped this ADR's fallback path but never ran it against the live endpoint — no
`GEMINI_API_KEY` was available at the time (see PR #46). With a key added to both the dev
environment and Vercel's production environment, the first two real writer calls (Cinderella's
`scene_13_the_fitting` and A Christmas Carol's `scene_08_the_cratchits`) both hit `MAX_TOKENS`
with visible output well under decision 4's "roughly 2x the length budget" figure. Direct probing
of the live endpoint confirmed why: `thinkingConfig.thinkingLevel` reasoning tokens are billed
against the same `maxOutputTokens` cap as prose, not a separate one — a 60-token cap at
`thinking_level: MEDIUM` returned 82 thinking tokens and zero visible output. This split was
already in the Gemini capabilities research's own cost model (~1,200 thinking tokens against
~1,800 prose tokens per scene, §2's quantified-saving table) but decision 4's formula never
carried that ratio into the actual `maxOutputTokens` sent on the wire.

Fixed in `maxOutputTokensFor` (`src/writer/compile-scene.ts`): the prose+tail figure from decision
4 is unchanged, but the total request budget now reserves an additional 40% on top of it for
thinking, matching the research's own ratio and the two live calls observed (35-50% consumed by
thinking). `ModelUsage`/`CallRecord` now also carry `thoughts_tokens`
(`usageMetadata.thoughtsTokenCount`), logged alongside `cached_tokens` for the same reason ADR
0008's own measurement logs cache fraction — a budgeting mistake here is invisible in the prose,
same as a cache-ordering mistake is.

The truncation-salvage path (decision 5) itself is unaffected and worked correctly both times;
this amendment only widens the primary call's budget so salvage is the exception again rather
than the routine case.

A second, separate gap surfaced in the same session: `gemini-3.7-flash` itself returned `503
UNAVAILABLE` ("high demand") for several minutes straight, and `GeminiClient.generate` simply
threw — no retry, no fallback, no `ModelResponse` for `compileScene` to build a conservative
digest from, so the whole compile crashed. This is a gap in the ADR itself, not just the
implementation: decisions 5 and 6 give every *finish-reason* failure the "one bounded retry, then
accept-and-log" shape, but neither considers a *transport-level* failure (the call never
completing at all). Fixed by giving `GeminiClient.generate` the same shape one layer down: retry
the requested model once after a short backoff, then try `gemini-3.6-flash` once — the Gemini
capabilities research's §7 already named it as "a same-price fallback" for a different anticipated
failure (a schema-constrained decode loop), and the same reasoning (different model, different
capacity pool, same price) applies to an availability outage. Only a retryable HTTP status (429,
5xx) triggers this; a 400/401/403 is a real request bug, not capacity, and retrying or swapping
models would only mask it. Live-verified in this session: with `gemini-3.7-flash` still down, the
fallback call to `gemini-3.6-flash` answered but itself hit `MAX_TOKENS` (the thinking-budget gap
above), which triggered `compileScene`'s own existing retry — by then `gemini-3.7-flash` had
recovered, and that retry completed cleanly with `STOP`. Both fixes in this amendment were
exercised together, live, in the one call that produced this paragraph's evidence. Logged as
`model_fallback` (`info`) when it fires, so which model actually wrote a scene is never silently
lost. If every attempt is exhausted (both models down), `generate` still throws — unlike a
finish-reason failure, there is no partial `ModelResponse` to salvage from at that point, so
surfacing it loudly remains more honest than inventing a stub.

## Consequences

- `docs/research/gemini-capabilities.md`'s five headline findings (structured
  output + streaming coexisting, no tools, `propertyOrdering`, schema cost,
  truncation) are all now concretely spent inside a real contract rather than
  standing as open recommendations.
- Unblocks [Regurgitation control on the famous-prose fixture](https://github.com/tschomay/axiom-weaver/issues/17)
  (its other blocker, #4, is already closed) — #17 inherits this ticket's
  `RECITATION` retry hook as its starting point, not a policy to re-derive.
- Unblocks [The read-time run loop](https://github.com/tschomay/axiom-weaver/issues/19)
  jointly with #9 (already closed) — #19 implements the per-scene step this
  contract's one call (plus its truncation/failure paths) slots into.
- Unblocks [Author surfaces that feed the mechanics](https://github.com/tschomay/axiom-weaver/issues/21)
  jointly with #9 (already closed) — the diagnostics taxonomy (item 7) is the
  concrete list of what a compile-diagnostics surface has to render.
- `CONTEXT.md`'s Diagnostics section gains a pointer to this ADR's consolidated
  taxonomy rather than restating it.
