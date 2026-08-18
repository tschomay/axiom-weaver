# Vercel runtime shape for an unattended read-time compile

Research for [#6](https://github.com/tschomay/axiom-weaver/issues/6) (part of [#1](https://github.com/tschomay/axiom-weaver/issues/1)).
Answers gathered 2026-08-18 from Vercel's current documentation.

> **Method note.** `vercel.com` is blocked by this session's egress policy, so pages could not be
> fetched directly. Claims below were gathered through Vercel's own MCP documentation index
> (`search_vercel_documentation`, which returns doc-sourced snippets) and through web search
> restricted to `vercel.com`. Every claim carries the doc URL it came from. Two figures could not
> be extracted and are marked **[unverified]** — check them against the live page before they
> become load-bearing.

---

## Verdict

**The read-time compile is VIABLE on a normal Vercel deployment — but NOT in the shape the map
implicitly assumes.**

The shape that is **dead**: one HTTP request that opens a stream, runs 40 sequential Gemini calls,
and writes prose to the reader for the whole run. Two independent limits kill it:

1. **Function maximum duration.** Hobby is capped at **300 s**, hard. Pro/Enterprise reach **800 s**
   generally available, **1800 s** in beta. Streaming time counts fully against that ceiling —
   there is no separate, longer allowance for streamed responses.
   ([duration](https://vercel.com/docs/functions/configuring-functions/duration),
   [limits](https://vercel.com/docs/functions/limitations))
2. **Client-disconnect cancellation.** When the reader closes the tab, Vercel fires the request's
   `AbortSignal` and **terminates the function**. Any work not wrapped in `waitUntil`/`after` is
   lost — and `waitUntil` is itself bounded by the same function timeout.
   ([per-path request cancellation](https://vercel.com/changelog/node-js-vercel-functions-now-support-per-path-request-cancellation),
   [@vercel/functions](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package))

Limit 2 is the one that matters most, because it contradicts the map's standing constraint that
*read-time compiles are unattended*. In the single-long-response shape the run is not unattended —
it is **owned by the reader's tab** and dies with it.

**The nearest workable alternative is not a workaround — it is a first-class Vercel product:
[Vercel Workflows](https://vercel.com/docs/workflows)**, generally available since 16 April 2026.
It has **no maximum run duration**, allows **10,000 steps per run**, runs each step as an isolated
function invocation inside the normal duration limits, and exposes a **resumable stream** the
reader can disconnect from and reconnect to — with the compile continuing while the tab is closed.
([Workflow pricing and limits](https://vercel.com/docs/workflows/pricing),
[durable execution](https://vercel.com/blog/a-new-programming-model-for-durable-execution))

The architecture therefore does not need re-charting. What needs re-charting is **one sentence**:
a compile run is a *durable workflow keyed by a run ID*, and the reader's connection is a
*subscriber to its stream*, not the thing that drives it.

---

## 1. Execution limits

### 1.1 Maximum duration, Node.js runtime, with Fluid compute (the default)

| Plan | Default | Maximum (GA) | Extended maximum (beta) |
| --- | --- | --- | --- |
| Hobby | 300 s | **300 s** | not available |
| Pro | 300 s | **800 s** | 1800 s |
| Enterprise | 300 s | **800 s** | 1800 s |

Sources: [Configuring Maximum Duration](https://vercel.com/docs/functions/configuring-functions/duration),
[Vercel Functions Limits](https://vercel.com/docs/functions/limitations),
[Higher defaults and limits for Functions running Fluid compute](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute),
[Functions can now run up to 30 minutes](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes).

Beta constraints on the 1800 s tier
([duration](https://vercel.com/docs/functions/configuring-functions/duration),
[changelog](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes)):

- Supported **Node.js and Python** runtimes only.
- Must be set **per function**, in code or `vercel.json`. Project-level defaults above 800 s are
  not supported during the beta.
- **Secure Compute and Static IPs do not support durations above 800 s** during the beta.

How it is set (App Router route handler) — the docs give this exact example
([duration](https://vercel.com/docs/functions/configuring-functions/duration)):

```ts
export const maxDuration = 1800; // This function can run for a maximum of 30 minutes

export async function POST(request: Request) {
  return Response.json({ ok: true });
}
```

or per-path in `vercel.json` ([duration](https://vercel.com/docs/functions/configuring-functions/duration)):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "app/api/**/*": { "maxDuration": 800 }
  }
}
```

On overrun the platform returns **504 `FUNCTION_INVOCATION_TIMEOUT`**
([error reference](https://vercel.com/docs/errors/FUNCTION_INVOCATION_TIMEOUT)).

### 1.2 Streaming is held to the same ceiling

This is the decisive answer to the ticket's sub-question. Vercel's limits page states that for
request handlers, duration *"includes time spent processing the request and sending the response,
**including streamed responses**"* ([Functions Limits](https://vercel.com/docs/functions/limitations)).
The duration page repeats the guidance: allow enough time for *"any necessary waiting periods
(for example, streamed responses)"* ([duration](https://vercel.com/docs/functions/configuring-functions/duration)).

There is **no long-stream exemption**. A stream that is still open at `maxDuration` is cut.

### 1.3 Edge runtime is strictly worse for this workload

- A function on the Edge runtime **must begin sending a response within 25 s** to keep streaming
  past that point, and may then stream for **up to 300 s total**, inclusive of post-response
  `waitUntil()` work.
  ([Edge Runtime](https://vercel.com/docs/functions/runtimes/edge),
  [New execution duration limit for Edge Functions](https://vercel.com/changelog/new-execution-duration-limit-for-edge-functions))
- Standalone Edge Functions are marked **deprecated** in the docs
  ([Edge Functions (Deprecated)](https://vercel.com/docs/functions/runtimes/edge/edge-functions)).

**Use Node.js.** Edge buys nothing here (the workload is I/O-bound on a single upstream API, not
latency-sensitive at the edge) and costs 500 s of ceiling.

### 1.4 Fluid compute: what it changes, and what it costs

**What it is / defaults** ([Fluid compute](https://vercel.com/docs/fluid-compute)):

- Enabled **by default for new projects created on or after 23 April 2025**. Existing projects
  enable it in project → Functions settings, or declaratively:

```json
{ "$schema": "https://openapi.vercel.sh/vercel.json", "fluid": true }
```

- It is what raises the default duration to 300 s and unlocks the 800 s / 1800 s ceilings above.
- It is also what Vercel Workflows runs on ([Vercel Workflows](https://vercel.com/workflows)); the
  Workflow SDK is *"designed to use Vercel's Fluid compute. Without it, each workflow resumption
  can trigger a cold start."* ([durable execution](https://vercel.com/blog/a-new-programming-model-for-durable-execution))

**What it costs** ([Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing),
[Active CPU pricing](https://vercel.com/blog/introducing-active-cpu-pricing-for-fluid-compute)):

| Resource | Rate |
| --- | --- |
| Active CPU | $0.128 per hour |
| Provisioned Memory | $0.0106 per GB-hour |
| Invocations | $0.60 per million (Pro) |

The billing model is unusually favourable for this project: *"If the request is waiting on I/O, CPU
billing pauses but memory billing continues… After all requests complete, the instance is paused,
and no CPU or memory charges apply until the next invocation."*
([Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing))

A 40-scene compile is ~99% wall-clock spent *waiting on Gemini*. Under Active CPU pricing that
wait is billed as memory, not CPU — the exact opposite of classic per-GB-second serverless
billing, where a long LLM wait is the expensive case. Active CPU pricing is enabled by default for
all Hobby, Pro, and new Enterprise teams
([changelog](https://vercel.com/changelog/lower-pricing-with-active-cpu-pricing-for-fluid-compute)).

### 1.5 Payload ceiling to keep in view

Maximum request-body or response-body payload for a function is **4.5 MB**; over it returns
**413 `FUNCTION_PAYLOAD_TOO_LARGE`** ([Functions Limits](https://vercel.com/docs/functions/limitations)).
A short-story compiled edition is far under this, but a novel-scale edition returned as one JSON
document is not — page or stream edition reads rather than returning them whole. Whether this cap
applies to incrementally streamed response bodies is **[unverified]**; assume it may and do not
design around exceeding it.

---

## 2. The long-run pattern

Sizing the problem: 40 scenes × one sequential Gemini call each. At 10 s/scene the run is ~400 s;
at 20 s/scene, ~800 s; at 30 s/scene, ~1200 s. The POC's 12–20 scenes land at roughly 120–600 s.
So even the POC exceeds Hobby's 300 s ceiling in the middle of its range, and the charted 40-scene
case exceeds the 800 s GA ceiling at any scene cost above ~20 s.

### Option A — one long streaming response  ❌ rejected

| | |
| --- | --- |
| Works? | Only for short runs on Pro; never for 40 scenes on Hobby |
| Ceiling | 300 s Hobby / 800 s Pro / 1800 s Pro-beta, streaming included ([limits](https://vercel.com/docs/functions/limitations)) |
| Tab close | **Run dies.** `request.signal` fires, function is terminated; unwrapped work is lost ([cancellation changelog](https://vercel.com/changelog/node-js-vercel-functions-now-support-per-path-request-cancellation)) |
| Crash / redeploy | Run lost, no resume |

`waitUntil()` does not rescue it: promises passed to `waitUntil()` *"have the same timeout as the
function itself. If the function times out, the promises will be cancelled."*
([@vercel/functions](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)).
It is a flush-the-logs tool, not a background-job tool.

### Option B — one invocation per scene, driven by the client  ⚠️ fallback only

| | |
| --- | --- |
| Works? | Yes, technically — each scene fits comfortably in 300 s, so it runs on Hobby |
| Tab close | **Run stops permanently.** Nothing exists to issue call N+1 |
| Cost | Full World Model + Discourse Record round-trips through storage between every scene |
| Verdict | Directly violates the map's *"read-time compiles are unattended"* constraint |

Keep this in the back pocket as the zero-dependency fallback if Workflows proves awkward, but it
makes the reader's browser the orchestrator, which is precisely the thing the constraint forbids.

### Option C — cron  ❌ wrong tool

Cron duration limits are identical to function limits, so it solves nothing on the ceiling
([Cron usage & pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)). Worse, **Hobby
allows 2 cron jobs, each triggered at most once per day**, and Vercel may fire a job anywhere
within the specified hour to spread load
([Cron Jobs](https://vercel.com/docs/cron-jobs), [Limits](https://vercel.com/docs/limits)). Cron is
a scheduler; a reader opening a story is an event, not a schedule.

### Option D — Vercel Queues  ⚠️ viable, but you build the orchestrator

[Vercel Queues](https://vercel.com/docs/queues) is in **public beta**
([changelog](https://vercel.com/changelog/vercel-queues-now-in-public-beta)). Publish/lease/ack/retry
over topics and consumer groups, with per-consumer-group max concurrency, messages up to **100 MB**,
and TTL/delivery delay up to **7 days**
([Queues concepts](https://vercel.com/docs/queues/concepts),
[7-day TTL](https://vercel.com/changelog/queues-now-supports-7-day-ttl)). After 32 delivery attempts
Vercel forces exponential backoff ([concepts](https://vercel.com/docs/queues/concepts)).

You could chain scenes by having the consumer of scene *N* enqueue scene *N+1*. It works — and it
is what Workflows is built on top of — but you hand-roll sequencing, run state, replay-safety, and
the reader's stream. No reason to, given Option E.

### Option E — Vercel Workflows  ✅ **recommended**

Generally available **16 April 2026** ([Vercel Workflows](https://vercel.com/workflows)). Two
directives turn ordinary async functions into durable ones: `"use workflow"` marks the workflow,
`"use step"` isolates a unit of work with automatic retries, persistence, and observability
([introducing WDK](https://vercel.com/blog/introducing-workflow)).

**Why it dissolves the ceiling.** *"WDK compiles each step into an isolated API Route… While the
step executes on a separate route, the workflow is suspended without consuming any resources. When
the step is complete, the workflow is automatically resumed right where it left off."* The
execution is *"distributed across multiple serverless function invocations, so long-running AI
operations never hit timeout limits."*
([durable execution](https://vercel.com/blog/a-new-programming-model-for-durable-execution),
[introducing WDK](https://vercel.com/blog/introducing-workflow))

Only an **individual step** must fit inside a function's duration limit
([Workflow pricing and limits](https://vercel.com/docs/workflows/pricing)) — and one scene's Gemini
call is seconds, not minutes. The 300 s Hobby ceiling stops being a constraint on the *run* and
becomes a constraint on *one scene*, which is enormous headroom.

**What happens when the reader closes the tab — the key result.**
`getWritable()` *"gives you a persistent stream that multiple clients can connect to, disconnect
from, reconnect to later, and resume from any point. The workflow keeps running even if the user
closes the browser. When they come back, the client reconnects and continues exactly where the
stream left off, no Redis or custom pub/sub required."* The **run ID enables reconnection**.
([durable execution](https://vercel.com/blog/a-new-programming-model-for-durable-execution),
[Vercel Workflows docs](https://vercel.com/docs/workflows))

That is the unattended read-time compile, delivered by the platform rather than invented here.
It also hands the project two things it wanted anyway: a **compiled edition is just a completed
run**, addressable and shareable by run ID; and a **run report** falls out of the event log, where
*"every step, input, output, pause, and error is recorded"*
([introducing WDK](https://vercel.com/blog/introducing-workflow)).

**Limits** ([Workflow pricing and limits](https://vercel.com/docs/workflows/pricing)):

| Limit | Value | Bearing on a 40-scene compile |
| --- | --- | --- |
| Steps per run | 10,000 | 40 scenes × ~3 steps ≈ 120. Ample, even at novel scale |
| Maximum run duration | **no limit** | The ceiling is gone |
| Maximum sleep duration | no limit | Author-time pauses are free |
| Max runtime of one step | per Functions limits | 300 s Hobby / 800 s Pro per *scene* |
| Events per run | 25,000 | Watch at novel scale — see below |
| Event creations per run per second | 200 | Not a concern; scenes are seconds apart |
| Max payload size | 50 MB | Comfortable |
| Max total entity storage per run | 2 GB | Comfortable |
| Max stream storage size | unlimited | — |
| **Storage retention** | **Hobby 1 day / Pro 7 days / Enterprise 30 days** | ⚠️ **See warning** |

> ⚠️ **Workflow persistence is not an archive.** Retention is 1 day on Hobby, 7 on Pro, 30 on
> Enterprise (custom periods on request via support). A **Compiled edition** — which the domain
> model says must be *"re-readable, shareable, and diffable against another run"* — must therefore
> be written out to durable storage (Vercel Blob) as it is produced. Do not treat the run's event
> log as the edition. ([Workflow pricing and limits](https://vercel.com/docs/workflows/pricing))

**Pricing** ([Workflow pricing and limits](https://vercel.com/docs/workflows/pricing)). Billed on
three axes — Workflow Events (every state transition is persisted as an event), Workflow Data
Written (including stream data), Workflow Data Retained.

| | Hobby included | Pro on-demand |
| --- | --- | --- |
| Workflow Events | 50,000 / month | $0.02 per 1K |
| Workflow Data Written | 1 GB | $0.50 per GB |
| Workflow Data Retained | not available | $0.50 per GB-month |

Functions invoked by workflows are billed separately at normal compute rates, and Vercel
recommends Fluid compute with Workflow for reduced cost and higher performance.

**The metering to watch:** *events*, not time. If one 40-scene run costs a few hundred events,
Hobby's 50,000/month supports on the order of 100–250 reads per month before spend begins — fine
for a POC with one author, and worth measuring early because every read of the story is a fresh
run by design. At true novel scale, check a run against the **25,000 events per run** cap.

---

## 3. Persistence

### 3.1 What exists today vs. what was sunset

**Sunset — do not design against these.** *"The Vercel KV and Vercel Postgres products have been
sunset"*; alternatives are provisioned through the Marketplace. Existing Vercel Postgres databases
were **automatically moved to Neon in December 2024**.
([Vercel Storage overview](https://vercel.com/docs/storage),
[Storage on Vercel Marketplace](https://vercel.com/docs/marketplace-storage),
[Postgres on Vercel](https://vercel.com/docs/storage/vercel-postgres))

**First-party today:** Vercel Blob and Vercel Edge Config
([Vercel Storage overview](https://vercel.com/docs/storage)).

### 3.2 Vercel Blob — ✅ recommended for Story Packages and Compiled editions

**Access from a route handler.** Install `@vercel/blob`; the store provisions a
`BLOB_READ_WRITE_TOKEN` environment variable into the project. `put()`, `head()`, `list()`, `del()`,
`get()` are promise-based single calls
([Vercel Blob](https://vercel.com/docs/vercel-blob),
[@vercel/blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk),
[Server uploads](https://vercel.com/docs/vercel-blob/server-upload)).

**Public vs private.** Private Blob stores are **generally available**
([changelog](https://vercel.com/changelog/vercel-private-blob-is-now-generally-available)). Private
blobs get `https://<store-id>.private.blob.vercel-storage.com/<pathname>` URLs that are not
publicly reachable; you deliver them through Vercel Functions with your own auth logic. Most SDK
methods require an explicit `access: 'private' | 'public'`, making the choice visible in code.
([Private Storage](https://vercel.com/docs/vercel-blob/private-storage),
[Public Storage](https://vercel.com/docs/vercel-blob/public-storage))

**Two behaviours that will bite this project if unhandled:**

- **Overwrites are blocked by default.** Uploading to an existing pathname throws unless you pass
  `allowOverwrite`. `addRandomSuffix` defaults to `false`.
  ([@vercel/blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk))
- **Overwrites are not immediately visible.** *"When you overwrite a blob at an existing pathname,
  readers might see the cached version for up to 60 seconds."* For reads that must reflect the last
  write — Vercel's own examples name *"an agent's memory file"* and *"a session transcript"*, which
  is exactly the World Model and Discourse Record — pass **`useCache: false`** to `get()` on private
  storage. Those reads bypass the CDN, are slower, and incur Fast Origin Transfer. Minimum
  configurable `cacheControlMaxAge` is 60 s.
  ([consistent reads changelog](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage),
  [@vercel/blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk))

**Size.** Files up to **5 TB** via multipart upload
([changelog](https://vercel.com/changelog/5tb-file-transfers-with-vercel-blob-multipart-uploads)).
Blobs over **512 MB are not cached**, so every download is a cache miss
([Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)). Irrelevant at JSON-document
scale — every object here is kilobytes.

**Pricing** ([Blob usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing),
[GA blog](https://vercel.com/blog/vercel-blob-now-generally-available)):

| | Rate | Hobby included |
| --- | --- | --- |
| Storage | $0.023 / GB-month | 1 GB / month |
| Simple operations | $0.40 / million | 10,000 / month |
| Advanced operations | $5.00 / million | 2,000 / month |
| Blob Data Transfer | from $0.05 / GB | 10 GB / month |

Storage is metered by snapshotting store size every 15 minutes and averaging over the month, so
you pay for actual usage rather than peak. Rate limits count **operations, not HTTP requests** —
`del([...])` over 100 blobs is 100 operations. `head()` and any URL access that is a cache MISS are
simple operations; multipart uploads count as advanced for rate limiting but not for billing.

At POC scale — hundreds of documents, one author, kilobyte JSON — this sits inside the Hobby
allowance, with per-scene writes the thing to count (40 scenes × a write each × reads per run).

### 3.3 Vercel Edge Config — ❌ not for story state

Reads are extremely fast (often <1 ms; the vast majority within 15 ms at P99), but **writes take up
to 10 seconds to propagate globally**, and the docs explicitly say to *"avoid using Edge Configs for
frequently updated data or data that needs to be accessed immediately after updating."*
([Vercel Edge Config](https://vercel.com/docs/edge-config),
[Edge Config limits and pricing](https://vercel.com/docs/edge-config/edge-config-limits))

That rules it out for the World Model, the Discourse Record, and the told-ledger — all of which are
written and re-read within a single scene boundary. Per-plan size limits are documented on the
limits page but could not be extracted here **[unverified]**; they don't change the conclusion.
Edge Config is right for feature flags and a pointer to the current **Baked edition**, nothing more.

### 3.4 Marketplace storage — the escape hatch, not the POC choice

Postgres via **Neon / Supabase / AWS Aurora**, Redis via **Upstash**, provisioned through the
Marketplace with automatic account provisioning and unified billing
([Storage on Vercel Marketplace](https://vercel.com/docs/marketplace-storage),
[Vercel Storage overview](https://vercel.com/docs/storage)).

Connecting a resource to a project **creates environment variables from the resource's credentials**
(e.g. `PGHOST`, `PGPASSWORD`) which your route handler reads from `process.env`
([Marketplace storage](https://vercel.com/docs/marketplace-storage),
[Add a Native Integration](https://vercel.com/docs/integrations/install-an-integration/product-integration)).
`vercel install neon | upstash | supabase` provisions the resource, connects it, and pulls the
credentials into `.env.local`; `--plan free` is available for non-interactive flows.

**Not recommended for the POC.** The map already rules a real database out of scope, and the ticket
asks for normalized JSON documents rather than a relational engine. Reach for Upstash Redis only if
per-key mutation churn on Blob turns out to hurt; reach for Neon only when the POC becomes
multi-user.

### 3.5 Recommended persistence layout

Model the "normalized JSON tables written *as if* SQL" as **blob path prefixes**. The table is the
prefix; the primary key is the pathname. The swap to Postgres later stays mechanical, as the map
requires.

```
story/{storyId}/package.json          # Story Package: World Model seed, Scene Cards, Voice Card
story/{storyId}/scene-cards/{n}.json  # Scene Cards, if authored/edited independently
edition/{runId}/manifest.json         # Compiled edition: seed, status, scene index, run report
edition/{runId}/scene-{n}.json        # Performance prose + Scene Digest per scene
edition/{runId}/world-model.json      # World Model at close of run
edition/{runId}/discourse.json        # Discourse Record + told-ledger at close of run
baked/{storyId}.json                  # pointer to the Baked edition's runId
```

- **Store:** private Blob store. Deliver reads through route handlers.
- **In-flight run state** (World Model, Discourse Record, told-ledger between scenes) lives in the
  workflow's own step inputs/outputs — recorded in the event log, replay-safe, up to 2 GB entity
  storage per run — **and is flushed to Blob at each scene boundary** so the edition outlives the
  1-day (Hobby) / 7-day (Pro) workflow retention.
- **Every read that must reflect the previous scene's write uses `useCache: false`.** This is the
  single most likely source of a subtle continuity bug: a 60-second stale read of the told-ledger
  would make the engine re-introduce a fact it already told the reader.
- **Never `del()` + `put()` to update.** Use `allowOverwrite`, or write a new pathname.

---

## 4. Secrets — the Gemini key

**Supply.** Add `GEMINI_API_KEY` as a project environment variable (Vercel dashboard, or
`vercel env add`), scoped per environment — Production / Preview / Development
([Environment variables](https://vercel.com/docs/environment-variables)). Locally it lives in
`.env.local`, which is gitignored by default
([Environment and Security](https://vercel.com/academy/nextjs-foundations/env-and-security)).

**Why it stays server-side.** In Next.js, **only** variables prefixed `NEXT_PUBLIC_` are inlined
into the client JavaScript bundle at build time; everything else remains server-only. A
`NEXT_PUBLIC_` value becomes a hardcoded string in the browser bundle and is readable in DevTools —
and because it is inlined *at build time*, no runtime change can update it.
([Framework environment variables](https://vercel.com/docs/environment-variables/framework-environment-variables),
[Environment and Security](https://vercel.com/academy/nextjs-foundations/env-and-security))

**What in Next.js routing could expose it — the four real risks:**

1. **Naming it `NEXT_PUBLIC_GEMINI_API_KEY`.** The docs are blunt: *never prefix secrets with
   `NEXT_PUBLIC_`.* Vercel even ships a Conformance rule,
   [`NEXTJS_SAFE_NEXT_PUBLIC_ENV_USAGE`](https://vercel.com/docs/conformance/rules/NEXTJS_SAFE_NEXT_PUBLIC_ENV_USAGE),
   flagging `process.env.NEXT_PUBLIC_*` usage for review *"to ensure there are no unintended leakage
   of environment variables."*
2. **Reading the key from a module that a Client Component imports.** The Server/Client Component
   boundary is what keeps server-only code out of the bundle
   ([Server and Client Components](https://vercel.com/academy/nextjs-foundations/server-and-client-components)).
   Confine `process.env.GEMINI_API_KEY` to route handlers and workflow step modules; put a
   `server-only` guard on the Gemini client module so a stray client import fails the build rather
   than shipping the key.
3. **Echoing config back to the reader.** The reader-facing stream and any run-report endpoint must
   emit prose, digests, and diagnostics — never the request envelope sent to Gemini.
4. **Committing `.env`.** Standard, but worth writing down.

**Workflow note.** Because WDK compiles each `"use step"` into an isolated API Route
([durable execution](https://vercel.com/blog/a-new-programming-model-for-durable-execution)), the
key is read inside a server route as usual and never approaches the client. Those step routes are
platform-internal; the only surface the reader touches is the run's stream endpoint.

**Alternative worth knowing, not recommended for v1.** Vercel **AI Gateway** removes the provider
key from the app entirely: authenticate with `AI_GATEWAY_API_KEY` — or with **OIDC tokens for
keyless authentication** on Vercel deployments — and pass a plain model string such as
`google/gemini-3.1-pro-preview` to the AI SDK, with no provider package and no Google key in your
environment. It also brings model fallbacks and spend observability.
([AI Gateway authentication & BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/authentication),
[AI SDK via Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/ai-sdk),
[Model fallbacks](https://vercel.com/docs/ai-gateway/models-and-providers/model-fallbacks))
The map's stack says "Gemini API, key server-side", so keep the direct key for v1 — but if
per-scene retry/fallback behaviour becomes a real concern, the Gateway is the cheap upgrade.

---

## Recommended arrangement

| Concern | Choice |
| --- | --- |
| Runtime | **Node.js**, not Edge |
| Compute | **Fluid compute** on (default for new projects); Active CPU billing suits an I/O-bound compile |
| Orchestration | **Vercel Workflows** — one workflow run per read; one `"use step"` per scene (or per pass within a scene) |
| Per-step duration | leave at the 300 s default; a single scene is seconds |
| Reader delivery | the workflow's **resumable stream** (`getWritable()`), subscribed by run ID |
| Durable output | **Vercel Blob**, private store, JSON documents keyed by path prefix |
| In-flight state | workflow step inputs/outputs, flushed to Blob at each scene boundary |
| Config / Baked-edition pointer | Edge Config (optional) or a Blob document |
| Secrets | `GEMINI_API_KEY` as an unprefixed project env var, read only in route handlers and step modules |
| Plan | Hobby is sufficient for the POC; **Pro** the moment retention >1 day or a step >300 s matters |

**The shape in one sentence.** A reader opening a story starts a durable workflow run; each Scene
Card is a step; each step writes its prose and Scene Digest to the run's stream *and* to Blob; the
reader's browser subscribes to the stream by run ID and may leave and return at will; the completed
run's Blob documents **are** the Compiled edition.

This also lands two things the map wanted for free: the read-time compile becomes genuinely
unattended (the run does not belong to the reader's connection), and the **run report** is a
projection of the workflow event log rather than a thing to invent.

## Tickets this touches

- The read-time architecture **survives**, but "streaming compile" must be respecified as
  "durable run + subscribable stream". A run ID becomes a first-class identifier — worth adding to
  `CONTEXT.md` alongside **Compiled edition**, since a Compiled edition is now precisely *the
  persisted output of one workflow run*.
- **Compiled edition** must be defined as living in Blob, not in workflow persistence (1-day
  retention on Hobby).
- Scene-boundary flushing to Blob is now a hard requirement of the compile loop, not an
  optimization — it is what makes a run resumable and an edition durable.
- Cost per read at novel scale (an open item on the map) now has its meters: Workflow **events per
  run**, Blob operations per run, Fluid Active CPU + Provisioned Memory, plus Gemini tokens.

## Open items to verify against the live docs

1. **[unverified]** Edge Config per-plan size limits — [edge-config-limits](https://vercel.com/docs/edge-config/edge-config-limits). Does not change the recommendation.
2. **[unverified]** Whether the 4.5 MB function payload cap applies to incrementally streamed response bodies — [Functions Limits](https://vercel.com/docs/functions/limitations).
3. Measure **events per workflow run** for a real 12–20 scene compile against Hobby's 50,000/month and the 25,000/run cap — [Workflow pricing and limits](https://vercel.com/docs/workflows/pricing).
4. Confirm the current beta status of the 1800 s extended duration before relying on it; the POC should not need it — [duration](https://vercel.com/docs/functions/configuring-functions/duration).
