/**
 * What a cache could hold, and whether it survives from one scene to the next.
 *
 * Caching is a **prefix** match, not a diff: *"you get nothing past the first differing token"*
 * (`docs/research/gemini-capabilities.md` §2). That is what turns ADR 0008's payload order from a
 * relevance problem into an ordering one — the stable things first, the volatile ones last, so
 * that scene N's prompt is as nearly as possible a literal prefix of scene N+1's.
 *
 * An ordering mistake is invisible in the prose and shows up only as `cachedContentTokenCount`
 * staying at zero, which is a slow and expensive way to find out. This module makes the property
 * checkable without spending a call: `promptWalk` assembles a whole story's prompts from recorded
 * digests, and `prefixSurvives` says whether one prompt's cacheable prefix is intact in the next.
 *
 * Note what it cannot tell you: whether a cache actually *hits*. That also needs the prefix to
 * clear the model's minimum (`MIN_CACHEABLE_TOKENS`), which is a size question, not an ordering
 * one — see `scripts/cache-check.ts`, which asks both.
 */

import type { SceneDigest } from '../digest/scene-digest';
import type { SceneCard, StoryPackage } from '../schema/story-package';
import { scenesInOrder } from '../schema/story-package';
import { parseVoiceCard } from '../voice/voice-card';
import { buildImageryLedger } from '../voice/imagery-ledger';
import { obligationsFor, payoffInstructionsFor, walkPlantObligations } from '../plants/obligation-walk';
import { writerContract } from '../writer/contract';
import { RunState } from '../writer/run-state';
import { assemblePrompt, promptText, type AssembledPrompt } from './context-assembler';
import { reanchorDecisions } from './reanchoring';
import { joinSceneRows, presentEntityIds } from './join';

/**
 * The part of a request a cache could ever hold: the explicit-cache header and the append-only
 * digest hierarchy, in wire order. Everything after it — the verbatim tail, the volatile tail —
 * is replaced or mutated every scene by design.
 */
export function cacheablePrefixOf(assembled: AssembledPrompt): string {
  return [assembled.header.text, assembled.digest_hierarchy.text]
    .filter((text) => text !== '')
    .join('\n\n');
}

/** The whole prompt as the model sees it: `systemInstruction`, then `contents`. */
export function wirePromptOf(assembled: AssembledPrompt): string {
  const contents = promptText({
    ...assembled,
    segments: assembled.segments.filter((part) => part.cache !== 'explicit'),
  });
  return `${assembled.header.text}\n\n${contents}`;
}

/** The longest common leading run of two strings — exactly what a prefix cache can reuse. */
export function sharedPrefix(a: string, b: string): string {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a.charCodeAt(index) === b.charCodeAt(index)) index += 1;
  return a.slice(0, index);
}

export interface WalkedPrompt {
  readonly scene: SceneCard;
  readonly assembled: AssembledPrompt;
  readonly cacheable_prefix: string;
  readonly wire_prompt: string;
  /**
   * True when a digest window closed on the *previous* scene, so this scene's hierarchy has a
   * rollup where the last one had N scene digests. ADR 0008 names this a cache-invalidating
   * event: the middle of the prompt is rewritten and everything after the splice is uncached.
   */
  readonly after_rollup: boolean;
}

/** Whether one prompt's cacheable prefix is still intact at the head of the next one. */
export function prefixSurvives(previous: WalkedPrompt, next: WalkedPrompt): boolean {
  return next.wire_prompt.startsWith(previous.cacheable_prefix);
}

export interface WalkedScene {
  readonly digest: SceneDigest;
  readonly prose: string;
}

/**
 * Assemble every scene's prompt in order, advancing the run state between them exactly as the run
 * loop does — so the digest hierarchy, told-ledger and imagery history are the real ones.
 *
 * `sceneFor` supplies what the writer would have returned. Recorded digests, a stand-in writer, or
 * a stored edition all work; nothing here calls a model.
 */
export function promptWalk(
  pkg: StoryPackage,
  sceneFor: (scene: SceneCard, state: RunState) => WalkedScene,
  options: { window?: number } = {},
): WalkedPrompt[] {
  const voiceCard = parseVoiceCard(pkg.voice_card);
  const walk = walkPlantObligations(pkg);
  const state = new RunState(pkg, { window: options.window });
  const prompts: WalkedPrompt[] = [];
  let afterRollup = false;

  for (const scene of scenesInOrder(pkg)) {
    const rows = joinSceneRows(scene, state.model);
    const assembled = assemblePrompt({
      pkg,
      scene,
      model: state.model,
      voiceCard,
      hierarchy: state.hierarchy,
      ledger: state.ledger,
      imageryLedger: buildImageryLedger(voiceCard, state.imageryHistory),
      reanchoring: reanchorDecisions({
        entityIds: presentEntityIds(rows),
        sceneOrder: scene.order,
        ledger: state.ledger,
        forceReintroduce: scene.force_reintroduce,
        nameOf: (id) => state.model.nameOf(id),
      }),
      plantObligations: obligationsFor(walk, scene),
      payoffInstructions: payoffInstructionsFor(scene),
      previousParagraph: state.previousParagraph,
      writerContract: writerContract(),
    });

    prompts.push({
      scene,
      assembled,
      cacheable_prefix: cacheablePrefixOf(assembled),
      wire_prompt: wirePromptOf(assembled),
      after_rollup: afterRollup,
    });

    const produced = sceneFor(scene, state);
    const rollupsBefore = state.hierarchy.rollupEvents().length;
    state.advance(scene, produced.digest, produced.prose);
    afterRollup = state.hierarchy.rollupEvents().length > rollupsBefore;
  }

  return prompts;
}
