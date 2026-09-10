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
   stood. A full 14-scene live run needs a paid tier.

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
- **Cached tokens were zero on all 14 calls.** ADR 0008's payload ordering exists to make the
  explicit-cache header and the implicit-cache digest prefix pay off, and on this run neither
  did. Worth its own look: it may be the fallback model, the prompt size, or the ordering not
  doing what it was designed to do — which is exactly the failure the research's constraint 8
  says is invisible in the prose and only visible in this number.
- **The run was correctly marked `degraded`** (3 of 7 scenes, past ADR 0014 §7's 20%) and is
  therefore not promotable to Baked, which is the intended outcome for an edition compiled by a
  model that was cut off mid-sentence three times.

## What is not measured here

Cost in money (the run report deliberately carries tokens, not dollars — ADR 0014 §5), novel-scale
prompt growth, cache behaviour under a warm explicit cache, and anything at all about
`gemini-3.7-flash`. The fog item stays open for those; it is narrower now than it was.
