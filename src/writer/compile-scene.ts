/**
 * One scene, one writer call — the per-scene step the read-time run loop will slot into.
 *
 * This is where the map's separate threads meet: assembled context (ADR 0008), plant obligations
 * (ADR 0004), re-anchoring (ADR 0009), the imagery ledger (ADR 0010), the Voice Card (ADR 0007),
 * the variance contract (ADR 0006) and state-update tiering (ADR 0005) all arrive in one prompt,
 * and one structured response carries prose, digest, state updates and diagnostics back out.
 *
 * Every failure path here has the same shape the rest of the map already uses: one bounded retry,
 * then accept-and-log, never block. Read-time compiles are unattended — nothing may block on an
 * author who is not there.
 */

import type { SceneCard, StoryPackage } from '../schema/story-package';
import type { WorldModel } from '../world-model/world-model';
import type { DigestHierarchy } from '../digest/hierarchy';
import type { ToldLedger } from '../digest/told-ledger';
import type { SceneDigest } from '../digest/scene-digest';
import type { VoiceCard } from '../voice/voice-card';
import { buildImageryLedger, type RecordedImagery } from '../voice/imagery-ledger';
import { reanchorDecisions, type BandDecision } from '../assembler/reanchoring';
import { joinSceneRows, presentEntityIds, beatOnlyCharacters } from '../assembler/join';
import {
  assemblePrompt,
  promptText,
  type AssembledPrompt,
} from '../assembler/context-assembler';
import {
  obligationsFor,
  payoffInstructionsFor,
  type PlantWalk,
} from '../plants/obligation-walk';
import {
  checkVarianceContract,
  shouldRetry,
  type VarianceFinding,
} from '../variance/variance-contract';
import { checkEntryState } from '../validator/state-update-authority';
import { diagnostic, type Diagnostic } from '../validator/diagnostics';
import {
  writerContract,
  fallbackPrompt,
  restateMissedInvariants,
  RETRY_INSTRUCTIONS,
} from './contract';
import {
  FallbackResponseSchema,
  WriterResponseSchema,
  fallbackResponseJsonSchema,
  writerResponseJsonSchema,
  type WriterResponse,
} from './response-schema';
import {
  FALLBACK_MODEL,
  WRITER_MODEL,
  type FinishReason,
  type ModelClient,
  type ModelResponse,
} from './model-client';
import { finalParagraph, lengthVerdict, normalizeProse, salvageProse } from './salvage';

/**
 * The output-token cap for one scene: prose and its tail, plus room to think.
 *
 * ADR 0012 decision 4 sizes the prose half — roughly 2x the length budget in tokens, covering the
 * digest/state_updates/diagnostics tail as well as the prose itself.
 *
 * The thinking half is a *floor*, not a fraction of that, and the floor is what the first live run
 * of the run loop bought (`docs/research/run-loop-first-measurements.md`, issue #49). Reserving a
 * percentage of the prose budget assumes hard scenes are long ones, and the measurement says
 * otherwise: a 200-word scene spent 897 thinking tokens where a 350-word scene spent 1,410, and
 * every one of the run's seven first-attempt calls hit `MAX_TOKENS` — three of them twice, which
 * is what degraded the run. Thinking scales with how tangled the scene is (beats, state, plants),
 * not with how many words the author asked for, so the reserve cannot be derived from word count.
 *
 * Reserving generously is close to free: `maxOutputTokens` is a ceiling, not an allocation —
 * nothing is billed for headroom that goes unused — and the binding limit on the project's key is
 * requests per day, not tokens per minute. Spending one call per scene instead of two is worth
 * far more than a tight cap.
 *
 * `thinkingConfig.thinkingLevel` reasoning tokens bill against this same cap rather than a
 * separate one (confirmed against the live endpoint: a 60-token cap at `thinking_level: MEDIUM`
 * returned 82 thinking tokens and zero output), which is why they need budgeting here at all.
 */
const THINKING_RESERVE_FRACTION = 0.4;

/**
 * The floor under the thinking reserve, in tokens.
 *
 * Measured: 897–2,633 thinking tokens per call across the first live run's 14 calls, on
 * `gemini-3.6-flash` (the capacity fallback, which answered every call that run). 3,000 clears the
 * observed worst case with room, and is a starting point to re-measure against `gemini-3.7-flash`
 * when it is reachable, not a settled number.
 */
export const MIN_THINKING_RESERVE_TOKENS = 3000;

