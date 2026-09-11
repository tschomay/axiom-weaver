/**
 * The one adapter the wire format lives behind (Gemini research §5, constraint 5).
 *
 * Everything above this module names fields and ordering, never `responseSchema` versus
 * `responseJsonSchema` versus `responseFormat` — three generations of the same field exist
 * simultaneously in the live API and two of them are already marked deprecated. Keeping the choice
 * in one place means the contract survives the next rename.
 *
 * No tools are ever passed. Function calling is not a mid-generation callback — the model emits a
 * `functionCall` part and *ends the turn* — so a `lookup(entity)` tool would mean N+1 round trips
 * per scene and a segmented reader stream (research §4). Retrieval is the deterministic join
 * instead.
 */

/** Finish reasons the compiler branches on. Anything else is treated as `OTHER`. */
export const FINISH_REASONS = [
  'STOP',
  'MAX_TOKENS',
  'MALFORMED_RESPONSE',
  'RECITATION',
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'OTHER',
] as const;

export type FinishReason = (typeof FINISH_REASONS)[number];

export interface ModelUsage {
  readonly prompt_tokens: number;
  readonly output_tokens: number;
  /**
   * `usageMetadata.cachedContentTokenCount`.
   *
   * Logged from day one per the research's constraint 8: it is the only way to know whether the
   * assembly ordering is actually working, and an ordering mistake is invisible in the prose.
   */
  readonly cached_tokens: number;
  /**
   * `usageMetadata.thoughtsTokenCount`.
   *
   * Counted against the same `maxOutputTokens` cap as the visible response (confirmed against the
   * live endpoint, not doc-only: a 60-token cap at `thinking_level: MEDIUM` returned 82 thinking
   * tokens and zero output). Without this logged, a `MAX_TOKENS` finish with output well under
   * budget looks inexplicable — this is the number that explains it.
   */
  readonly thoughts_tokens: number;
}

