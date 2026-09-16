/**
 * The original-arc generator: one interleaved pass, then bounded atomic repair.
 *
 * `generate → lint → repair the named error → re-lint`, which is the only critique loop
 * `llm-arc-generation-prior-art.md` §4.3 endorses, because its feedback signal is external and
 * mechanical. There is exactly one repair round, mirroring the "one bounded retry then surface"
 * shape the repo already uses at ADR 0012 and ADR 0005; an arc still failing after it is reported
 * as failing rather than ground against the validator until it passes.
 */

import { GeminiClient, type ModelClient } from '../writer/model-client';
import { FabulaArcSchema, type FabulaArc } from './fabula';
import { ARC_SYSTEM_INSTRUCTION, arcResponseJsonSchema, renderArcPrompt } from './prompt';
import {
  ArcRepairResponseSchema,
  applyEdits,
  arcRepairResponseJsonSchema,
  mechanicalRepairs,
  repairPrompt,
  repairTargets,
  type RepairTarget,
} from './repair';
import type { ArcBrief } from './brief';

/**
 * Generous, because thinking is billed against this same ceiling.
 *
 * Measured on the first live run: a 20-event arc at `thinking_level: HIGH` spent **23,619 thinking
 * tokens** before writing 8,366 tokens of output, and hit `MAX_TOKENS` at a 32,000 cap with the
 * arc half-written. `maxOutputTokens` is a ceiling and not an allocation (the same note
 * `compile-scene.ts` carries), so the fix is to reserve the room rather than to think less — the
 * interleaved design's whole argument is that the model holds the event list and its causal graph
 * in mind at once, and that is exactly what the thinking budget buys.
 */
export const ARC_MAX_OUTPUT_TOKENS = 60_000;
export const REPAIR_MAX_OUTPUT_TOKENS = 4_000;

export interface GenerationCall {
  readonly stage: 'arc' | 'repair';
  /** What actually answered — not necessarily what was asked for (capacity fallback). */
  readonly model: string;
  readonly finish_reason: string;
  readonly prompt_tokens: number;
  readonly output_tokens: number;
  readonly thoughts_tokens: number;
  readonly ms: number;
}

export interface GeneratedArc {
  readonly brief: ArcBrief;
  readonly arc: FabulaArc;
  readonly model: string;
  readonly calls: GenerationCall[];
  /** Atomic edits applied, in order, with the phase that authored each. */
  readonly repairs: string[];
  /** Defects the first pass produced, before any repair. The interesting number. */
  readonly initial_problems: RepairTarget[];
  /** Defects left after the one bounded repair round. Empty is the goal. */
  readonly remaining_problems: RepairTarget[];
  /**
   * What the brief asked for versus what came back.
   *
   * Worth reporting rather than gating: the response schema cannot carry an array bound (see
   * `./prompt.ts`), so event count is an instruction the model follows or does not, and how well
   * it follows it is a measurement about the input surface.
   */
  readonly event_count: { requested: number; returned: number };
}

function stripFences(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return fenced?.[1] ?? text;
}

/**
 * Renumber `sequence` to a dense 1..N in the order the model returned, keeping its ordering.
 *
 * Only bookkeeping is touched. The chronological decision is the model's and sorting preserves it
 * exactly; what this removes is a duplicate or gapped `sequence`, which the cross-reference pass
 * reports as `duplicate_order` and which the repair vocabulary deliberately has no edit for —
 * because "two events claim position 7" is a numbering slip, not an authoring question, and
 * sending it back to the model would spend a repair round on a typo.
 */
function denseSequences(arc: FabulaArc): FabulaArc {
  const ordered = [...arc.events].sort((a, b) => a.sequence - b.sequence);
  return { ...arc, events: ordered.map((event, index) => ({ ...event, sequence: index + 1 })) };
}

