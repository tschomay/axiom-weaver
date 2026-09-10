/**
 * A stand-in writer for running the whole loop with no API credentials.
 *
 * `recorded-fixture.ts` already covers replaying *one* recorded scene; a run loop needs a response
 * for every scene of a story, and recording fourteen live calls to prove that the loop sequences
 * them is not a trade anyone should make. So this client answers from the Scene Card itself: the
 * prose is the card's own dramatic function and beats, and the digest is what the card already
 * declares it will reveal, plant and pay off.
 *
 * That makes it a good deal more than a mock. Everything downstream of the call — validation,
 * the continuity pass, rollups, the flush — sees exactly the shape a real writer produces, so a
 * run against this client exercises the whole loop; what it cannot exercise is the writing.
 *
 * Two deliberate choices, both to keep the run report honest:
 *
 * - **Zero token usage on every call.** A stand-in carries no billing information, and inventing
 *   token counts would put fiction into the same report a live run writes real numbers into. A
 *   run whose every call reports zero tokens is a run where nothing was called.
 * - **`WRITER_MODEL` as the reported model**, matching what `clientFor` already does for a
 *   recorded fixture. Reporting a made-up model name would make `compileScene` log a
 *   `model_fallback` diagnostic that never happened — a louder falsehood than the one it fixes.
 *
 * The bands it self-reports are computed the same way the re-anchoring policy computes them
 * (ADR 0009), so an offline run does not produce a continuity finding for every entity that
 * reappears after a gap — a finding about the stand-in would tell an author nothing about their
 * story.
 */

import {
  entityAssertions,
  newCharacterKnowledge,
  newRelationships,
  scenesInOrder,
  type SceneCard,
  type StoryPackage,
} from '../schema/story-package';
import { deriveCentralities, type Centrality } from '../digest/told-ledger';
import { bandFor } from '../assembler/reanchoring';
import { obligationsFor, walkPlantObligations, type PlantWalk } from '../plants/obligation-walk';
import { parseVoiceCard } from '../voice/voice-card';
import type { SceneDigest, ReanchorUsed } from '../digest/scene-digest';
import { TWO_SENTENCE_CHARS } from '../digest/scene-digest';
import type { WriterResponse, WriterStateUpdates } from './response-schema';
import { WRITER_MODEL, type ModelClient, type ModelRequest, type ModelResponse } from './model-client';

/** The line that marks stand-in prose as stand-in prose, wherever it ends up being read. */
export const STAND_IN_MARKER = '[stand-in prose — no model was called for this scene]';