export interface ModelRequest {
  readonly model: string;
  /** The explicit-cache header. Stable for a whole read. */
  readonly systemInstruction: string;
  /** Everything after the header, in payload order. */
  readonly contents: string;
  readonly responseJsonSchema: Record<string, unknown>;
  readonly maxOutputTokens: number;
  readonly thinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ModelResponse {
  /** The raw response text, which under truncation is unparseable JSON. */
  readonly text: string;
  readonly finish_reason: FinishReason;
  readonly usage: ModelUsage;
  /**
   * The model that actually generated this response — not necessarily the one requested. A
   * capacity-outage fallback (see `WRITER_MODEL_FALLBACK`) means the request's `model` and the
   * response's `model` can differ; callers report this one so the debug view stays honest about
   * what actually wrote the scene.
   */
  readonly model: string;
}

export interface ModelClient {
  generate(request: ModelRequest): Promise<ModelResponse>;
}

/** The models the research's §7 split recommends. */
export const WRITER_MODEL = 'gemini-3.7-flash';
/**
 * Same-price previous-generation Flash (Gemini capabilities research §7: *"watch for the
 * schema-constrained decode-loop report on this model; if the POC reproduces it,
 * `gemini-3.6-flash` is a same-price fallback"*). That reasoning generalizes past the one bug it
 * was named for: a different model is also a different capacity pool, so it is exactly what
 * `GeminiClient.generate` reaches for when `WRITER_MODEL` itself is unavailable (confirmed live —
 * `gemini-3.7-flash` returned `503 UNAVAILABLE` for several minutes straight during this session).
 */
export const WRITER_MODEL_FALLBACK = 'gemini-3.6-flash';
export const FALLBACK_MODEL = 'gemini-3.5-flash-lite';

/**
 * The model to reach for when what is scarce is *requests*, not quality.
 *
 * On the project's free-tier key, `gemini-3.7-flash` and `gemini-3.6-flash` share a 20
 * requests/day ceiling — a single 14-scene telling exhausts it — while `gemini-3.5-flash-lite`
 * carries a much larger daily allowance. It is the wrong model to judge prose by and the right
 * one to prove a loop with, so it is opt-in only: nothing selects it automatically, because a
 * silent quality downgrade is worse than a rate limit. Set `AXIOM_WRITER_MODEL` to choose it (see
 * `AGENTS.md`), and the run report's per-call `model` field records what actually wrote each
 * scene.
 */
export const TESTING_WRITER_MODEL = FALLBACK_MODEL;

/**
 * The models a request may ask for by name.
 *
 * An allowlist rather than a free-text model field: a caller naming any model it likes would
 * point the project's key at anything the API serves, and the three here are the only ones the
 * project has a reason to run — the writer model, its same-price capacity fallback, and the
 * request-headroom model an author opts into when the day's allowance is gone.
 */
export const SELECTABLE_WRITER_MODELS: readonly string[] = [
  WRITER_MODEL,
  WRITER_MODEL_FALLBACK,
  TESTING_WRITER_MODEL,
];

export function isSelectableWriterModel(model: string): boolean {
  return SELECTABLE_WRITER_MODELS.includes(model);
}

/**
 * What a failed call says about the key's *daily* allowance, or `null` for any other failure.
 *
 * This is the one failure a caller can do something about beyond waiting. A per-minute allowance
 * clears in a minute; a per-day one clears at midnight Pacific, and `GeminiClient` has already
 * tried the capacity fallback by the time this is reachable — so the only way past it today is a
 * model with its own, larger allowance.
 *
 * Reaching for that model is never this code's decision. A silent quality downgrade is worse than
 * a rate limit (AGENTS.md), so this only reports the failure precisely enough for a surface to
 * put the choice to the person reading the prose.
 */
export interface DailyQuotaFailure {
  readonly detail: string;
  /** The model that ran out — the last one the client tried. */
  readonly model: string;
  readonly retry_after_ms: number | null;
}

export function dailyQuotaFailure(error: unknown, model: string): DailyQuotaFailure | null {
  if (!(error instanceof RetryableStatusError) || !error.exhaustedForToday) return null;
  return { detail: error.message, model, retry_after_ms: error.retryAfterMs };
}

/**
 * The same failure in the shape a surface renders: what ran out, and what could be asked instead.
 *
 * `retry_with_model` is `null` once the caller is already on the headroom model — there is nothing
 * further to offer, and a surface that kept offering would be pretending otherwise. Built here so
 * the author-time and read-time paths put the identical choice to a person.
 */
export interface QuotaOffer {
  readonly model: string;
  readonly detail: string;
  readonly retry_after_ms: number | null;
  readonly retry_with_model: string | null;
}

export function quotaOffer(
  model: string,
  detail: string,
  retryAfterMs: number | null = null,
): QuotaOffer {
  return {
    model,
    detail,
    retry_after_ms: retryAfterMs,
    retry_with_model: model === TESTING_WRITER_MODEL ? null : TESTING_WRITER_MODEL,
  };
}

/**
 * Which model the writer call should use: `AXIOM_WRITER_MODEL` if set, else `WRITER_MODEL`.
 *
 * Deliberately an override of the *request*, not a rewrite inside the client: a client that
 * quietly answered on a different model than it was asked for would make `compileScene` log a
 * `model_fallback` that never happened, and put a falsehood in every run report.
 */
export function writerModelFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env['AXIOM_WRITER_MODEL'];
  return override === undefined || override === '' ? WRITER_MODEL : override;
}

/**
 * The prefix below which Gemini 3.x caches nothing, implicitly or explicitly
 * (`docs/research/gemini-capabilities.md` §2 — 4,096 for Gemini 3.x, 2,048 for 2.0/2.5).
 *
 * It is a property of the model, not of this code, and it is the reason a short story can do
 * everything ADR 0008 asks and still never see a cache hit: the assembler can order the prompt
 * perfectly and the stable prefix still has to be big enough to qualify. `npm run cache-check`
 * measures a story against it without spending a call.
 */
export const MIN_CACHEABLE_TOKENS = 4096;

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** HTTP statuses worth a retry or a model swap — capacity/availability, not a real request bug. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Backoff between attempts: exponential, with full jitter, and only ever a floor under whatever
 * the API itself asked for.
 *
 * Exponential because a service that is overloaded now is likely still overloaded 1.5 seconds
 * from now, and jittered because every scene of a run retries on the same schedule otherwise —
 * a compile that retried in lockstep would arrive back at the endpoint as a small thundering
 * herd of one. `Retry-After` and `RetryInfo` override both: an API that says when to come back
 * knows better than any local schedule.
 */
export const RETRY_BACKOFF_MS = 1500;
export const RETRY_BACKOFF_MULTIPLIER = 3;

/** Never wait longer than this between attempts, whatever the schedule computes. */
export const MAX_BACKOFF_MS = 30_000;

/**
 * How long one request may take before it is abandoned as hung.
 *
 * A writer call is seconds (27.4s mean on the first live run, worst case 36.6s); two minutes is
 * far outside that. Without it a socket that never answers stalls a scene forever — the run loop
 * would offer the reader the Baked edition at 90 seconds (ADR 0014 §7) and then wait on that
 * request for the rest of the process's life.
 */
