# ADR 0020: No trigger term for `pays_off` — a span warning instead

## Status

Accepted — settled under [issue #124](https://github.com/tschomay/axiom-weaver/issues/124), using
evidence gathered by [#119](https://github.com/tschomay/axiom-weaver/issues/119) and
[#120](https://github.com/tschomay/axiom-weaver/issues/120), both now merged.

## Context

A `pays_off` entry is two-place: `{fact_ref, plant: scene_id | null}` (ADR 0004). It encodes
*ordering* — the plant scene precedes the payoff — but nothing about *why* the payoff lands where
it does rather than any later scene. #124 asked whether that gap needs a third element, a
**trigger**, naming the enabling condition that makes a payoff earned rather than merely linked.
Two things made this more than a hypothetical: `docs/agents/story-authoring-eval.md` §4.2 already
judges "earned vs. linked only" because the linter can't tell the difference, and CFPG
(arXiv:2601.07033, verified in #126) reports the best backbone lands payoff timing correctly only
~70% of the time without external structure, erring early — evidence that a pipeline can produce a
payoff that lints clean while landing nowhere near where it should.

#124 named one question to close before anything else: does `entry_state` already cover this?
Checked directly against `src/schema/story-package.ts` and both fixtures' actual JSON —
`entry_state`/`exit_state` are strictly `{entity_id: {column: value}}`, per-entity column
assertions. They cannot represent "this event has happened," which is what a trigger condition
is. Confirmed: no, it doesn't cover this.

#124 also asked to wait for evidence from #119 before deciding. That evidence, now in hand:

- **#119** cross-cut judged payoff earned-ness against plant-payoff span across 83 judged pairs
  on 9 generated arcs (one model, `gemini-3.8-flash`, as both generator and judge). Unearned
  payoffs concentrate almost entirely in two places: seed-grounded edges (`plant: null`) and
  short-span edges. Once a payoff's plant is 4+ events back, the judge calls it earned 97% of the
  time (45/46).
- **#120** found #119's span numbers were measured at the wrong layer — the pre-segmentation
  one-event-per-scene projection, not real segmented scenes — and at the real scene layer,
  span-1 share rises from 0.00 to as much as 0.29 on the same arcs. The correlation between short
  span and unearned-ness gets *stronger*, not weaker, once measured correctly.
- **#120** separately found and fixed a different problem: extraction and generation name the
  same fact with independently-chosen slugs, so a naive fact-identity check between them silently
  produced duplicate `pays_off` edges. A trigger term would not have caught this — it's a naming
  collision, not a missing causal link — which matters here only as a boundary on what a trigger
  term would and wouldn't buy.

One more piece of context: #119's own generator design (`src/arc/brief.ts`) deliberately treats
span as prompt *guidance*, never a generation-time gate, reasoning that "enforcing a span floor
mechanically would guarantee the metric's number without changing the arc, which is scoring our
own homework." That objection is about a generator optimizing against its own quality metric. It
does not apply to a *linter* surfacing a short-span payoff as something worth a second look —
that's a different use of the same signal, aimed at a human or a judge, not at the generator.

## Decision

1. **No schema field.** `pays_off` stays `{fact_ref, plant: scene_id | null}`. The evidence is
   real but bounded — n=83 pairs, one model as both generator and judge, correlational rather
   than a guarantee — and it's evidence *for* a cheap proxy, not for the cost a real field would
   carry: ADR 0004's walk and `src/authoring/lint.ts` would both need new validation, and both
   existing fixtures would need backfilling before either could lint clean again. That cost isn't
   justified by what's actually known yet.

2. **A new lint warning instead: `short_range_payoff`.** `src/authoring/lint.ts`'s `warnings()`
   gains a check alongside `unpaid_fact`: for every `pays_off` entry with a non-null `plant`,
   compute the scene-order distance between the plant scene and the payoff scene. A distance of
   1 (adjacent scenes) or 0 (same scene) warns. This is the zone #119/#120's evidence says is
   almost never earned and is cheap to flag from fields the schema already has — no backfill, no
   new author-facing field, nothing to get wrong filling it in.

3. **Warning, never a gate, and never fed back into generation as a constraint.** Same severity
   reasoning as every other check in `lint.ts`: an author or a judge is allowed to disagree with
   it (a same-scene plant/payoff can be exactly right for a fast reveal), but it's worth surfacing.
   It is explicitly not to be wired into `src/arc`'s generation loop as a mechanical floor — doing
   that would reproduce the "scoring our own homework" problem #119 already identified and
   rejected for the identical signal.

4. **Revisit, don't re-litigate, if the evidence changes.** The threshold (span ≤ 1) and the
   decision not to add a field both rest on one model's output judged by itself. If a different
   generator, a different judge, or a larger sample shows the correlation is weaker than measured
   here, that's grounds to revisit — starting from this ADR's evidence, not from scratch.

## Consequences

- `docs/agents/story-authoring-eval.md` §4.1's plant-span histogram remains the primary instrument
  for "valid but inert" arcs; this warning is a package-level, always-on check derived from the
  same idea, not a replacement for that judged metric.
- #124 is resolved without a schema change — closing it does not block #118's or #120's already-
  shipped work, which used the two-place shape throughout.
- If a future ticket does find a need for real causal representation (not just a proxy), it starts
  from a stronger position: two data points on the span/earned-ness correlation, a known-bounded
  sample, and threshold. Not a blank page.
