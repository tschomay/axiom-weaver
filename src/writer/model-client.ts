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

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** HTTP statuses worth a retry or a model swap — capacity/availability, not a real request bug. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_BACKOFF_MS = 1500;

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

/** Never wait longer than this on the API's own say-so, whatever the body claims. */
const MAX_HONORED_RETRY_MS = 60_000;

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

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): GeminiClient | null {
    const key = env['GEMINI_API_KEY'];
    return key === undefined || key === '' ? null : new GeminiClient(key);
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    try {
      return await this.attempt(request, request.model);
    } catch (error) {
      if (!(error instanceof RetryableStatusError)) throw error;

      // A day's quota does not come back in a minute. Skip the same-model retry entirely and go
      // straight to a different model, which is a different quota bucket.
      if (error.exhaustedForToday) return await this.swapModel(request, error);

      await sleep(error.retryAfterMs ?? RETRY_BACKOFF_MS);

      try {
        return await this.attempt(request, request.model);
      } catch (retried) {
        if (!(retried instanceof RetryableStatusError)) throw retried;
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
    const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: request.contents }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: request.responseJsonSchema,
          maxOutputTokens: request.maxOutputTokens,
          thinkingConfig: { thinkingLevel: request.thinkingLevel },
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      const message = `Gemini ${model} returned ${response.status}: ${body}`;
      if (RETRYABLE_STATUSES.has(response.status)) {
        throw new RetryableStatusError(
          message,
          response.status === 429 ? readQuotaFailure(body) : {},
        );
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
