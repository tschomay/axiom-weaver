# Gemini capabilities the compiler depends on

Research for [#5](https://github.com/tschomay/axiom-weaver/issues/5) (part of [#1](https://github.com/tschomay/axiom-weaver/issues/1)). Answered **2026-08-18**.

Terms are from [`CONTEXT.md`](../../CONTEXT.md): Performance, Scene Card, Scene Digest, World Model, Discourse Record, zoom levels, continuity pass, state-update tiers.

---

## Note on sources (read this before trusting a number)

This session's egress policy **blocks `ai.google.dev` and `docs.cloud.google.com`** (403 at the proxy on CONNECT). Two consequences:

1. **Hard primary sources I fetched directly** — the live machine-readable API definitions, which are the ground truth the docs are generated from:
   - Gemini Developer API discovery document, `v1beta`, **revision 20260816**: `https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta`
   - Vertex / Agent Platform discovery document, `v1beta1`, **revision 20260808**: `https://aiplatform.googleapis.com/$discovery/rest?version=v1beta1`
   - Pricing page (fetched in full): <https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing>
   - Endpoint-existence probes against `https://generativelanguage.googleapis.com/…`
2. **Prose-doc claims** (guides, model pages, rate limits) were read *through search over those primary doc domains*, not fetched page-by-page. Every such claim below cites the Google doc URL it came from. Where a claim could not be corroborated by the discovery document, it is marked **[doc-only]**. Two claims below are marked **[forum]** — those are `discuss.ai.google.dev` developer-forum reports, not documentation, and are included only as failure-mode warnings.

Anything marked **[doc-only]** should be re-verified by opening the cited URL from an unblocked machine before it is baked into the spec.

---

## Headline: five things that touch decisions already on the map

| # | Finding | Effect on the map |
| --- | --- | --- |
| 1 | **Streaming and structured output *do* coexist** — one call, chunks are valid partial JSON that concatenate. | The read-time loop survives. But prose arrives JSON-escaped inside a string field, so the reader path needs an incremental JSON parser, and `propertyOrdering` must put `prose` first or the reader sees nothing until the digest is written. |
| 2 | **Function calling is *not* a mid-generation callback.** The model emits a `functionCall` part and stops the turn; you reply with a `functionResponse` in a **new request**. | A `lookup(entity)` tool means N+1 round trips per scene and a segmented reader stream. **Recommend: no tools in the writer call.** Pre-resolve World Model rows into the prompt — the compiler already knows characters-present, so retrieval is deterministic and does not need the model's judgement. |
| 3 | **`responseSchema` / `responseMimeType` / `responseJsonSchema` are marked `deprecated` in the live discovery documents**, superseded by `generationConfig.responseFormat`. Separately, `generateContent` itself is now labelled *legacy* in favour of a new **Interactions API**. | The prompt-contract spec must not hardcode `responseSchema`. Pick a surface deliberately (recommendation in §7). |
| 4 | **The response schema is billed as input on every single call and is NOT cacheable** — `CachedContent` holds `contents`, `systemInstruction`, `tools`, `toolConfig` and nothing else; `generationConfig` is not part of it. | The writer's one-response contract (prose + digest + state updates + diagnostics) is a large schema paid ~40× per read at POC scale. Keep it lean; measure it with `countTokens`. |
| 5 | **`MAX_TOKENS` under a schema yields truncated, unparseable JSON** — there is no partial-object recovery. | At read time the reader may already have seen streamed prose for a scene whose digest can never be committed. The engine needs an explicit salvage path; "unattended read-time compile" is not safe without one. |

---

## 1. Structured output

### How it is requested

Three generations of the same field exist simultaneously. From the **v1beta discovery document** (`GenerationConfig`):

| Field | Status in discovery doc | Notes |
| --- | --- | --- |
| `responseMimeType` | live on Gemini API; **`deprecated: true` on Vertex** ("Deprecated: Use `response_format` instead") | `application/json`, `text/plain`, `text/x.enum` |
| `responseSchema` (`$ref: Schema`) | **`deprecated: true`** on both surfaces | OpenAPI-3.0-subset schema. Requires a compatible `responseMimeType`. |
| `responseJsonSchema` | present; on Vertex **`deprecated: true`** | accepts real JSON Schema rather than the OpenAPI subset |
| `responseFormat` (`$ref: ResponseFormatConfig`) | **current** | the replacement |

`responseFormat` is per-modality: `ResponseFormatConfig { text, image, audio }` (Vertex adds `video`), and `TextResponseFormat` carries `mimeType: APPLICATION_JSON | TEXT_PLAIN` plus a free-form `schema` field. This matches the Interactions-API guide's description: *"configure `response_format` with an object … of type text and set its `mime_type` to `application/json`, with the schema provided in the `schema` field"* — <https://ai.google.dev/gemini-api/docs/interactions/structured-output>.

The `Schema` object itself is documented in-line in the discovery doc as *"a select subset of an OpenAPI 3.0 schema object"*.

### Supported schema subset

Two schema dialects, with different subsets.

**A. `Schema` (OpenAPI subset)** — fields present in the v1beta discovery document: `type` (`STRING|NUMBER|INTEGER|BOOLEAN|ARRAY|OBJECT|NULL`), `format`, `title`, `description`, `nullable`, `enum`, `properties`, `required`, `propertyOrdering`, `items`, `anyOf`, `minItems`/`maxItems`, `minLength`/`maxLength`, `minimum`/`maximum`, `minProperties`/`maxProperties`, `pattern`, `example`, `default` (explicitly *"included here and ignored"*).

- Nested objects: yes (`properties` recurses into `Schema`).
- Arrays: yes, with `items` and length bounds.
- Enums: yes — `{type: STRING, format: "enum", enum: [...]}`.
- Optional fields: everything not in `required` is optional; `nullable: true` for explicit nulls.
- Unions: `anyOf` is supported. There is **no `oneOf`** in this dialect.
- Property ordering: `propertyOrdering` — *"Used to determine the order of the properties in the response."* Non-standard, and load-bearing (see §3).

**B. `responseJsonSchema` (real JSON Schema)** — the discovery doc enumerates exactly what is honoured: `$id`, `$defs`, `$ref`, `$anchor`, `type`, `format`, `title`, `description`, `enum` (strings and numbers), `items`, `prefixItems`, `minItems`, `maxItems`, `minimum`, `maximum`, `anyOf`, `oneOf` (*"interpreted the same as `anyOf`"*), `properties`, `additionalProperties`, `required`, plus non-standard `propertyOrdering`. Two constraints stated verbatim:

> *Cyclic references are unrolled to a limited degree and, as such, may only be used within non-required properties. (Nullable properties are not sufficient.)*

> *If `$ref` is set on a sub-schema, no other properties, except for than those starting as a `$`, may be set.*

`$defs` + `$ref` is the dialect to use for the Scene Digest, because the digest reuses shapes (entity refs, fact refs, plant refs) across several fields.

Vertex's guide restates the same list — <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output>. **[doc-only]** the same page warns that if the prompt itself contains example JSON, its property order must match `propertyOrdering`, or *"a mismatch in ordering can confuse the model and lead to incorrect or malformed output."*

### Cost and failure behaviour

- **[doc-only]** *"The size of your response schema counts towards the input token limit."* — <https://ai.google.dev/gemini-api/docs/structured-output>. And it is not cacheable (see §2), so the writer contract's schema is a fixed per-scene tax.
- **[doc-only]** *"A complex schema can result in an `InvalidArgument: 400` error. Complexity might come from long property names, long array length limits, enums with many values, objects with lots of optional properties, or a combination of these factors."* — same page. This is a hard request-time rejection, not a degradation.
- **[doc-only]** *"if your use case prevents you from pre-defining a schema, implement a client-side JSON validator with a retry mechanism"* — same page. Google's own guidance is that the client validates.
- **Failure at generation time** is reported through `Candidate.finishReason`. The v1beta discovery document enumerates these; the ones the compiler must handle:

  | `finishReason` | Discovery-doc description | Why it matters here |
  | --- | --- | --- |
  | `MAX_TOKENS` | *"The maximum number of tokens as specified in the request was reached."* | JSON is cut mid-string. **No partial object is returned** — you get a truncated text part. |
  | `MALFORMED_RESPONSE` | *"Finished due to malformed response."* | The schema constraint failed outright. |
  | `RECITATION` | *"flagged for recitation reasons"* | Real risk for a prose engine imitating a style exemplar. |
  | `SAFETY` / `PROHIBITED_CONTENT` / `BLOCKLIST` / `SPII` | content filters | Fiction with violence or trauma will hit these; read-time compiles are unattended. |
  | `MALFORMED_FUNCTION_CALL`, `UNEXPECTED_TOOL_CALL`, `TOO_MANY_TOOL_CALLS`, `MISSING_THOUGHT_SIGNATURE` | tool-path failures | Only reachable if you enable tools — an argument for §4's recommendation. |

  `Candidate.finishMessage` is *"populated only when `finish_reason` is set"* and carries the detail.

- **[forum]** Two failure modes reported by developers, not in the docs, worth designing against: schema-constrained output on `gemini-3.7-flash` intermittently entering a digit-repetition decode loop until `maxOutputTokens` on prompts with many near-identical items (<https://discuss.ai.google.dev/t/gemini-3-7-flash-schema-constrained-json-output-degenerates-into-repeated-0-until-maxoutputtokens-regression-vs-gemini-3-flash-preview/178681>), and structured output hitting max-tokens without valid JSON (<https://discuss.ai.google.dev/t/truncated-response-issue-with-gemini-2-5-flash-preview/81258>). Treat "the writer sometimes returns garbage that costs a full output budget" as a live case, not a tail risk.

### Consequence for the writer contract

The one-response contract is viable, but:

1. Use `responseJsonSchema`/`responseFormat.text.schema` with `$defs`, not a hand-inlined OpenAPI blob.
2. Set `propertyOrdering` (or field order in `$defs`) so the emission order is **`prose` → `scene_digest` → `state_updates` → `diagnostics`**. Ordering is a streaming decision and a quality decision at once: what the model writes first, it conditions the rest on. Prose-first also means the digest is written *about* prose that already exists, which is what `CONTEXT.md` describes ("the compressed record emitted alongside each scene's prose").
3. Budget `maxOutputTokens` at roughly 2× the Scene Card's length budget in tokens, and treat `MAX_TOKENS` as a *retry-with-shorter-beat-list* signal, not a parse error.
4. Validate client-side and retry. Diagnostics being a first-class field does not save you — a truncated response has no diagnostics either.

---

## 2. Context caching

### Explicit vs implicit

Both exist and are different mechanisms.

**Explicit** — a `cachedContents` resource, in the discovery document with full CRUD (`cachedContents.create/get/list/patch/delete`). The `CachedContent` resource holds:

- `contents` (*"Input only. Immutable."*)
- `systemInstruction` (*"Input only. Immutable. Currently text only."*)
- `tools`, `toolConfig` (both *"Input only. Immutable."*)
- `model` (*"Required. Immutable."* — *"Cached content can be only used with model it was created for"*)
- `ttl` (input-only duration) / `expireTime`
- `usageMetadata.totalTokenCount`

You then reference it via `GenerateContentRequest.cachedContent` (*"The name of the content cached to use as context to serve the prediction. Format: `cachedContents/{cachedContent}`"*).

> **This is finding #4 on the headline list: `generationConfig` is not a field of `CachedContent`.** The response schema, `maxOutputTokens`, `temperature`, `thinkingConfig` are all re-sent and re-billed per call. Only `contents` + `systemInstruction` + `tools` cache.

**Implicit** — automatic, on by default. **[doc-only]** *"All Google Cloud projects have implicit caching enabled by default"*, and it *"provides a 90% discount on cached tokens compared to standard input tokens"* — <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-overview>.

### Minimum prefix, TTL, pricing

| Property | Value | Source |
| --- | --- | --- |
| Minimum cacheable tokens | **4,096** for Gemini 3.x; 2,048 for Gemini 2.0/2.5 | **[doc-only]** <https://ai.google.dev/gemini-api/docs/caching> |
| Maximum | up to the model's context window | **[doc-only]** same |
| Explicit TTL default | **1 hour**, updatable via `cachedContents.patch` (*"only expiration is updatable"* — discovery doc) | **[doc-only]** same + discovery |
| Cache-hit token price | **10% of the standard input price** (i.e. a 90% discount) on Gemini 2.5+ / 3.x; 75% on Gemini 2.0 | pricing page + **[doc-only]** overview page |
| Cache *creation* | billed at the standard input token price | **[doc-only]** overview page |
| Explicit-cache **storage** | **$0.000001 per token per hour** for all Flash / Flash-Lite classes = **$1.00 per 1M-token-hour**; $0.0000045/tok/hr for 3.1 Pro / 3 Pro / 2.5 Pro | <https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing> ("Context Cache Storage price for Explicit Caching") |
| Implicit-cache storage | **none** | **[doc-only]** overview page |
| Verifying a hit | `usageMetadata.cachedContentTokenCount` — *"Number of tokens in the cached part of the prompt"*; note `promptTokenCount` *"is still the total effective prompt size"* | discovery doc |

Concrete cache-hit prices from the pricing page (Global endpoint, standard tier): Gemini 3.7 Flash **$0.075/M** cached vs $0.75/M uncached input (promo pricing through 2026-12-31); Gemini 3.5 Flash **$0.15/M** vs $1.50/M; Gemini 3.5 Flash-Lite **$0.03/M** vs $0.30/M; Gemini 3.1 Pro Preview **$0.20/M** vs $2.00/M.

### The question that actually matters: "mostly stable, not byte-identical"

**Answer: you get nothing past the first differing token.** Caching is a *prefix* match, not a diff.

- **[doc-only]** *"Cached content is a prefix to the prompt"* and *"the cached content is immutable"* — <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-create>.
- **[doc-only]** *"To increase the chances of an implicit cache hit, place large and common contents at the beginning of your prompt. Send requests with a similar prefix in a short amount of time."* And, explicitly: *"cache hits aren't guaranteed"* — <https://ai.google.dev/gemini-api/docs/caching>.

So a prompt that is 95% stable but has one mutated row 20% of the way in caches only that first 20%. **This is the single hardest constraint on context assembly**, and it converts the zoom-level assembler from a "gather the relevant things" problem into an **ordering** problem:

> **Rule: the assembled prompt must be strictly append-only across the scenes of one read.** Everything that never changes first; everything that only ever grows next; everything that mutates last.

Which gives a mandated layout:

| Segment | Volatility | Placement |
| --- | --- | --- |
| Writer contract, Voice Card, style exemplar, World Model *schema*, tier definitions | never changes in a read | **systemInstruction / explicit cache** |
| Part Digests, Chapter Digests, Scene Digests so far | append-only | **cached prefix**, in fixed chronological order |
| Current Scene Card, plant obligations, filtered World Model **rows**, told-ledger slice, verbatim tail of previous scene | mutates every scene | **volatile tail, last** |

Two corollaries that contradict the intuitive design:

- **World Model rows must go last, not first.** Ground truth feels like it belongs at the top; putting it there destroys the cache for everything after it, because rows change every scene.
- **A rollup is a cache-invalidating event.** When a Chapter Digest replaces N Scene Digests, the middle of the prompt is rewritten and every token after the splice point is uncached for the next call. Rollups should therefore be batched at chapter boundaries (which is what the map already wants) and the assembler should expect one expensive scene after each rollup. This is a real input to the map's open question *"Rollup trigger policy at true novel scale"*.
- **Append-only ordering is stronger than it looks**: if scene N's prompt is a literal prefix of scene N+1's, then the whole of scene N's prompt is a cache candidate, not just the immutable header.

### Quantified saving

Assumptions, POC scale (16-scene short story), Gemini 3.7 Flash Global standard tier at promo pricing ($0.75/M in, $0.075/M cached, $3.75/M out):

| Segment | Tokens |
| --- | --- |
| A — immutable header (contract, Voice Card, exemplar, schema of World Model) | 15,000 |
| B — digest hierarchy (append-only, ~350 tok/scene, avg over the read) | 2,800 |
| C — volatile tail (Scene Card, obligations, WM rows, told-ledger, prev-scene tail) | 3,000 |
| S — response schema (never cacheable) | 800 |
| Output (prose ≈1,800 + thinking ≈1,200) | 3,000 |

| Arrangement | Input $/scene | Output $/scene | $/scene | $ per 16-scene read |
| --- | --- | --- | --- | --- |
| No caching | 0.01620 | 0.01125 | **0.0275** | **$0.44** |
| A cached only (WM rows placed before digests — the wrong order) | 0.00608 | 0.01125 | **0.0173** | **$0.28** |
| A+B cached (append-only ordering) | 0.00419 | 0.01125 | **0.0154** | **$0.25** |

At POC scale caching saves ~44% of total spend and ~74% of input spend, and the ordering mistake costs ~12%. **At POC scale, cost is not the constraint — a full read is well under a dollar either way.**

The picture changes at novel scale. Same model, a 600-scene novel where the digest hierarchy (B) has grown to ~45,000 tokens:

| Arrangement | Input $/scene | $ per 600-scene read (input only) |
| --- | --- | --- |
| No caching | 0.04785 | **$28.71** |
| A+B cached | 0.00735 | **$4.41** |

**That is the number the map's "cost and latency envelope" fog item needs: the logarithmic-growth digest hierarchy is affordable at novel scale only if it caches, and it only caches if assembly is append-only.** An 85% input-cost reduction is the difference between a $30 read and a $5 read.

Explicit-cache storage is negligible in both cases: 60K tokens × $1.00/M-tok-hour = $0.06/hour, against ~$24 saved. Use explicit caching (not implicit) for the header, because implicit *"cache hits aren't guaranteed"* and an unattended read-time compile should not have a 40× cost variance depending on the weather.

---

## 3. Streaming

### It works, in one call

- `models.streamGenerateContent` exists as a first-class method on both `v1beta` and `v1` (discovery document), taking the identical `GenerateContentRequest`. There is no separate schema-less streaming request type — **structured output and streaming are configured the same way and in the same call.**
- **[doc-only]** *"You can stream structured outputs… the streamed chunks will be valid partial JSON strings, which can be concatenated to form the final, complete JSON object."* — <https://ai.google.dev/gemini-api/docs/structured-output>.
- **[doc-only]** The Interactions API describes *"a symmetric streaming model where all content — text, tool calls, thinking — flows through a consistent step-based event"* — <https://ai.google.dev/gemini-api/docs/streaming>.

**So: one call, not two, and not an ill-defined partial-parse problem** — the chunks are *documented* to concatenate into valid JSON. But it is still an incremental-parse problem in this specific sense: what you receive is a growing JSON *string*, and the prose lives inside a JSON string field. To show a reader a sentence you must (a) accumulate, (b) run a streaming/relaxed JSON parser that can surface the value of an unterminated string, and (c) unescape `\n`, `\"`, `\u…` as they arrive.

### The three non-obvious streaming constraints

1. **`propertyOrdering` is the reader-latency dial.** If `scene_digest` is emitted before `prose`, the reader stares at nothing for the entire digest. Put `prose` first. There is no way to interleave — a single JSON document is emitted in one order.
2. **Thinking happens before any output token.** `thinkingConfig` is in `GenerationConfig` (discovery doc), and the Gemini 3.x models default to `MEDIUM` thinking level **[doc-only]** (<https://ai.google.dev/gemini-api/docs/latest-model>). Time-to-first-word for the reader is thinking latency + the JSON preamble. For a *reading* experience this is the dominant UX number, and the lever is `thinking_level: LOW`, which trades continuity quality for time-to-first-word. Worth measuring in the POC on the very first scene, since that is the one the reader waits for cold.
3. **A stream that ends in `MAX_TOKENS` has already been shown to the reader.** You cannot un-show it. Either buffer a scene fully before displaying it (kills the streaming premise), or accept that a truncated scene is a *run-report* event that leaves the Discourse Record without a digest for prose the reader has seen. The second is more interesting and more honest with the map's "diagnostics + run report" design, but it needs an explicit recovery move: re-derive the digest for the already-emitted prose in a separate, cheap call. **This makes a digest-only fallback call a required component, not an optimisation.**

---

## 4. Tool / function calling

### Whether the writer can call `lookup(entity)` mid-generation

**No — not in the sense the ticket asks.** Function calling is a turn-boundary protocol, not a coroutine.

From the discovery document: `Tool.functionDeclarations[]` of `FunctionDeclaration { name, description, parameters | parametersJsonSchema, response | responseJsonSchema, behavior }`, and the model's answer comes back as a `FunctionCall` part inside `Candidate.content`. **[doc-only]** the loop is: *"Gemini might send back structured JSON to call a specific function … you execute the function … you send the function results, with the same id as the function call, back to Gemini"* — <https://ai.google.dev/gemini-api/docs/function-calling>. That is a second `generateContent` request carrying the whole conversation again.

One relevant exception, and it is not available on the surface the map picked: `FunctionDeclaration.behavior` has `BLOCKING` / `NON_BLOCKING`, described in the discovery doc as *"Currently only supported by the `BidiGenerateContent` method"* — i.e. the Live/bidirectional WebSocket API, not `generateContent`.

### How it composes with structured output

**[doc-only]** Gemini 3 supports it: *"Gemini 3 lets you combine Structured Outputs with built-in tools, including Grounding with Google Search, URL Context, Code Execution, File Search, and Function Calling"* and *"function calling can be used together with structured output … so that you receive consistently formatted responses when model does not generate function calls"* — <https://ai.google.dev/gemini-api/docs/structured-output>, <https://ai.google.dev/gemini-api/docs/gemini-3>.

Read the wording precisely: the schema constrains the turns where the model *does not* call a function. So a writer turn either (a) calls `lookup` and returns no prose, or (b) returns the full schema-conforming object. It is a sequence of turns, not one turn with a tool detour inside it.

`FunctionCallingConfig.mode` (discovery doc) offers `AUTO`, `ANY`, `NONE`, and a newer **`VALIDATED`** — *"Model decides to predict either a function call or a natural language response, but will validate function calls with constrained decoding."*

### How it composes with streaming

- **Gemini Developer API**: `FunctionCallingConfig` has only `mode` and `allowedFunctionNames` in both `v1beta` and `v1alpha` (verified in the discovery documents). Function-call arguments are **not** streamable.
- **Vertex / Agent Platform only**: `GoogleCloudAiplatformV1beta1FunctionCallingConfig.streamFunctionCallArguments` — *"When set to true, arguments of a single function call will be streamed out in multiple parts/contents/responses. Partial parameter results will be returned in the `FunctionCall.partial_args` field."* (verified in the Vertex discovery document, rev 20260808).

**This is a capability that exists on Vertex and not on the Gemini Developer API** — relevant if the stack decision ("Gemini API, key server-side") is ever revisited.

### Recommendation: don't give the writer tools

For each `lookup(entity)` the writer would issue:

- one extra request round trip (latency directly in the reader's face);
- the full context re-sent — cached, so ~$0.075/M, but the *volatile tail plus schema* are re-billed at full price each time;
- a break in the prose stream, since the schema-conforming turn only starts after the tool result comes back;
- exposure to `MALFORMED_FUNCTION_CALL`, `UNEXPECTED_TOOL_CALL`, `TOO_MANY_TOOL_CALLS` and `MISSING_THOUGHT_SIGNATURE` finish reasons that otherwise cannot occur.

And it buys nothing the compiler cannot get deterministically. The Scene Card already declares POV, location and characters-present; the zoom-level filter already knows which World Model rows are in scope. **Retrieval here is a join, not a judgement.** Resolving it host-side and pasting the rows into the volatile tail is cheaper, faster, streamable, and — decisively for `CONTEXT.md`'s two-memories design — it keeps the *engine* in control of what the writer is allowed to see. A `lookup` tool would let the writer read World Model facts the Discourse Record says the reader has not been told, which is precisely the divergence the design exists to protect.

Keep `lookup(entity)` as an **author-time** affordance (a human iterating on a Scene Card asking "what does the model think it knows about Marisa?"), where the extra round trip is free and supervision exists.

---

## 5. The API-surface problem (flag)

Three overlapping surfaces are live simultaneously, and the docs disagree with each other about which is current:

1. **`generateContent` / `streamGenerateContent`** — in `v1` and `v1beta` discovery, fully documented, what every SDK example uses. Google's own doc titles now label it **"Gemini Generate Content API (Legacy)"** (e.g. <https://ai.google.dev/gemini-api/docs/generate-content/structured-output>).
2. **Interactions API** — `https://ai.google.dev/gemini-api/docs/interactions-overview`, with a migration guide (<https://ai.google.dev/gemini-api/docs/migrate-to-interactions>) and a breaking-changes guide (<https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026>). **[doc-only]** it is *"the simplest and best way to build with Gemini models and agents"* and *"recommended for all new development"*; adds server-side history via `previous_interaction_id` and `store=true` by default. **I could not resolve a contradiction in the doc corpus**: one page states it went GA in June 2026, another describes it as *"currently in an early beta stage … which may result in breaking changes."* I verified empirically that the endpoint exists — `GET https://generativelanguage.googleapis.com/v1beta/interactions` and `/v1alpha/interactions` return **403 "Method doesn't allow unregistered callers"** (i.e. it exists, needs auth), while `/v1/interactions` and a nonsense path return **404**. It is **not** in the published `v1beta` discovery document (rev 20260816).
3. **Field-level**: `responseSchema`, `responseMimeType`, `responseJsonSchema` are all `deprecated: true` on Vertex and `responseSchema` is deprecated on the Gemini API too, in favour of `responseFormat`.

**Recommendation for the POC**: build against **`streamGenerateContent` with `generationConfig.responseFormat.text.{mimeType, schema}`**, i.e. the legacy *method* with the current *field*. Reasons: the method is in the stable discovery document and every SDK supports it; the Interactions API's server-side state (`store=true`) is actively unhelpful here — the compiler owns the Discourse Record and does not want Google holding a parallel conversation history — and its own docs warn of breaking changes.

Isolate this behind one adapter module. Do not let `responseSchema` or a raw request shape leak into the prompt-contract spec; the spec should describe the *contract* (fields, ordering, tiers) and the adapter should own the wire format. On current evidence the wire format will change again inside the POC's lifetime.

---

## 6. Models, limits, rate limits, pricing

### Current model IDs and limits

**[doc-only]** — from the model pages on <https://ai.google.dev/gemini-api/docs/models/> and <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/>:

| Model ID | Context window | Max output | Thinking levels | Notes |
| --- | --- | --- | --- | --- |
| `gemini-3.7-flash` | 1M | 64k | LOW / **MEDIUM (default)** / HIGH | current flagship Flash — <https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash>, <https://ai.google.dev/gemini-api/docs/latest-model> |
| `gemini-3.6-flash` | 1M | 64k | same | previous Flash, same price |
| `gemini-3.5-flash` | 1M | 65k | yes | <https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash> |
| `gemini-3.5-flash-lite` | 1M | 64k | minimal/low/medium/high | <https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite> |
| `gemini-3.1-flash-lite` | 1M | 64k | minimal/low/medium/high | GA — <https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite> |
| `gemini-3.1-pro-preview` | 1M | — | yes | preview; priced with a >200K-token tier break |

All of the above **[doc-only]** support context caching and structured output; Gemini 3.x has the 4,096-token cache minimum.

### Pricing (per 1M tokens, USD, Global endpoint, standard tier)

Source: <https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing> (fetched 2026-08-18). *These are Vertex / Agent Platform prices — the Gemini Developer API pricing page (<https://ai.google.dev/gemini-api/docs/pricing>) was unreachable from this environment and should be checked before any budget is committed.*

| Model | Input | Cached input | Output (incl. reasoning) |
| --- | --- | --- | --- |
| Gemini 3.1 Pro Preview | $2.00 (≤200K) / $4.00 (>200K) | $0.20 / $0.40 | $12.00 / $18.00 |
| **Gemini 3.7 Flash** (promo → 2026-12-31) | **$0.75** | **$0.075** | **$3.75** |
| Gemini 3.7 Flash (from 2027-01-01) | $1.50 | $0.15 | $7.50 |
| Gemini 3.6 Flash | same as 3.7 Flash | same | same |
| Gemini 3 Flash Preview | $0.50 | $0.05 | $3.00 |
| Gemini 3.5 Flash | $1.50 | $0.15 | $9.00 |
| **Gemini 3.5 Flash-Lite** | **$0.30** | **$0.03** | **$2.50** |
| Gemini 3.1 Flash-Lite | $0.25 | $0.025 | $1.50 |

Flex/Batch tier is ~50% off (3.7 Flash: $0.375 / $0.0375 / $1.875). Non-global endpoints carry a ~10% premium. Explicit cache storage: **$0.000001/token/hour** for every Flash and Flash-Lite tier.

Two footnotes from the same page that matter here:
- *"Starting with Gemini 3.5, function declarations are included in the input token count."* — another small argument against tools in the hot loop.
- *"You're charged only for requests that return a 200 response code."* — schema-rejection 400s and safety blocks are free; `MAX_TOKENS` garbage is a 200 and is billed in full.

### Rate limits

**[doc-only]** — <https://ai.google.dev/gemini-api/docs/rate-limits>. Limits are RPM, TPM, RPD **and** a spend-based limit; exceeding any one triggers a 429. RPD resets at midnight Pacific. Spend-based limits per tier: Free n/a, **Tier 1 $10 / 10 min**, Tier 2 and Tier 3 $200 / 10 min, on a rolling 10-minute window. Tier 1 is instant on adding billing; Tier 2/3 depend on cumulative Google Cloud spend. Per-model RPM/TPM numbers are published in AI Studio rather than on the docs page, so they must be read live.

**Read-time implication.** A read is dozens of sequential calls; sequential-ness protects you from RPM. The exposure is TPM and the spend window: at POC scale a full read is ~$0.25 and ~350K input tokens, so a **Tier 1 project supports roughly 40 concurrent reads per 10 minutes before the spend limit bites**. That is fine for a demo and needs revisiting before any public reader. Retries after a `MAX_TOKENS` or validation failure double-count against both.

---

## 7. Recommendations

### Prose writer: `gemini-3.7-flash`, `thinking_level: MEDIUM`

- Best price/quality on the current Flash line, and priced 50% below `gemini-3.5-flash` for input *and* output through 2026-12-31 (note the **1 Jan 2027 doubling** — budget against $1.50/$7.50, not the promo rate).
- 1M context, 64k output: the output ceiling is ~30–50 scenes of prose, so it is not a constraint for one scene, and the 1M window means the zoom-level hierarchy never has to be truncated at POC scale.
- Prose quality is the whole product; Flash-Lite is a false economy here. Output tokens dominate the writer's per-scene cost anyway ($0.011 of $0.015 in the cached case), and Flash-Lite's output saving is $0.0011/scene — noise against the risk of flat prose.
- Set `thinking_level: LOW` **only** for the first scene if cold-start latency measures badly; keep MEDIUM elsewhere.
- **[forum]** watch for the schema-constrained decode-loop report on this model; if the POC reproduces it, `gemini-3.6-flash` is a same-price fallback.

### Digest rollups and the continuity pass: `gemini-3.5-flash-lite`, yes, a cheaper model suffices

Both operate over **digests, never prose** — the map's standing constraint — which makes them classification-and-summarisation work over already-structured input, exactly what Flash-Lite is for. Neither is reader-facing, so latency and last-5%-of-quality don't bite.

- Rollups (Scene Digests → Chapter Digest → Part Digest): small input, small output, highly schematic. `gemini-3.5-flash-lite` at $0.30/$2.50, or `gemini-3.1-flash-lite` at $0.25/$1.50 if it holds up.
- Continuity pass (seams, first-mention violations, recycled imagery): also digest-only. Flash-Lite is a reasonable default, but this pass makes *editorial* judgements about repetition and voice, so it is the one to A/B against `gemini-3.7-flash` — it is the cheapest pass to upgrade and the one where an upgrade is most likely to show.

**Caveat on the split**: explicit caches are bound to one model (`CachedContent.model` is *"Required. Immutable"*). Three models means three caches of the same header, or accepting uncached input for the cheap passes. Since the cheap passes see only digests — a small, different prompt anyway — that is fine, but it does mean **the cheap passes should not try to share the writer's cached prefix.**

### Concrete constraints for the spec

1. Assembly is **strictly append-only**; volatile World Model rows go **last**. (§2)
2. Response field order is **prose → digest → state_updates → diagnostics**, pinned with `propertyOrdering`. (§1, §3)
3. **No tools in the read-time writer call.** Resolve World Model rows host-side. (§4)
4. A **digest-only fallback call** is a required component, for salvaging scenes that hit `MAX_TOKENS` mid-stream. (§3)
5. The wire format lives behind **one adapter**; the prompt-contract spec names fields and ordering, not `responseSchema`. (§5)
6. Rollups are **cache-invalidating** and should be batched at chapter boundaries. (§2)
7. Client-side JSON validation with retry is **mandatory**, per Google's own guidance. (§1)
8. Log `usageMetadata.cachedContentTokenCount` per call from day one — it is the only way to know whether the assembly ordering is actually working. (§2)

### Bonus, not asked for but relevant to the map

`GenerationConfig.seed` exists (discovery doc): *"By setting a seed, you can make the model's output mostly deterministic … However, it's not a guaranteed absolute deterministic behavior."* This is the mechanism behind `CONTEXT.md`'s **baked edition** and **compiled edition** — persist the seed alongside the digests and a run becomes approximately reproducible. "Mostly" and "not guaranteed" mean it cannot be the *only* mechanism; persisting the prose remains necessary.

---

## Open items to re-verify from an unblocked machine

1. **Everything marked [doc-only]** — particularly the 4,096-token cache minimum, the 1-hour default TTL, and the model context/output limits.
2. **Gemini Developer API pricing** (<https://ai.google.dev/gemini-api/docs/pricing>) — the numbers here are Vertex's.
3. **Per-model RPM/TPM** from AI Studio for the chosen models at the project's actual tier.
4. **Interactions API status** — GA or beta. The doc corpus contradicts itself and it is absent from the published discovery document.
5. **Whether `responseFormat` is honoured on `generateContent`** as well as on the Interactions API — the discovery doc lists it in `GenerationConfig`, which implies yes, but a one-line curl would settle it and settles §5's recommendation.
6. **Streaming-chunk shape under a schema** — the doc's "valid partial JSON strings" claim deserves a 20-line spike before the reader UI is designed around it.