/**
 * Extra headroom on top of the sized budget above, added after `the-amber-cat` run showed the
 * `digest_fallback` path (decision 5 below) firing more often than its "should be the exception,
 * not the routine case" bar. That path is deliberately cheap by design — `gemini-3.5-flash-lite`
 * reconstructing a digest from prose that already exists is a fine trade for cost — but it should
 * still be rare, and a rate driven by the primary call running short on room is a budgeting
 * problem, not something to paper over by leaning on the recovery path more. The same "reserving
 * generously is close to free" reasoning above applies here too: nothing is billed for headroom
 * that goes unused, so widening the ceiling is a strictly better trade than living with the
 * truncations it exists to prevent.
 */
const OUTPUT_TOKEN_HEADROOM_MULTIPLIER = 1.5;

export function maxOutputTokensFor(scene: SceneCard): number {
  const words = scene.length_budget ?? 500;
  const proseAndTail = Math.ceil(words * 2 * 1.4);
  const proportional = Math.ceil(
    proseAndTail * (THINKING_RESERVE_FRACTION / (1 - THINKING_RESERVE_FRACTION)),
  );
  const budget = proseAndTail + Math.max(proportional, MIN_THINKING_RESERVE_TOKENS);
  return Math.ceil(budget * OUTPUT_TOKEN_HEADROOM_MULTIPLIER);
}

export interface CompileSceneInput {
  readonly pkg: StoryPackage;
  readonly scene: SceneCard;
  readonly model: WorldModel;
  readonly voiceCard: VoiceCard;
  readonly hierarchy: DigestHierarchy;
  readonly ledger: ToldLedger;
  readonly plantWalk: PlantWalk;
  readonly client: ModelClient;
  /** Imagery recorded by earlier scenes, for the ledger block. */
  readonly imageryHistory: readonly RecordedImagery[];
  readonly previousParagraph: string | null;
  readonly occasion: 'author_time' | 'read_time';
  /**
   * Which model writes the scene. Defaults to `WRITER_MODEL`; overridden only deliberately, to
   * trade prose quality for request headroom on a rate-limited key (see `TESTING_WRITER_MODEL`).
   */
  readonly writerModel?: string;
}

export interface CompiledScene {
  readonly scene_id: string;
  readonly prose: string;
  readonly digest: SceneDigest;
  readonly response: WriterResponse;
  readonly assembled: AssembledPrompt;
  readonly reanchoring: readonly BandDecision[];
  readonly findings: readonly VarianceFinding[];
  readonly diagnostics: readonly Diagnostic[];
  /** Every model call made for this scene, including retries and the fallback. */
  readonly calls: readonly CallRecord[];
  /** The paragraph the next scene opens against. */
  readonly final_paragraph: string | null;
}

export interface CallRecord {
  readonly model: string;
  readonly purpose:
    | 'writer'
    | 'writer_retry'
    | 'digest_fallback'
    | 'continuity_repair'
    /** A digest-hierarchy rollup synthesis (ADR 0003 §6), charged to the scene that closed it. */
    | 'digest_rollup';
  readonly finish_reason: FinishReason;
  readonly prompt_tokens: number;
  readonly output_tokens: number;
  readonly cached_tokens: number;
  readonly thoughts_tokens: number;
}

/** Which retry class a finish reason falls into, or `null` for one that needs no retry. */
function retryClassFor(reason: FinishReason): keyof typeof RETRY_INSTRUCTIONS | null {
  switch (reason) {
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'MALFORMED_RESPONSE':
      return 'malformed_response';
    case 'RECITATION':
      return 'recitation';
    case 'SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
    case 'SPII':
      return 'content_filtered';
    default:
      return null;
  }
}