export const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Backoff for attempt `n` (0-based), with full jitter, floored by what the API asked for.
 *
 * Full jitter — a uniform draw from `[0, delay]` rather than `delay ± something` — is the variant
 * that actually decorrelates retries; the halved average wait is a bonus, not the point.
 */
export function backoffFor(
  attempt: number,
  askedForMs: number | null,
  random: () => number = Math.random,
): number {
  const scheduled = Math.min(
    RETRY_BACKOFF_MS * RETRY_BACKOFF_MULTIPLIER ** attempt,
    MAX_BACKOFF_MS,
  );
  const jittered = Math.round(random() * scheduled);
  return Math.max(jittered, askedForMs ?? 0);
}

/**
 * Thrown only for a status in `RETRYABLE_STATUSES`, so callers can tell it apart from a real bug.
 *
 * A 429 carries two things worth reading rather than guessing at: how long the API says to wait,
 * and whether what ran out was a per-minute allowance or the day's. They are different failures —
 * one clears in a minute, the other at midnight Pacific — and on a 20-requests/day key, spending
 * a retry on the second is spending 5% of the day's budget to be told the same thing twice.
 */
class RetryableStatusError extends Error {
  /** `RetryInfo.retryDelay` from the response body, in milliseconds, when the API sent one. */
  readonly retryAfterMs: number | null;
  /** True when a per-day quota is exhausted: waiting will not help, only another model will. */
  readonly exhaustedForToday: boolean;

  constructor(
    message: string,
    options: { retryAfterMs?: number | null; exhaustedForToday?: boolean } = {},
  ) {
    super(message);
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.exhaustedForToday = options.exhaustedForToday ?? false;
  }
}

/** Never wait longer than this on the API's own say-so, whatever the body or header claims. */
const MAX_HONORED_RETRY_MS = 60_000;

/** `Retry-After`, in either of its two legal forms: delta-seconds, or an HTTP date. */
export function retryAfterHeaderMs(
  headers: Headers,
  now: () => number = Date.now,
): number | null {
  const raw = headers.get('retry-after');
  if (raw === null || raw.trim() === '') return null;

  const seconds = Number.parseFloat(raw);
  if (Number.isFinite(seconds)) {
    return seconds <= 0 ? 0 : Math.min(Math.ceil(seconds * 1000), MAX_HONORED_RETRY_MS);
  }

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now()), MAX_HONORED_RETRY_MS);
}

/**
 * Read a 429's own account of itself: `RetryInfo.retryDelay`, and whether the exhausted quota is
 * a per-day one. Both are best-effort — an unparseable body just means the defaults apply.
 */
export function readQuotaFailure(body: string): {
  retryAfterMs: number | null;
  exhaustedForToday: boolean;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { retryAfterMs: null, exhaustedForToday: false };
  }

  const details = (parsed as { error?: { details?: unknown } })?.error?.details;
  if (!Array.isArray(details)) return { retryAfterMs: null, exhaustedForToday: false };

  let retryAfterMs: number | null = null;
  let exhaustedForToday = false;

  for (const detail of details as Array<Record<string, unknown>>) {
    const type = typeof detail['@type'] === 'string' ? (detail['@type'] as string) : '';

    if (type.endsWith('RetryInfo') && typeof detail['retryDelay'] === 'string') {
      const seconds = Number.parseFloat((detail['retryDelay'] as string).replace(/s$/, ''));
      if (Number.isFinite(seconds) && seconds > 0) {
        retryAfterMs = Math.min(Math.ceil(seconds * 1000), MAX_HONORED_RETRY_MS);
      }
    }

    if (type.endsWith('QuotaFailure') && Array.isArray(detail['violations'])) {
      for (const violation of detail['violations'] as Array<Record<string, unknown>>) {
        const quotaId = typeof violation['quotaId'] === 'string' ? violation['quotaId'] : '';
        const metric = typeof violation['quotaMetric'] === 'string' ? violation['quotaMetric'] : '';
        if (/PerDay/i.test(quotaId) || /per_day/i.test(metric)) exhaustedForToday = true;
      }
    }
  }

  return { retryAfterMs, exhaustedForToday };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A client-side floor on how often requests leave, so a per-minute quota is respected rather than
 * discovered.
 *
 * The free tier allows 5 requests/minute on the writer models. A sequential compile is usually
 * slower than that on its own, but a scene that retries twice is not, and a `429` spent finding
 * that out costs a request from the day's 20. Off unless a caller asks for it
 * (`AXIOM_REQUESTS_PER_MINUTE`): a default that silently paced every run would be a surprising
 * thing for a library to do, and the number is a property of the key, not of the code.
 */
