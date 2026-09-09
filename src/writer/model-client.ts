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
}

export interface ModelClient {
  generate(request: ModelRequest): Promise<ModelResponse>;
}

/** The models the research's §7 split recommends. */
export const WRITER_MODEL = 'gemini-3.7-flash';
export const FALLBACK_MODEL = 'gemini-3.5-flash-lite';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The live client.
 *
 * `responseJsonSchema` is used rather than the current `responseFormat`: the research left
 * "whether `responseFormat` is honoured on `generateContent`" as an open item to verify against a
 * live endpoint, and picking the surface that is present in the published discovery document is
 * the one that can be checked from here. When that open item is settled, this is the single
 * function that changes.
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
    const response = await fetch(`${ENDPOINT}/${request.model}:generateContent`, {
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
      throw new Error(
        `Gemini ${request.model} returned ${response.status}: ${await response.text()}`,
      );
    }

    const body = (await response.json()) as GenerateContentResponse;
    const candidate = body.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('');

    return {
      text,
      finish_reason: normalizeFinishReason(candidate?.finishReason),
      usage: {
        prompt_tokens: body.usageMetadata?.promptTokenCount ?? 0,
        output_tokens: body.usageMetadata?.candidatesTokenCount ?? 0,
        cached_tokens: body.usageMetadata?.cachedContentTokenCount ?? 0,
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
  };
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