export class SyntheticWriterClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  private readonly pkg: StoryPackage;
  private readonly walk: PlantWalk;
  private readonly centralities: Map<string, Centrality>;
  private readonly palette: string[];
  /** Last scene `order` each entity was on stage, for the band computation. */
  private readonly lastSeen = new Map<string, number>();

  constructor(pkg: StoryPackage) {
    this.pkg = pkg;
    this.walk = walkPlantObligations(pkg);
    this.centralities = deriveCentralities(pkg);
    this.palette = parseVoiceCard(pkg.voice_card).imagery_palette;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const sceneId = sceneIdOf(request.contents);
    const scene =
      sceneId === null
        ? undefined
        : scenesInOrder(this.pkg).find((card) => card.id === sceneId);

    // Anything that is not a writer call — a digest-only fallback, a continuity repair — has no
    // stand-in answer here. Returning an empty object rather than a plausible one keeps the
    // failure visible: the caller logs it and carries on, which is what it does with a real
    // model's unparseable response too.
    if (scene === undefined) return this.respond('{}');

    return this.respond(JSON.stringify(this.compose(scene)));
  }

  private respond(text: string): ModelResponse {
    return {
      text,
      finish_reason: 'STOP',
      model: WRITER_MODEL,
      usage: { prompt_tokens: 0, output_tokens: 0, cached_tokens: 0, thoughts_tokens: 0 },
    };
  }

  private compose(scene: SceneCard): WriterResponse {
    const onStage = [...new Set([...scene.characters_present, scene.location_id])];
    const reanchorUsed = onStage.map((entityId) => this.bandOf(entityId, scene.order));
    for (const entityId of onStage) this.lastSeen.set(entityId, scene.order);

    return {
      prose: this.prose(scene),
      scene_digest: this.digest(scene, onStage, reanchorUsed),
      state_updates: stateUpdatesOf(scene),
      diagnostics: [],
    };
  }

  private bandOf(entityId: string, sceneOrder: number): ReanchorUsed {
    const last = this.lastSeen.get(entityId);
    const centrality = this.centralities.get(entityId) ?? 'medium';
    return {
      entity_id: entityId,
      band: bandFor(centrality, last === undefined ? null : sceneOrder - last),
    };
  }

  private prose(scene: SceneCard): string {
    const beats = scene.required_beats.map((beat) => `${sentence(beat)}`);
    const paragraphs = [
      [sentence(scene.dramatic_function), ...beats.slice(0, 1)].join(' '),
      ...(beats.length > 1 ? [beats.slice(1).join(' ')] : []),
    ].filter((paragraph) => paragraph.trim() !== '');

    // Reach the card's length budget with marked filler rather than invented narrative: the
    // length checks downstream are real checks, and a stand-in that always came in under budget
    // would fill every run report with `beat_unsatisfied` warnings about itself.
    const target = scene.length_budget ?? 500;
    const filler: string[] = [];
    let words = paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
    while (words < target) {
      filler.push(STAND_IN_MARKER);
      words += STAND_IN_MARKER.split(/\s+/).length;
    }

    return [...paragraphs, ...(filler.length > 0 ? [filler.join(' ')] : [])].join('\n\n');
  }

  private digest(
    scene: SceneCard,
    onStage: readonly string[],
    reanchorUsed: readonly ReanchorUsed[],
  ): SceneDigest {
    const domain = this.palette[(scene.order - 1) % Math.max(1, this.palette.length)] ?? null;
    return {
      event_summary: scene.dramatic_function.slice(0, TWO_SENTENCE_CHARS),
      entities_on_stage: [...onStage],
      facts_revealed: [...scene.reader_must_learn],
      plants_opened: obligationsFor(this.walk, scene).map((entry) => entry.fact_ref),
      payoffs_closed: scene.pays_off.map((payoff) => payoff.fact_ref),
      // A fresh phrasing per scene, so the stand-in never trips the stale-imagery check with
      // repetition that is an artifact of being a stand-in.
      imagery_signature:
        domain === null ? [] : [{ image: `${domain}, as of scene ${scene.order}`, domain }],
      closing_situation: closingSituation(scene),
      reanchor_used: [...reanchorUsed],
    };
  }
}

function sceneIdOf(contents: string): string | null {
  const match = /SCENE CARD — (\S+)/.exec(contents);
  return match?.[1] ?? null;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** The card's own `exit_state`, proposed as the writer would propose it (never a tier). */
function stateUpdatesOf(scene: SceneCard): WriterStateUpdates {
  const updates: WriterStateUpdates['updates'] = [];
  for (const [entityId, state] of entityAssertions(scene.exit_state)) {
    for (const [column, value] of Object.entries(state)) {
      updates.push({ entity_id: entityId, column, value });
    }
  }
  return {
    updates,
    new_relationships: newRelationships(scene.exit_state).map((row) => ({
      from_id: row.from_id,
      to_id: row.to_id,
      kind: row.kind,
      sentiment: row.sentiment ?? null,
    })),
    new_character_knowledge: newCharacterKnowledge(scene.exit_state).map((row) => ({
      character_id: row.character_id,
      fact_ref: row.fact_ref,
    })),
  };
}

function closingSituation(scene: SceneCard): string {
  const assertions = entityAssertions(scene.exit_state)
    .map(([entityId, state]) =>
      Object.entries(state)
        .map(([column, value]) => `${entityId}.${column}=${String(value)}`)
        .join(', '),
    )
    .filter((line) => line !== '');
  const text =
    assertions.length === 0
      ? `${scene.id} closes where it opened.`
      : `${scene.id} closes with ${assertions.join('; ')}.`;
  return text.slice(0, TWO_SENTENCE_CHARS);
}
