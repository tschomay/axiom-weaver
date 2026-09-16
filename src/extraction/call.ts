/**
 * One structured call, with the bookkeeping the rubric requires around it.
 *
 * `docs/agents/story-authoring-eval.md` §3.7: *"a result that doesn't say which model produced
 * it is not a measurement"*. So every call through here records the model **the response came
 * back on** — not the one that was asked for, which differ whenever `GeminiClient` swaps to
 * `WRITER_MODEL_FALLBACK` under a capacity failure — along with tokens, cost and which pass
 * spent them.
 *
 * Failure handling is the writer path's shape, one layer up: a `MAX_TOKENS` finish under a
 * response schema yields truncated, unparseable JSON with no partial recovery
 * (`docs/research/gemini-capabilities.md` §1), and unlike a writer call there is no prose-first
 * ordering to salvage. So a bad response is retried once with a larger budget and then given up
 * on — a failed *window* is recorded and the run continues, because one lost window is a recall
 * hole this pipeline can report, while an aborted run is nothing at all.
 */

import { z } from 'zod';

import {
  MODEL_PRICING,
  type ModelClient,
  type ModelResponse,
} from '../writer/model-client';

export interface CallRecord {
  readonly pass: string;
  readonly label: string;
  /** What actually answered. */
  readonly model: string;
  readonly requested_model: string;
  readonly finish_reason: string;
  readonly prompt_tokens: number;
  readonly output_tokens: number;
  readonly thoughts_tokens: number;
  readonly cost_usd: number;
  readonly ms: number;
  readonly attempts: number;
  readonly error: string | null;
}

export function costOf(response: ModelResponse): number {
  const price = MODEL_PRICING[response.model];
  if (price === undefined) return 0;
  const uncached = Math.max(0, response.usage.prompt_tokens - response.usage.cached_tokens);
  return (
    (uncached * price.input_per_million +
      response.usage.cached_tokens * price.cached_input_per_million +
      (response.usage.output_tokens + response.usage.thoughts_tokens) *
        price.output_per_million) /
    1_000_000
  );
}

export interface ExtractionRequest {
  readonly pass: string;
  readonly label: string;
  readonly systemInstruction: string;
  readonly contents: string;
  readonly responseJsonSchema: Record<string, unknown>;
  readonly maxOutputTokens: number;
  readonly thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}

/** A call that came back unusable after its retry. The pass decides what to do about it. */
export class ExtractionCallError extends Error {
  readonly record: CallRecord;

  constructor(message: string, record: CallRecord) {
    super(message);
    this.record = record;
  }
}

export class ExtractionModel {
  readonly model: string;
  private readonly client: ModelClient;
  private readonly records: CallRecord[] = [];

  constructor(client: ModelClient, model: string) {
    this.client = client;
    this.model = model;
  }

  get calls(): readonly CallRecord[] {
    return this.records;
  }

  /** Total USD across every call this instance made, priced from `MODEL_PRICING`. */
  get costUsd(): number {
    return this.records.reduce((sum, record) => sum + record.cost_usd, 0);
  }

  /** Every distinct model that actually answered, for the result's provenance block. */
  get modelsUsed(): string[] {
    return [...new Set(this.records.map((record) => record.model))].sort();
  }

  async json<T>(schema: z.ZodType<T>, request: ExtractionRequest): Promise<T> {
    let lastError = '';
    let lastRecord: CallRecord | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const started = Date.now();
      // A truncated JSON response is unrecoverable, so the retry buys headroom rather than
      // re-rolling the same budget and hoping.
      const budget = request.maxOutputTokens * (attempt === 0 ? 1 : 2);
      let response: ModelResponse;
      try {
        response = await this.client.generate({
          model: this.model,
          systemInstruction: request.systemInstruction,
          contents: request.contents,
          responseJsonSchema: request.responseJsonSchema,
          maxOutputTokens: budget,
          thinkingLevel: request.thinkingLevel ?? 'LOW',
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        lastRecord = {
          pass: request.pass,
          label: request.label,
          model: this.model,
          requested_model: this.model,
          finish_reason: 'OTHER',
          prompt_tokens: 0,
          output_tokens: 0,
          thoughts_tokens: 0,
          cost_usd: 0,
          ms: Date.now() - started,
          attempts: attempt + 1,
          error: lastError,
        };
        this.records.push(lastRecord);
        continue;
      }

      const parsed = parseJson(response.text);
      const validated = parsed.ok ? schema.safeParse(parsed.value) : null;
      const error = !parsed.ok
        ? `unparseable JSON (finish_reason ${response.finish_reason}): ${parsed.error}`
        : validated!.success
          ? null
          : `schema mismatch: ${validated!.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;

      const record: CallRecord = {
        pass: request.pass,
        label: request.label,
        model: response.model,
        requested_model: this.model,
        finish_reason: response.finish_reason,
        prompt_tokens: response.usage.prompt_tokens,
        output_tokens: response.usage.output_tokens,
        thoughts_tokens: response.usage.thoughts_tokens,
        cost_usd: costOf(response),
        ms: Date.now() - started,
        attempts: attempt + 1,
        error,
      };
      this.records.push(record);
      lastRecord = record;

      if (error === null && validated !== null && validated.success) return validated.data;
      lastError = error ?? 'validation produced no data';
    }

    throw new ExtractionCallError(
      `${request.pass}/${request.label}: ${lastError}`,
      lastRecord!,
    );
  }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