function parseArc(text: string): FabulaArc {
  const parsed: unknown = JSON.parse(stripFences(text));
  return denseSequences(FabulaArcSchema.parse(parsed));
}

export interface GenerateOptions {
  readonly client: ModelClient;
  readonly model: string;
  /** Off for the A/B arm that measures whether repair is carrying the gate numbers. */
  readonly repair?: boolean;
}

export async function generateArc(
  brief: ArcBrief,
  options: GenerateOptions,
): Promise<GeneratedArc> {
  const calls: GenerationCall[] = [];
  const startedAt = Date.now();

  const response = await options.client.generate({
    model: options.model,
    systemInstruction: ARC_SYSTEM_INSTRUCTION,
    contents: renderArcPrompt(brief),
    responseJsonSchema: arcResponseJsonSchema(brief.event_count),
    maxOutputTokens: ARC_MAX_OUTPUT_TOKENS,
    // HIGH: the whole point of the interleaved design is that the model holds the causal graph
    // and the event list in mind at once, which is the thing thinking budget buys.
    thinkingLevel: 'HIGH',
  });

  calls.push({
    stage: 'arc',
    model: response.model,
    finish_reason: response.finish_reason,
    prompt_tokens: response.usage.prompt_tokens,
    output_tokens: response.usage.output_tokens,
    thoughts_tokens: response.usage.thoughts_tokens,
    ms: Date.now() - startedAt,
  });

  if (response.finish_reason !== 'STOP') {
    throw new Error(
      `arc generation finished ${response.finish_reason} (${response.usage.output_tokens} output, ` +
        `${response.usage.thoughts_tokens} thinking tokens)`,
    );
  }

  let arc = parseArc(response.text);
  const initialProblems = repairTargets(arc, brief.story_id);
  const repairs: string[] = [];

  if (options.repair !== false && initialProblems.length > 0) {
    const mechanical = mechanicalRepairs(arc);
    arc = mechanical.arc;
    repairs.push(...mechanical.applied.map((line) => `mechanical | ${line}`));

    const stillWrong = repairTargets(arc, brief.story_id);
    if (stillWrong.length > 0) {
      const repairStartedAt = Date.now();
      const repaired = await options.client.generate({
        model: options.model,
        systemInstruction: ARC_SYSTEM_INSTRUCTION,
        contents: repairPrompt(arc, stillWrong),
        responseJsonSchema: arcRepairResponseJsonSchema(),
        maxOutputTokens: REPAIR_MAX_OUTPUT_TOKENS,
        thinkingLevel: 'MEDIUM',
      });
      calls.push({
        stage: 'repair',
        model: repaired.model,
        finish_reason: repaired.finish_reason,
        prompt_tokens: repaired.usage.prompt_tokens,
        output_tokens: repaired.usage.output_tokens,
        thoughts_tokens: repaired.usage.thoughts_tokens,
        ms: Date.now() - repairStartedAt,
      });

      if (repaired.finish_reason === 'STOP') {
        const edits = ArcRepairResponseSchema.parse(JSON.parse(stripFences(repaired.text))).edits;
        const applied = applyEdits(arc, edits);
        arc = applied.arc;
        repairs.push(...applied.applied.map((line) => `model | ${line}`));
      }
    }
  }

  return {
    brief,
    arc,
    // The model that actually answered the generation call, per AGENTS.md: a result that does not
    // say which model produced it is not a measurement.
    model: calls[0]?.model ?? options.model,
    calls,
    repairs,
    initial_problems: initialProblems,
    remaining_problems: repairTargets(arc, brief.story_id),
    event_count: { requested: brief.event_count, returned: arc.events.length },
  };
}

/** The live client, or a clear failure. This pipeline has no recorded stand-in to fall back to. */
export function liveClient(): GeminiClient {
  const client = GeminiClient.fromEnv();
  if (client === null) {
    throw new Error('GEMINI_API_KEY is not set — arc generation has no recorded stand-in');
  }
  return client;
}
