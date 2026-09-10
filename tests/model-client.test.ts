import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiClient, WRITER_MODEL, WRITER_MODEL_FALLBACK, type ModelRequest } from '@/writer/model-client';

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
