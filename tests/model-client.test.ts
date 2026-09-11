import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GeminiClient,
  MAX_BACKOFF_MS,
  RETRY_BACKOFF_MS,
  RequestPacer,
  TESTING_WRITER_MODEL,
  WRITER_MODEL,
  WRITER_MODEL_FALLBACK,
  backoffFor,
  dailyQuotaFailure,
  isSelectableWriterModel,
  quotaOffer,
  readQuotaFailure,
  retryAfterHeaderMs,
  writerModelFromEnv,
  type ModelRequest,
} from '@/writer/model-client';

/**
 * Transport-level retry and the `WRITER_MODEL_FALLBACK` swap (`src/writer/model-client.ts`).
 *
 * Confirmed live during this session: `gemini-3.7-flash` returned `503 UNAVAILABLE` for several
 * minutes straight. `GeminiClient.generate` never crashes a compile over that alone — it retries
 * the requested model once, then tries `WRITER_MODEL_FALLBACK` once, and only a status outside
 * `RETRYABLE_STATUSES` (a real request bug, not capacity) skips straight to throwing.
 */

function baseRequest(model: string = WRITER_MODEL): ModelRequest {
  return {
    model,
    systemInstruction: 'header',
    contents: 'body',
    responseJsonSchema: {},
    maxOutputTokens: 100,
    thinkingLevel: 'MEDIUM',
  };
}

function statusResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function okBody(overrides: { finishReason?: string; modelVersion?: string } = {}) {
  return {
    candidates: [
      { content: { parts: [{ text: '{"ok":true}' }] }, finishReason: overrides.finishReason ?? 'STOP' },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      cachedContentTokenCount: 0,
      thoughtsTokenCount: 0,
    },
    modelVersion: overrides.modelVersion ?? WRITER_MODEL,
  };
}

/**
 * The shape a real 429 arrives in — copied from the one that ended the first live run, with the
 * daily-quota violation and the API's own retry delay both present.
 */
function quotaBody(options: { perDay: boolean; retryDelay?: string }) {
  return {
    error: {
      code: 429,
      message: 'You exceeded your current quota',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        ...(options.retryDelay === undefined
          ? []
          : [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: options.retryDelay }]),
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
              quotaId: options.perDay
                ? 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'
                : 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
              quotaValue: options.perDay ? '20' : '5',
            },
          ],
        },
      ],
    },
  };
}