export async function compileScene(input: CompileSceneInput): Promise<CompiledScene> {
  const { scene, pkg } = input;
  const diagnostics: Diagnostic[] = [];
  const calls: CallRecord[] = [];
  const sceneIndex = scene.order;

  const note = (
    code: Parameters<typeof diagnostic>[0],
    message: string,
    entityId: string | null = null,
  ) =>
    diagnostics.push(
      diagnostic(code, {
        entity_id: entityId,
        column: null,
        scene_id: scene.id,
        scene_index: sceneIndex,
        message,
      }),
    );

  // --- Pre-generation ---------------------------------------------------------------------
  //
  // ADR 0005 §1: the card's asserted entry state is checked against the live World Model before a
  // token is spent. A mismatch does not block — it is logged and the scene is written anyway.
  const entryCheck = checkEntryState(scene, input.model);
  diagnostics.push(...entryCheck.diagnostics);

  const rows = joinSceneRows(scene, input.model);
  const onStage = presentEntityIds(rows);

  const reanchoring = reanchorDecisions({
    entityIds: onStage,
    sceneOrder: scene.order,
    ledger: input.ledger,
    forceReintroduce: scene.force_reintroduce,
    nameOf: (id) => input.model.nameOf(id),
  });

  const assembled = assemblePrompt({
    pkg,
    scene,
    model: input.model,
    voiceCard: input.voiceCard,
    hierarchy: input.hierarchy,
    ledger: input.ledger,
    imageryLedger: buildImageryLedger(input.voiceCard, input.imageryHistory),
    reanchoring,
    plantObligations: obligationsFor(input.plantWalk, scene),
    payoffInstructions: payoffInstructionsFor(scene),
    previousParagraph: input.previousParagraph,
    writerContract: writerContract(),
  });

  // A character with an on-page beat but no row in context is the same hole `missing_fact` would
  // report after the fact — logged here so it surfaces even when the writer does not notice.
  for (const character of beatOnlyCharacters(scene, input.model)) {
    note(
      'missing_fact',
      `"${character.name}" has an on-page beat in ${scene.id} but is absent from characters_present, so the deterministic join never surfaced their World Model row`,
      character.id,
    );
  }
  for (const assemblyDiagnostic of assembled.diagnostics) {
    if (assemblyDiagnostic.type === 'beat_only_character') continue;
    note('missing_fact', assemblyDiagnostic.detail);
  }

  // --- The call, and its one bounded retry ------------------------------------------------
  const writerModel = input.writerModel ?? WRITER_MODEL;
  const request = {
    model: writerModel,
    systemInstruction: assembled.header.text,
    contents: bodyOf(assembled),
    responseJsonSchema: writerResponseJsonSchema(),
    maxOutputTokens: maxOutputTokensFor(scene),
    thinkingLevel: 'MEDIUM' as const,
  };

  let attempt = await input.client.generate(request);
  calls.push(record(attempt, 'writer'));
  if (attempt.model !== writerModel) {
    note(
      'model_fallback',
      `${scene.id}: ${writerModel} was unavailable; ${attempt.model} answered the writer call instead`,
    );
  }

  let parsed = parseWriterResponse(attempt);
  // A response that finished cleanly but does not satisfy the schema is the `MALFORMED_RESPONSE`
  // case by another route — `parseWriterResponse` already treats the two the same, so the retry
  // shape has to as well (ADR 0012 decision 6). Without this fallback a `STOP` that failed
  // validation got no retry at all and went straight to salvage.
  let retryClass =
    parsed === null ? (retryClassFor(attempt.finish_reason) ?? 'malformed_response') : null;

  // MAX_TOKENS with prose complete is not a retry — it is a salvage, handled below. Only a cut
  // that landed *inside* prose warrants re-running the whole scene.
  if (attempt.finish_reason === 'MAX_TOKENS') {
    const salvaged = salvageProse(attempt.text);
    retryClass = salvaged !== null && salvaged.complete ? null : 'max_tokens';
  }

  if (parsed === null && retryClass !== null) {
    const instruction = RETRY_INSTRUCTIONS[retryClass];
    const retried = await input.client.generate({
      ...request,
      contents: instruction === '' ? request.contents : `${request.contents}\n\n${instruction}`,
      maxOutputTokens:
        retryClass === 'max_tokens'
          ? Math.ceil(request.maxOutputTokens * 1.5)
          : request.maxOutputTokens,
    });
    calls.push(record(retried, 'writer_retry'));
    attempt = retried;
    parsed = parseWriterResponse(retried);

    if (parsed === null) {
      if (retried.finish_reason === 'RECITATION') {
        note(
          'recitation_flagged',
          `${scene.id} returned RECITATION twice; handing off per ADR 0013 and committing what prose exists`,
        );
      } else if (retryClassFor(retried.finish_reason) === 'content_filtered') {
        note(
          'content_filtered',
          `${scene.id} was filtered (${retried.finish_reason}) after its fiction-framing retry`,
        );
      }
    }
  }

  // --- Salvage and failure paths ----------------------------------------------------------
  if (parsed === null) {
    const salvaged = salvageProse(attempt.text);

    if (salvaged !== null && salvaged.complete) {
      // Prose survived; only the tail was cut. A digest-only fallback call reconstructs the
      // digest from the prose the reader has already seen — a required component, not an
      // optimisation, since without it a streamed scene could never be committed.
      const fallback = await input.client.generate({
        model: FALLBACK_MODEL,
        systemInstruction: '',
        contents: fallbackPrompt({
          sceneId: scene.id,
          prose: salvaged.prose,
          readerMustLearn: scene.reader_must_learn,
          mustStayHidden: scene.must_stay_hidden,
          paysOff: scene.pays_off.map((payoff) => payoff.fact_ref),
          imageryPalette: input.voiceCard.imagery_palette,
        }),
        responseJsonSchema: fallbackResponseJsonSchema(),
        maxOutputTokens: 2048,
        thinkingLevel: 'LOW',
      });
      calls.push(record(fallback, 'digest_fallback'));

      const recovered = FallbackResponseSchema.safeParse(safeJson(fallback.text));
      if (recovered.success) {
        note(
          'truncated_scene',
          `${scene.id}: primary call hit MAX_TOKENS after prose; digest recovered via fallback call`,
        );
        parsed = {
          prose: salvaged.prose,
          scene_digest: recovered.data.scene_digest,
          state_updates: recovered.data.state_updates,
          diagnostics: [],
        };
      }
    }

    if (parsed === null) {
      // Everything survived its retry and still failed. Commit whatever prose exists and build
      // the digest conservatively — never inventing that something happened.
      const prose = salvaged?.prose ?? '';
      note(
        'scene_generation_failed',
        `${scene.id} failed with ${attempt.finish_reason} after its one retry; committing ${prose === '' ? 'a stub' : 'the partial prose'} and continuing`,
      );
      parsed = {
        prose: prose === '' ? `[scene ${scene.id} could not be generated]` : prose,
        scene_digest: conservativeDigest(input),
        state_updates: { updates: [], new_relationships: [], new_character_knowledge: [] },
        diagnostics: [],
      };
    }
  }

  // Normalize before anything reads the prose: the verbatim tail, the continuity pass's opening
  // paragraph, the word count and the reader all split on real newlines (issue #64).
  let response: WriterResponse = { ...parsed, prose: normalizeProse(parsed.prose) };

  // --- Post-generation --------------------------------------------------------------------
  const owedPlants = obligationsFor(input.plantWalk, scene).map((entry) => entry.fact_ref);
  const check = (candidate: WriterResponse) =>
    checkVarianceContract({
      scene,
      digest: candidate.scene_digest,
      writerDiagnostics: candidate.diagnostics,
      owedPlants,
    });

  let findings = check(response);

  // --- The invariant retry ----------------------------------------------------------------
  //
  // ADR 0004 §6, ADR 0005 §5 and ADR 0006 §3 all specify the same thing for a scene that came
  // back missing something its card required: one bounded retry with the miss restated, then
  // accept-and-log. Every other retry in this function keys off `finishReason`, which is blind to
  // a call that succeeded and simply did not do what it was asked — a dropped plant, a
  // `reader_must_learn` fact that never reached `facts_revealed`.
  //
  // The budget is one *per scene*, shared with the finish-reason retry above (`calls.length` is
  // the check), so no scene can cost more than two writer calls plus salvage. Author-time never
  // retries: the author is present and can just fix the card (ADR 0006 §3).
  if (
    input.occasion === 'read_time' &&
    calls.length === 1 &&
    shouldRetry(findings, input.occasion)
  ) {
    const restated = restateMissedInvariants(
      findings.filter((finding) => finding.correctable).map((finding) => finding.detail),
    );
    const retried = await input.client.generate({
      ...request,
      contents: `${request.contents}\n\n${restated}`,
    });
    calls.push(record(retried, 'writer_retry'));

    const reparsed = parseWriterResponse(retried);
    const candidate: WriterResponse | null =
      reparsed === null ? null : { ...reparsed, prose: normalizeProse(reparsed.prose) };
    const candidateFindings = candidate === null ? null : check(candidate);

    if (candidate !== null && candidateFindings !== null && isBetter(candidateFindings, findings)) {
      note(
        'invariant_retry_accepted',
        `${scene.id} missed ${describeMisses(findings)} on its first attempt; the retry satisfied ${findings.length - candidateFindings.length} more`,
      );
      response = candidate;
      findings = candidateFindings;
    } else {
      note(
        'invariant_retry_discarded',
        `${scene.id} was retried for ${describeMisses(findings)} and the retry did no better; the first attempt stands`,
      );
    }
  }

  for (const writerDiagnostic of response.diagnostics) {
    note(writerDiagnostic.type, writerDiagnostic.detail);
  }
  for (const finding of findings) {
    if (finding.code === 'beat_unsatisfied') continue; // already logged from the self-report
    note(finding.code, finding.detail);
  }

  const length = lengthVerdict(response.prose, scene.length_budget);
  if (length.verdict === 'under') {
    note(
      'beat_unsatisfied',
      `${scene.id} came in at ${length.words} words against a ${scene.length_budget}-word budget (${Math.round((length.ratio ?? 0) * 100)}%) — well under budget usually means a beat got cut`,
    );
  }

  return {
    scene_id: scene.id,
    prose: response.prose,
    digest: response.scene_digest,
    response,
    assembled,
    reanchoring,
    findings,
    diagnostics,
    calls,
    final_paragraph: finalParagraph(response.prose),
  };
}