export class RequestPacer {
  private readonly minIntervalMs: number;
  private next = 0;

  constructor(requestsPerMinute: number | null) {
    this.minIntervalMs =
      requestsPerMinute === null || requestsPerMinute <= 0 ? 0 : 60_000 / requestsPerMinute;
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): RequestPacer {
    const raw = env['AXIOM_REQUESTS_PER_MINUTE'];
    const parsed = raw === undefined || raw === '' ? Number.NaN : Number.parseFloat(raw);
    return new RequestPacer(Number.isFinite(parsed) ? parsed : null);
  }

  /** Resolves when the next request is allowed to leave. */
  async wait(now: () => number = Date.now, pause: (ms: number) => Promise<void> = sleep): Promise<void> {
    if (this.minIntervalMs === 0) return;
    const at = now();
    const waitFor = Math.max(0, this.next - at);
    this.next = Math.max(at, this.next) + this.minIntervalMs;
    if (waitFor > 0) await pause(waitFor);
  }
}

/**
 * The live client.
 *
 * `responseJsonSchema` is used rather than the current `responseFormat`: the research left
 * "whether `responseFormat` is honoured on `generateContent`" as an open item to verify against a
 * live endpoint, and picking the surface that is present in the published discovery document is
 * the one that can be checked from here. When that open item is settled, this is the single
 * function that changes.
 *
 * A transport-level failure gets the same "one bounded retry" shape every finish-reason failure
 * already gets in `compile-scene.ts`, applied one layer below it: retry the same model once after
 * a short backoff, then try `WRITER_MODEL_FALLBACK` once. Only a status in `RETRYABLE_STATUSES`
 * triggers this — a schema-rejection 400 or an auth 401 is a real bug, not capacity, and retrying
 * or swapping models would only hide it. If every attempt is exhausted, this still throws; unlike
 * a finish-reason failure, `compileScene` has no `ModelResponse` to build a conservative digest
 * from at that point, so surfacing the failure loudly is more honest than inventing one.
 */
