# First measured read-time run

[ADR 0014](../adr/0014-read-time-run-loop.md)'s own consequences leave the map's fog item —
*"cost and latency envelope per read at novel scale"* — open for a **measured** figure once the
loop is actually built and run. This is that measurement, taken on the first live run of the
loop, and it is a floor rather than a verdict: one run, one story, one afternoon's capacity.

## What was run

`npm run telling -- cinderella --verbose` against a live `GEMINI_API_KEY`, 10 September 2026.
The Cinderella fixture, `package_version` 1, 14 scenes, digest window 4.

Two conditions shaped every number below and must be read alongside them:

1. **`gemini-3.7-flash` was unavailable for the whole run.** Every writer call fell back to
   `gemini-3.6-flash` (ADR 0012's capacity fallback, `model_fallback` logged on all 7 scenes).
   Nothing here measures the intended writer model.
2. **The run ended at scene 8 on a free-tier daily quota** — `429 RESOURCE_EXHAUSTED`,
   20 requests/day/model. That is the systemic-outage path (ADR 0014 §7), not a compiler bug:
   the run halted, the manifest closed as `failed`, and the seven scenes already flushed to Blob
   stood. A full 14-scene live run on the writer models needs a paid tier — see the second run
   below for how it was completed anyway, and `AGENTS.md` for the limits.

## Per scene

| | Measured | Notes |
| --- | --- | --- |
| Wall clock | **27.4 s** mean (16.6 – 36.6 s) | 7 scenes, 192 s total |
| Model calls | **2.0** | every scene took its one bounded retry — see below |
| Prompt tokens | **4,923** | scenes 1–7 of a short story; grows with the digest hierarchy |
| Output tokens | **659** | prose + digest + state updates + diagnostics |
| Thinking tokens | **2,965** | `thinkingLevel: MEDIUM`, billed against the same cap |
| Cached tokens | **0** | see "What this exposes" |

At 27 s/scene a 40-scene novel compiles in roughly 18 minutes unattended, which the
[Workflow shape](vercel-runtime.md) absorbs without trouble — the ceiling is per step, and a step
here is half a minute. `DEFAULT_SCENE_SECONDS` in `src/edition/run-report.ts` is 12 s and is now
known to be optimistic against this model; it is only the estimate shown before a story has run
data of its own, and every completed run replaces it with that story's own rolling average.

## What this exposes

Three findings, none of them the run loop's own, all of them things the run report was built to
make visible:

- **Every writer call hit `MAX_TOKENS` on its first attempt**, and 3 of 7 hit it again on the
  retry and degraded to the conservative digest (ADR 0012 §6). Thinking consumed ~2,965 tokens
  per scene against a budget sized by `maxOutputTokensFor` — 2,334 for a 500-word scene, of which
  `THINKING_RESERVE_FRACTION` reserves 40%. On the fallback model that reserve is not enough.
  This is ADR 0012's territory, not this ticket's, and the numbers to reopen it with are here.
  **Fixed** in #49: the reserve is now a floor sized off these measurements, not a fraction of the
  prose budget.
- **Cached tokens were zero on all 14 calls.** ADR 0008's payload ordering exists to make the
  explicit-cache header and the implicit-cache digest prefix pay off, and on this run neither
  did. **Answered** in #50 — see "Why nothing cached", below: the ordering is right and the
  prefix is simply below the model's 4,096-token minimum. Worth its own look: it may be the fallback model, the prompt size, or the ordering not
  doing what it was designed to do — which is exactly the failure the research's constraint 8
  says is invisible in the prose and only visible in this number.
- **The run was correctly marked `degraded`** (3 of 7 scenes, past ADR 0014 §7's 20%) and is
  therefore not promotable to Baked, which is the intended outcome for an edition compiled by a
  model that was cut off mid-sentence three times.

## Second run: the same loop, after the budget fix (#49)

The first run's finding was acted on the same day: the thinking reserve became a measured floor
rather than a fraction of the prose budget. The second run also switched writer model, because a
free-tier key allows 20 requests/day on the writer models and the first run had spent them —
`gemini-3.5-flash-lite` carries a far larger daily allowance and writes worse prose, which is the
right trade for proving a loop and the wrong one for judging what it wrote.

`npm run telling -- cinderella --model gemini-3.5-flash-lite`:

| | First run (3.6-flash, old cap) | Second run (flash-lite, floored cap) |
| --- | --- | --- |
| Scenes completed | 7 of 14, then a `429` | **14 of 14, `complete`** |
| Calls per scene | 2.0 — every first attempt cut off | **1.14** |
| First-attempt `MAX_TOKENS` | 7 of 7 | **1 of 14**, recovered by the digest fallback |
| Degraded scenes | 3 (run marked `degraded`) | **0** (run promotable) |
| Wall clock per scene | 27.4 s | 10.2 s (142 s for the whole telling) |
| Thinking tokens per scene | 2,965 | 1,772 |
| Cached tokens | 0 | **0** |

The two variables moved together, so the table is not a controlled comparison of the cap alone —
but the mechanism is not in doubt: the first run was cut off on every first attempt at caps of
934–1,867 tokens while spending 897–2,014 thinking tokens, and the second spent 1,587–2,030
thinking tokens under caps of 3,560–4,120 and was cut off once.

Three things this run establishes that the first could not:

- **A full Compiled edition exists, generated live, end to end** — 14 scenes in order, flushed
  scene by scene, `complete`, not `degraded`, and therefore promotable to Baked.
- **The continuity pass fires on real prose.** Scene 14 reached for `hearth ash and cinders` where
  an earlier scene had already used `dull grey hearth ash`; the pass caught the collision by
  domain tag, swapped the phrase, and logged `continuity_seam_repaired`. The domain survived the
  repair, which is the whole point of ADR 0010's design — the motif is licensed, the wording is
  what had gone stale.
- **Zero cached tokens is not the fallback model's doing** (#50). Two models, 30 calls, no cache
  hit at all. Explanation (4) on that issue can be struck.

## Why nothing cached (#50)

Both runs returned `cachedContentTokenCount: 0` on every call — 30 calls, two models. Caching is a
**prefix** match (`gemini-capabilities.md` §2), so there are exactly two ways to lose it, and
`npm run cache-check` asks both against a story without spending a generate call.

**The ordering is fine.** Across both fixtures, every scene's cacheable prefix — the explicit-cache
header, then the append-only digest hierarchy — is intact at the head of the next scene's prompt,
except at a rollup, where a closed window replaces N Scene Digests with one and rewrites the middle
of the payload. ADR 0008 already calls that a cache-invalidating event and budgets one expensive
scene per closed window; on Cinderella it lands on scenes 5, 9 and 13, exactly a window apart.
`tests/cache-prefix.test.ts` now holds that property, so a future reordering that quietly moves a
World Model row up the payload fails a test instead of costing 85% of a novel-scale read.

**The prefix is too small, and no amount of ordering fixes that.** Gemini 3.x caches nothing below
**4,096 tokens**, implicitly or explicitly. Measured with `countTokens` on `gemini-3.7-flash`:

| | Cinderella, 14 scenes |
| --- | --- |
| Whole prompt | 1,812 → 3,794 tokens |
| Widest shared prefix | **1,943 tokens** |
| Minimum for any cache hit | 4,096 |

So the first cache hit this project sees will not be on a short story. The shared prefix does grow
as the telling accumulates — its post-rollup floor rose 969 → 1,264 → 1,536 across Cinderella's
three windows — and extrapolating that ~270 tokens per closed window, a story crosses 4,096
somewhere around its fiftieth scene. Which is the same thing the research's §2 cost model already
implies: caching is what makes *novel* scale affordable ($4.41 vs $28.71 per read), and at POC
scale it was never going to be the thing that mattered.

Two consequences worth stating plainly, because they are easy to get wrong later:

- **Explicit caching would not help today.** The 4,096-token minimum applies to
  `cachedContents.create` too, and the header alone is ~970 tokens. Building explicit caching now
  would add a resource to create, patch and expire in exchange for nothing measurable. The time to
  build it is when `cache-check` reports a prefix over the minimum — the research already prefers
  it to implicit caching there, since *"cache hits aren't guaranteed"* and an unattended read-time
  compile should not have a 40× cost variance depending on the weather.
- **`countTokens` is free of the generate quota.** It is a separate endpoint that generates
  nothing, and it answered normally on a key whose `generateContent` allowance for the day was
  entirely spent. It is the right tool for any question about prompt size, and the only honest one
  for a question about a threshold measured in real tokens.

## What is not measured here

Cost in money (the run report deliberately carries tokens, not dollars — ADR 0014 §5), novel-scale
prompt growth, cache behaviour under a warm explicit cache, and anything at all about
`gemini-3.7-flash`. The fog item stays open for those; it is narrower now than it was.