/**
 * Whether a retry's findings are an improvement on the first attempt's.
 *
 * Leaks are compared first and separately: a retry that fixed a dropped plant by putting a
 * `must_stay_hidden` fact on the page is not an improvement at any count, and that finding is
 * `correctable: false` precisely because nothing can take it back (ADR 0006 §4). Otherwise fewer
 * misses wins, and a tie keeps the first attempt — a retry that did no better is not worth
 * replacing prose the reader would have been given either way.
 */
function isBetter(
  candidate: readonly VarianceFinding[],
  original: readonly VarianceFinding[],
): boolean {
  const leaks = (findings: readonly VarianceFinding[]) =>
    findings.filter((finding) => finding.code === 'must_stay_hidden_violation').length;
  if (leaks(candidate) !== leaks(original)) return leaks(candidate) < leaks(original);
  return candidate.length < original.length;
}

/** What the scene missed, named by code, for a diagnostic message. */
function describeMisses(findings: readonly VarianceFinding[]): string {
  const codes = [...new Set(findings.filter((f) => f.correctable).map((f) => f.code))];
  return codes.length === 0 ? 'an invariant' : codes.join(', ');
}

/** Everything after the cached header, in payload order — the `contents` half of the request. */
function bodyOf(assembled: AssembledPrompt): string {
  return promptText({
    ...assembled,
    segments: assembled.segments.filter((part) => part.cache !== 'explicit'),
  });
}