describe('GeminiClient — transport-level retry and model fallback', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Starts the call, drains its backoff timer(s), and hands back the (possibly rejected) result. */
  async function run(client: GeminiClient, request: ModelRequest) {
    const result = client.generate(request);
    // A caller who only inspects `result` after the timers drain would otherwise leave the
    // rejection briefly unobserved — attach a no-op handler now; it doesn't consume the promise.
    result.catch(() => {});
    await vi.runAllTimersAsync();
    return result;
  }

  it('returns the response, with its model, straight through on success', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(200, okBody()));
    const client = new GeminiClient('key');

    const result = await run(client, baseRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(WRITER_MODEL);
    expect(result.model).toBe(WRITER_MODEL);
    expect(result.finish_reason).toBe('STOP');
  });

  it('retries the same model once after a 503 before giving up on it', async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(503, { error: { message: 'overloaded' } }))
      .mockResolvedValueOnce(statusResponse(200, okBody()));
    const client = new GeminiClient('key');

    const result = await run(client, baseRequest());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(WRITER_MODEL);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(WRITER_MODEL);
    expect(result.finish_reason).toBe('STOP');
  });

  it('falls back to WRITER_MODEL_FALLBACK after two consecutive retryable failures', async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(503, { error: { message: 'overloaded' } }))
      .mockResolvedValueOnce(statusResponse(503, { error: { message: 'still overloaded' } }))
      .mockResolvedValueOnce(statusResponse(200, okBody({ modelVersion: WRITER_MODEL_FALLBACK })));
    const client = new GeminiClient('key');

    const result = await run(client, baseRequest());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toContain(WRITER_MODEL_FALLBACK);
    expect(result.model).toBe(WRITER_MODEL_FALLBACK);
  });

  it('throws if the fallback model also fails, without a further retry loop', async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(503, { error: {} }))
      .mockResolvedValueOnce(statusResponse(503, { error: {} }))
      .mockResolvedValueOnce(statusResponse(500, { error: {} }));
    const client = new GeminiClient('key');

    await expect(run(client, baseRequest())).rejects.toThrow(
      `Gemini ${WRITER_MODEL_FALLBACK} returned 500`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('spends no retry on the same model when the day’s quota is gone', async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(429, quotaBody({ perDay: true, retryDelay: '57s' })))
      .mockResolvedValueOnce(statusResponse(200, okBody({ modelVersion: WRITER_MODEL_FALLBACK })));
    const client = new GeminiClient('key');

    const result = await run(client, baseRequest());

    // Two calls, not three: nothing frees up before midnight, so the second call is a different
    // model — a different quota bucket — rather than the same one asked again.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(WRITER_MODEL_FALLBACK);
    expect(result.model).toBe(WRITER_MODEL_FALLBACK);
  });

  it('leaves a spent daily quota recognisable, with the headroom model to offer', async () => {
    // Both buckets gone: the writer model and the capacity fallback share the day's 20 requests.
    fetchMock
      .mockResolvedValueOnce(statusResponse(429, quotaBody({ perDay: true, retryDelay: '57s' })))
      .mockResolvedValueOnce(statusResponse(429, quotaBody({ perDay: true, retryDelay: '57s' })));
    const client = new GeminiClient('key');

    const thrown: unknown = await run(client, baseRequest()).catch((error: unknown) => error);
    const failure = dailyQuotaFailure(thrown, WRITER_MODEL);

    expect(failure).not.toBeNull();
    expect(failure?.model).toBe(WRITER_MODEL);
    // The offer, not the taking of it: nothing here selects a model, it only says which one is
    // left to ask for (AGENTS.md — never degrade the writer model silently to dodge a quota).
    expect(quotaOffer(failure!.model, failure!.detail).retry_with_model).toBe(
      TESTING_WRITER_MODEL,
    );
  });

  it('does not mistake a per-minute quota, or an outage, for the day being gone', async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(503, { error: {} }))
      .mockResolvedValueOnce(statusResponse(503, { error: {} }))
      .mockResolvedValueOnce(statusResponse(500, { error: {} }));
    const client = new GeminiClient('key');

    const thrown: unknown = await run(client, baseRequest()).catch((error: unknown) => error);

    // A 500 clears on its own; the day's quota does not. Offering a weaker model for the first
    // would be trading prose quality away for nothing.
    expect(dailyQuotaFailure(thrown, WRITER_MODEL)).toBeNull();
    expect(dailyQuotaFailure(new Error('something else'), WRITER_MODEL)).toBeNull();
  });

  it('waits the API’s own retry delay on a per-minute quota, then tries again', async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(429, quotaBody({ perDay: false, retryDelay: '57s' })))
      .mockResolvedValueOnce(statusResponse(200, okBody()));
    const client = new GeminiClient('key');

    const result = await run(client, baseRequest());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(WRITER_MODEL);
    expect(result.finish_reason).toBe('STOP');
  });

  it('abandons a hung request and treats the timeout as capacity, not as a bug', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    fetchMock
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(statusResponse(200, okBody()));
    const client = new GeminiClient('key', { timeoutMs: 50 });

    const result = await run(client, baseRequest());

    // Retried like a 503 rather than crashing the compile: a socket that never answers is a
    // capacity failure, and without the timeout the scene would wait on it forever.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.finish_reason).toBe('STOP');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: expect.anything() });
  });

  it('does not fall back a second time when the fallback model is what was requested', async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(503, { error: {} }))
      .mockResolvedValueOnce(statusResponse(503, { error: {} }));
    const client = new GeminiClient('key');

    await expect(run(client, baseRequest(WRITER_MODEL_FALLBACK))).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on a non-retryable status, without retrying or falling back', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(400, { error: { message: 'bad schema' } }));
    const client = new GeminiClient('key');

    await expect(run(client, baseRequest())).rejects.toThrow(`Gemini ${WRITER_MODEL} returned 400`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('reading a 429 rather than guessing at it', () => {
  it('picks out the API’s own retry delay and caps it', () => {
    expect(readQuotaFailure(JSON.stringify(quotaBody({ perDay: false, retryDelay: '57s' })))).toEqual({
      retryAfterMs: 57_000,
      exhaustedForToday: false,
    });
    expect(
      readQuotaFailure(JSON.stringify(quotaBody({ perDay: false, retryDelay: '86400s' })))
        .retryAfterMs,
    ).toBe(60_000);
  });

  it('tells a per-day quota from a per-minute one', () => {
    expect(readQuotaFailure(JSON.stringify(quotaBody({ perDay: true }))).exhaustedForToday).toBe(
      true,
    );
    expect(readQuotaFailure(JSON.stringify(quotaBody({ perDay: false }))).exhaustedForToday).toBe(
      false,
    );
  });

  it('shrugs off a body it cannot read', () => {
    expect(readQuotaFailure('not json')).toEqual({ retryAfterMs: null, exhaustedForToday: false });
    expect(readQuotaFailure('{}')).toEqual({ retryAfterMs: null, exhaustedForToday: false });
  });
});

describe('choosing the writer model', () => {
  it('is WRITER_MODEL unless something deliberately says otherwise', () => {
    expect(writerModelFromEnv({})).toBe(WRITER_MODEL);
    expect(writerModelFromEnv({ AXIOM_WRITER_MODEL: '' })).toBe(WRITER_MODEL);
    expect(writerModelFromEnv({ AXIOM_WRITER_MODEL: TESTING_WRITER_MODEL })).toBe(
      TESTING_WRITER_MODEL,
    );
  });
});

describe('backoff between attempts', () => {
  it('grows exponentially and is capped', () => {
    // Full jitter draws from [0, scheduled]; `random: () => 1` reads out the ceiling.
    expect(backoffFor(0, null, () => 1)).toBe(RETRY_BACKOFF_MS);
    expect(backoffFor(1, null, () => 1)).toBeGreaterThan(RETRY_BACKOFF_MS);
    expect(backoffFor(9, null, () => 1)).toBe(MAX_BACKOFF_MS);
  });

  it('jitters, so a run’s scenes do not retry in lockstep', () => {
    expect(backoffFor(2, null, () => 0)).toBe(0);
    expect(backoffFor(2, null, () => 0.5)).toBeLessThan(backoffFor(2, null, () => 1));
  });

  it('never waits less than the API asked for', () => {
    // The jittered schedule can draw near zero; an explicit retry delay is a floor, not a hint.
    expect(backoffFor(0, 57_000, () => 0)).toBe(57_000);
    expect(backoffFor(0, 100, () => 1)).toBe(RETRY_BACKOFF_MS);
  });
});

describe('Retry-After', () => {
  const header = (value: string) => new Headers({ 'retry-after': value });

  it('reads delta-seconds', () => {
    expect(retryAfterHeaderMs(header('30'))).toBe(30_000);
    expect(retryAfterHeaderMs(header('0'))).toBe(0);
  });

  it('reads an HTTP date, relative to now', () => {
    const now = Date.parse('2026-09-10T12:00:00Z');
    expect(retryAfterHeaderMs(header('Thu, 10 Sep 2026 12:00:20 GMT'), () => now)).toBe(20_000);
    // A date already past means "now", never a negative wait.
    expect(retryAfterHeaderMs(header('Thu, 10 Sep 2026 11:59:00 GMT'), () => now)).toBe(0);
  });

  it('caps whatever it is told, and ignores what it cannot read', () => {
    expect(retryAfterHeaderMs(header('99999'))).toBe(60_000);
    expect(retryAfterHeaderMs(header('soon'))).toBeNull();
    expect(retryAfterHeaderMs(new Headers())).toBeNull();
  });
});

describe('request pacing', () => {
  it('does nothing until a rate is set', async () => {
    const waits: number[] = [];
    const pacer = new RequestPacer(null);
    for (let i = 0; i < 3; i += 1) {
      await pacer.wait(() => 0, async (ms) => void waits.push(ms));
    }
    expect(waits).toEqual([]);
  });

  it('spaces requests to fit the rate, and only when they would arrive too soon', async () => {
    const waits: number[] = [];
    const pause = async (ms: number) => void waits.push(ms);
    const pacer = new RequestPacer(5); // 5/minute — the free tier's writer-model limit
    let clock = 0;

    await pacer.wait(() => clock, pause); // first one leaves immediately
    await pacer.wait(() => clock, pause); // second is 12s early
    clock = 60_000; // a minute passes
    await pacer.wait(() => clock, pause); // third has waited long enough on its own

    expect(waits).toEqual([12_000]);
  });

  it('reads the rate from the environment, and treats nonsense as unset', () => {
    expect(new RequestPacer(5)).toBeInstanceOf(RequestPacer);
    expect(RequestPacer.fromEnv({ AXIOM_REQUESTS_PER_MINUTE: 'lots' })).toBeInstanceOf(RequestPacer);
    expect(RequestPacer.fromEnv({})).toBeInstanceOf(RequestPacer);
  });
});

describe('what a surface may ask for', () => {
  it('offers nothing further once the caller is already on the headroom model', () => {
    // There is no fourth model to fall to, and a prompt that kept offering one would be pretending
    // the author still had a choice.
    expect(quotaOffer(TESTING_WRITER_MODEL, 'spent').retry_with_model).toBeNull();
  });

  it('will only call a model the project has a reason to run', () => {
    expect(isSelectableWriterModel(WRITER_MODEL)).toBe(true);
    expect(isSelectableWriterModel(WRITER_MODEL_FALLBACK)).toBe(true);
    expect(isSelectableWriterModel(TESTING_WRITER_MODEL)).toBe(true);
    // A request naming any model it likes would point the project's key at anything the API serves.
    expect(isSelectableWriterModel('gemini-9-ultra')).toBe(false);
    expect(isSelectableWriterModel('')).toBe(false);
  });
});
