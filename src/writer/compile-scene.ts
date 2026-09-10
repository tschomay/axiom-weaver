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
import { checkVarianceContract, type VarianceFinding } from '../variance/variance-contract';
import { checkEntryState } from '../validator/state-update-authority';
import { diagnostic, type Diagnostic } from '../validator/diagnostics';
import { writerContract, fallbackPrompt, RETRY_INSTRUCTIONS } from './contract';
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
import { finalParagraph, lengthVerdict, salvageProse } from './salvage';

/**
 * ADR 0012 decision 4: roughly 2x the length budget in tokens, sized to cover prose and the
 * digest/state_updates/diagnostics tail.
 *
 * That figure alone under-budgets in practice: `thinkingConfig.thinkingLevel` reasoning tokens are
 * billed against this same `maxOutputTokens` cap, not a separate one (confirmed against the live
 * endpoint — a 60-token cap at `thinking_level: MEDIUM` returned 82 thinking tokens and zero
 * output; the Gemini capabilities research's own cost model already assumed this split, ~1,200
 * thinking tokens against ~1,800 prose tokens per scene — `docs/research/gemini-capabilities.md`
 * §2). Both real fixture compiles run against a live key hit `MAX_TOKENS` well under the
 * prose+tail figure alone, thinking having consumed 35-50% of the cap. `THINKING_RESERVE_FRACTION`
 * reserves headroom for that on top of the prose+tail budget, rather than folding it into the same
 * multiplier where it can't be told apart from prose room.
 */
const THINKING_RESERVE_FRACTION = 0.4;

export function maxOutputTokensFor(scene: SceneCard): number {
  const words = scene.length_budget ?? 500;
  const proseAndTail = Math.ceil(words * 2 * 1.4);
  return Math.ceil(proseAndTail / (1 - THINKING_RESERVE_FRACTION));
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
  readonly purpose: 'writer' | 'writer_retry' | 'digest_fallback' | 'continuity_repair';
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
  const request = {
    model: WRITER_MODEL,
    systemInstruction: assembled.header.text,
    contents: bodyOf(assembled),
    responseJsonSchema: writerResponseJsonSchema(),
    maxOutputTokens: maxOutputTokensFor(scene),
    thinkingLevel: 'MEDIUM' as const,
  };

  let attempt = await input.client.generate(request);
  calls.push(record(attempt, 'writer'));
  if (attempt.model !== WRITER_MODEL) {
    note(
      'model_fallback',
      `${scene.id}: ${WRITER_MODEL} was unavailable; ${attempt.model} answered the writer call instead`,
    );
  }

  let parsed = parseWriterResponse(attempt);
  let retryClass = parsed === null ? retryClassFor(attempt.finish_reason) : null;

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

  const response = parsed;

  // --- Post-generation --------------------------------------------------------------------
  for (const writerDiagnostic of response.diagnostics) {
    note(writerDiagnostic.type, writerDiagnostic.detail);
  }

  const findings = checkVarianceContract({
    scene,
    digest: response.scene_digest,
    writerDiagnostics: response.diagnostics,
    owedPlants: obligationsFor(input.plantWalk, scene).map((entry) => entry.fact_ref),
  });
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
  };
}