function record(response: ModelResponse, purpose: CallRecord['purpose']): CallRecord {
  return {
    model: response.model,
    purpose,
    finish_reason: response.finish_reason,
    prompt_tokens: response.usage.prompt_tokens,
    output_tokens: response.usage.output_tokens,
    cached_tokens: response.usage.cached_tokens,
    thoughts_tokens: response.usage.thoughts_tokens,
  };
}

/**
 * Parse and validate the response client-side.
 *
 * Google's own guidance is that the client validates with a retry mechanism, so a response that
 * parses as JSON but does not satisfy the schema is treated exactly like one that does not parse.
 */
function parseWriterResponse(response: ModelResponse): WriterResponse | null {
  if (response.finish_reason !== 'STOP' && response.finish_reason !== 'MAX_TOKENS') return null;
  const json = safeJson(response.text);
  if (json === null) return null;
  const result = WriterResponseSchema.safeParse(json);
  return result.success ? result.data : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The digest built when a scene could not be generated (ADR 0012 decision 6).
 *
 * Empty `facts_revealed`/`plants_opened`/`payoffs_closed` rather than inventing that something
 * happened, and `closing_situation` copied forward from the previous scene with a note — the
 * situation genuinely has not moved.
 */
function conservativeDigest(input: CompileSceneInput): SceneDigest {
  const open = input.hierarchy.inPayloadOrder();
  const previous = open[open.length - 1]?.digest.closing_situation ?? '';
  return {
    event_summary: `[scene ${input.scene.id} could not be generated]`,
    entities_on_stage: [],
    facts_revealed: [],
    plants_opened: [],
    payoffs_closed: [],
    imagery_signature: [],
    closing_situation:
      previous === ''
        ? '[unchanged — scene could not be generated]'
        : `${previous} [unchanged — scene could not be generated]`,
    reanchor_used: [],
    grounded_claims: [],
  };
}