export class GeminiClient implements ModelClient {
  private readonly apiKey: string;
  private readonly pacer: RequestPacer;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string,
    options: { pacer?: RequestPacer; timeoutMs?: number } = {},
  ) {
    this.apiKey = apiKey;
    this.pacer = options.pacer ?? new RequestPacer(null);
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): GeminiClient | null {
    const key = env['GEMINI_API_KEY'];
    if (key === undefined || key === '') return null;
    return new GeminiClient(key, { pacer: RequestPacer.fromEnv(env) });
  }

  /**
   * `models.countTokens` — what a prompt actually costs as input, rather than what the
   * assembler's 4-chars-per-token estimate guesses.
   *
   * Worth having its own method for two reasons the research names: the response schema is billed
   * as input on every call and is not cacheable (§1 finding 4, *"keep it lean; measure it with
   * countTokens"*), and whether a prefix clears `MIN_CACHEABLE_TOKENS` is a question an estimate
   * cannot settle. It is a separate endpoint from `generateContent` and generates nothing, which
   * is what makes it usable on a key whose generate quota is spent.
   */
  async countTokens(
    model: string,
    parts: { systemInstruction?: string; contents: string },
  ): Promise<number> {
    await this.pacer.wait();
    const response = await this.fetchWithTimeout(`${ENDPOINT}/${model}:countTokens`, {
      generateContentRequest: {
        model: `models/${model}`,
        ...(parts.systemInstruction === undefined || parts.systemInstruction === ''
          ? {}
          : { systemInstruction: { parts: [{ text: parts.systemInstruction }] } }),
        contents: [{ role: 'user', parts: [{ text: parts.contents }] }],
      },
    });

    if (!response.ok) {
      throw new Error(`Gemini ${model} countTokens returned ${response.status}: ${await response.text()}`);
    }
    const body = (await response.json()) as { totalTokens?: number };
    return body.totalTokens ?? 0;
  }

  /** One POST, abandoned if the endpoint never answers. */
  private async fetchWithTimeout(url: string, body: unknown): Promise<Response> {
    const abort = AbortSignal.timeout(this.timeoutMs);
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal: abort,
      });
    } catch (error) {
      // A timeout is a capacity failure, not a request bug: it retries and swaps model like one.
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new RetryableStatusError(`Gemini request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    }
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    try {
      return await this.attempt(request, request.model);
    } catch (error) {
      if (!(error instanceof RetryableStatusError)) throw error;

      // A day's quota does not come back in a minute. Skip the same-model retry entirely and go
      // straight to a different model, which is a different quota bucket.
      if (error.exhaustedForToday) return await this.swapModel(request, error);

      await sleep(backoffFor(0, error.retryAfterMs));

      try {
        return await this.attempt(request, request.model);
      } catch (retried) {
        if (!(retried instanceof RetryableStatusError)) throw retried;
        if (retried.exhaustedForToday) return await this.swapModel(request, retried);
        // The second wait is longer than the first, and the fallback model deserves to arrive at
        // an endpoint that has had a moment rather than immediately after two failures.
        await sleep(backoffFor(1, retried.retryAfterMs));
        return await this.swapModel(request, retried);
      }
    }
  }

  /** The last resort: the same request on the capacity fallback, or the failure as it stands. */
  private async swapModel(
    request: ModelRequest,
    error: RetryableStatusError,
  ): Promise<ModelResponse> {
    if (request.model === WRITER_MODEL_FALLBACK) throw error;
    return this.attempt(request, WRITER_MODEL_FALLBACK);
  }

  private async attempt(request: ModelRequest, model: string): Promise<ModelResponse> {
    await this.pacer.wait();
    const response = await this.fetchWithTimeout(`${ENDPOINT}/${model}:generateContent`, {
      systemInstruction: { parts: [{ text: request.systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: request.contents }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: request.responseJsonSchema,
        maxOutputTokens: request.maxOutputTokens,
        thinkingConfig: { thinkingLevel: request.thinkingLevel },
      },
    });

    if (!response.ok) {
      const body = await response.text();
      const message = `Gemini ${model} returned ${response.status}: ${body}`;
      if (RETRYABLE_STATUSES.has(response.status)) {
        const quota: { retryAfterMs: number | null; exhaustedForToday: boolean } =
          response.status === 429
            ? readQuotaFailure(body)
            : { retryAfterMs: null, exhaustedForToday: false };
        throw new RetryableStatusError(message, {
          ...quota,
          // A `Retry-After` header outranks the body: it is the standard place to say it, and
          // some 429s and 503s carry it without any RetryInfo detail at all.
          retryAfterMs: retryAfterHeaderMs(response.headers) ?? quota.retryAfterMs,
        });
      }
      throw new Error(message);
    }

    const body = (await response.json()) as GenerateContentResponse;
    const candidate = body.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('');

    return {
      text,
      finish_reason: normalizeFinishReason(candidate?.finishReason),
      model: body.modelVersion ?? model,
      usage: {
        prompt_tokens: body.usageMetadata?.promptTokenCount ?? 0,
        output_tokens: body.usageMetadata?.candidatesTokenCount ?? 0,
        cached_tokens: body.usageMetadata?.cachedContentTokenCount ?? 0,
        thoughts_tokens: body.usageMetadata?.thoughtsTokenCount ?? 0,
      },
    };
  }
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
}

function normalizeFinishReason(raw: string | undefined): FinishReason {
  if (raw === undefined) return 'STOP';
  const known = (FINISH_REASONS as readonly string[]).includes(raw);
  return known ? (raw as FinishReason) : 'OTHER';
}

/**
 * A client that replays recorded responses instead of calling the API.
 *
 * This is not a mock in the testing sense — it is how a scene compiles end to end in a session
 * with no API credentials, which the read-time run loop will also need for replaying a Compiled
 * edition. Responses are keyed by scene id and consumed in order, so a recording can carry a
 * truncation followed by its retry.
 */
export class RecordedClient implements ModelClient {
  private readonly responses: Map<string, ModelResponse[]>;
  readonly requests: ModelRequest[] = [];

  constructor(responses: Record<string, ModelResponse[]>) {
    this.responses = new Map(Object.entries(responses));
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const key = this.keyFor(request);
    const queue = this.responses.get(key);
    const next = queue?.shift();
    if (next === undefined) {
      throw new Error(`No recorded response left for "${key}"`);
    }
    return next;
  }

  /**
   * Which recording a request draws from.
   *
   * The scene id appears verbatim in the assembled volatile tail (`SCENE CARD — <id>`), so a
   * recording can be keyed by it without the caller threading an extra parameter through the call
   * path purely for the benefit of the stub.
   */
  private keyFor(request: ModelRequest): string {
    const match = /SCENE CARD — (\S+)/.exec(request.contents);
    const scene = match?.[1] ?? 'unknown';
    return request.model === FALLBACK_MODEL ? `${scene}:fallback` : scene;
  }
}
