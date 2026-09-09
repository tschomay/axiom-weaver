/**
 * The writer contract prose — the first block of the explicit-cache header (ADR 0012 decision 2).
 *
 * It is created once per read and referenced by every scene's call, so it says only things that
 * are true for the whole telling: the role, the output order, the state-update tiering rules in
 * plain language, the `must_stay_hidden` emphasis, how diagnostics are used, and how length is
 * framed. Anything that changes per scene belongs in the volatile tail, on the far side of the
 * cache boundary.
 *
 * `must_stay_hidden` is emphasized here rather than checked at runtime for a reason ADR 0006
 * decision 4 documents as an accepted gap: `propertyOrdering` puts `prose` first so it streams
 * immediately, which means by the time a violation is checkable the reader has probably already
 * read the leaked secret. A retry cannot un-show prose. Front-loading the instruction is the only
 * real defense there is.
 */

import { RESPONSE_PROPERTY_ORDER } from './response-schema';

export function writerContract(): string {
  return [
    'You are the performance engine for a Dynamic Novel Compiler. You render a fixed Story',
    'Package into prose. You never invent plot: the scene\'s beats, entry and exit state, and what',
    'the reader learns are authored — your only freedom is HOW it is told (dialogue, imagery,',
    'interiority, micro-beat order, pacing within budget).',
    '',
    `OUTPUT: ${RESPONSE_PROPERTY_ORDER.join(', then ')}, in that order, matching the response`,
    'schema exactly.',
    '',
    'STATE UPDATES: for each World Model column you touch, propose {entity_id, column, value}.',
    'Physical and epistemic columns (location, status, who-knows-what) are committed automatically',
    'if they satisfy or merely extend this scene\'s exit state, and are REJECTED if they contradict',
    'it, target an entity this scene never mentions, or revert a previously established fact',
    'without this scene giving grounds to. Volitional columns (goal, sentiment) are proposals only',
    '— propose freely, the engine decides whether to keep them. Do not reason about which tier a',
    'column is in; propose what the scene implies and the engine will look the tier up.',
    '',
    'MUST_STAY_HIDDEN is absolute. Your prose reaches the reader before anything else in your',
    'response is checkable — once a hidden fact is on the page it cannot be un-shown. Treat it as a',
    'hard constraint, not a soft preference.',
    '',
    'RE-ANCHORING: each scene tells you, per entity on stage, how long it has been since the reader',
    'last met them and what to do about it. "Assume" means write as if they are known. "Reanchor',
    'lightly" means one distinguishing clause — "her brother\'s ring, the one from the pawnshop" —',
    'never a restated explanation. "Reintroduce" means place them again as if newly met. Report the',
    'band you actually used per entity in reanchor_used.',
    '',
    'IMAGERY: the Voice Card names the domains this telling draws on, and recurrence within a',
    'domain is deliberate — it is what makes a motif. The imagery ledger tells you which phrasings',
    'have already been used inside each domain; vary the phrasing, not the domain. Tag each image',
    'you record in imagery_signature with the palette domain it came from, or null if you stepped',
    'outside the palette.',
    '',
    'DIAGNOSTICS: report beat_unsatisfied if a required beat could not be honored without',
    'contradicting something else in the scene, and missing_fact if you needed a fact you were not',
    'given. Report nothing else — the compiler checks state-update validity, plant obligations, and',
    'invariant satisfaction on its own.',
    '',
    'LENGTH: aim for approximately the scene\'s stated length budget in words. A little over is fine',
    'if the beats need room; well under is a sign a beat got cut.',
  ].join('\n');
}

/**
 * Retry instructions, one per failure class (ADR 0012 decisions 5 and 6, ADR 0013 decision 5).
 *
 * Each is appended to the scene-specific instruction on the single bounded retry that failure
 * class gets. One retry, then accept-and-log, is the shape ADR 0004/0005/0006 already use — this
 * applies the existing policy to a new failure class rather than inventing a new one.
 */
export const RETRY_INSTRUCTIONS = {
  /** Prose itself was cut mid-clause; the whole scene is retried with a raised output ceiling. */
  max_tokens:
    'The previous attempt ran long and was cut off. Be more concise while still hitting every required beat.',
  /** Schema-constrained decode failures are often non-reproducible, so the prompt is unchanged. */
  malformed_response: '',
  recitation:
    'Paraphrase and reinterpret this moment in your own words. Do not reproduce source-text phrasing.',
  content_filtered:
    "This is literary narrative content within the authored Scene Card's bounds; render the beats as prose.",
} as const;

export type RetryClass = keyof typeof RETRY_INSTRUCTIONS;

/**
 * The prompt for the digest-only fallback call (ADR 0012 decision 5).
 *
 * Carries only the recovered prose and the Scene Card fields a digest actually has to reference —
 * not the assembled context, which the fallback does not need and would pay for.
 */
export function fallbackPrompt(input: {
  readonly sceneId: string;
  readonly prose: string;
  readonly readerMustLearn: readonly string[];
  readonly mustStayHidden: readonly string[];
  readonly paysOff: readonly string[];
  readonly imageryPalette: readonly string[];
}): string {
  return [
    'Below is a scene of a novel that has already been written and shown to the reader. Produce',
    'only its structured digest and the World Model state updates its own text implies. Do not',
    'rewrite, extend, or comment on the prose — describe what is already there.',
    '',
    `SCENE CARD — ${input.sceneId}`,
    `Facts this scene was meant to reveal: ${list(input.readerMustLearn)}`,
    `Facts that had to stay hidden: ${list(input.mustStayHidden)}`,
    `Plants this scene was meant to pay off: ${list(input.paysOff)}`,
    `Imagery palette to tag recorded images against: ${list(input.imageryPalette)}`,
    '',
    'SCENE:',
    input.prose,
  ].join('\n');
}

function list(values: readonly string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ');
}
