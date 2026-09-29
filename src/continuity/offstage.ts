/**
 * Offstage inventions (#213, ADR 0011's 2026-09-29 amendment): the writer patching a gap in the arc
 * with an event the reader never sees. The baseline Night Shift Letter's scene 16 had Julian
 * explain an outcome with "Clara took an envelope stuffed with yesterday's manifest duplicates" — a
 * swap in no event and on no card, by a character who was not in the scene.
 *
 * Two cheap detectors over the scene just written (its own prose and digest), no model call:
 *
 * 1. **Offstage report** — a sentence naming a seed character absent from the card, with a
 *    past-tense action verb that no card of the package uses in any inflection.
 * 2. **Invented prop** — an `established_details` entity that is not a World Model row and whose
 *    slug's words appear on no card.
 */

import type { SceneDigest } from '../digest/scene-digest';
import type { SceneCard, StoryPackage } from '../schema/story-package';

export interface OffstageFinding {
  readonly kind: 'offstage_report' | 'invented_prop';
  readonly detail: string;
}

/** Past-tense action verbs, and the base form a card might use instead. */
const ACTION_VERBS: Record<string, string> = {
  took: 'take', taken: 'take', swapped: 'swap', switched: 'switch', stole: 'steal', stolen: 'steal',
  hid: 'hide', hidden: 'hide', moved: 'move', visited: 'visit', met: 'meet', signed: 'sign',
  sold: 'sell', bought: 'buy', burned: 'burn', burnt: 'burn', sent: 'send', gave: 'give',
  given: 'give', planted: 'plant', forged: 'forge', paid: 'pay', replaced: 'replace',
  substituted: 'substitute', slipped: 'slip', smuggled: 'smuggle', removed: 'remove',
  delivered: 'deliver', posted: 'post', emptied: 'empty', broke: 'break', broken: 'break',
  destroyed: 'destroy', bribed: 'bribe', arranged: 'arrange', warned: 'warn', confessed: 'confess',
};

/** Titles that are not a name ("Supervisor Irene Gable" → Irene, Gable). */
const TITLES = new Set([
  'Mr', 'Mrs', 'Ms', 'Miss', 'Doctor', 'Dr', 'Sir', 'Lady', 'Lord', 'Captain', 'Father', 'Mother',
  'Sister', 'Brother', 'Uncle', 'Aunt', 'Supervisor', 'Director', 'Inspector', 'Officer', 'The',
]);

function nameTokens(name: string): string[] {
  return (name.match(/\b[A-Z][a-z'-]{2,}\b/g) ?? []).filter((token) => !TITLES.has(token));
}

function cardText(pkg: Pick<StoryPackage, 'scene_cards'> & { facts?: unknown }): string {
  const statements = new Map(
    ((pkg as { facts?: Array<{ fact_ref: string; statement: string }> }).facts ?? []).map((fact) => [
      fact.fact_ref,
      fact.statement,
    ]),
  );
  return pkg.scene_cards
    .flatMap((card) => [
      card.dramatic_function,
      ...card.required_beats,
      ...card.invariants,
      ...[...card.reader_must_learn, ...(card.recounts ?? [])].map((ref) => statements.get(ref) ?? ref),
    ])
    .join(' ')
    .toLowerCase();
}

/** Whether a card uses the verb in any inflection: its base form's stem, or the past form itself. */
function cardsUse(text: string, verb: string): boolean {
  const base = ACTION_VERBS[verb]!;
  const stem = base.endsWith('e') ? base.slice(0, -1) : base;
  return new RegExp(`\\b(${stem}\\w*|${verb})\\b`).test(text);
}

function sentencesOf(prose: string): string[] {
  return (prose.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["'”’)]*|[^.!?]+$/g) ?? []).map((sentence) =>
    sentence.trim(),
  );
}

export function offstageInventions(input: {
  readonly pkg: StoryPackage;
  readonly scene: SceneCard;
  readonly prose: string;
  readonly digest: Pick<SceneDigest, 'established_details'>;
  readonly isTracked: (entityId: string) => boolean;
}): OffstageFinding[] {
  const findings: OffstageFinding[] = [];
  const text = cardText(input.pkg);
  const present = new Set([input.scene.pov, ...input.scene.characters_present]);
  // A token shared with someone on the card (a family surname) names nobody in particular.
  const presentTokens = new Set(
    input.pkg.world_model_seed.characters
      .filter((row) => present.has(row.id))
      .flatMap((row) => nameTokens(row.name)),
  );
  const absent = input.pkg.world_model_seed.characters
    .filter((row) => !present.has(row.id))
    .map((row) => ({ name: row.name, tokens: nameTokens(row.name).filter((token) => !presentTokens.has(token)) }))
    .filter((row) => row.tokens.length > 0);

  // The act must be this scene's to report: the verb is checked against this scene's own card, and
  // the absent character must be its subject ("Clara took", "Fenn had quietly taken"), so a
  // participle used as an adjective ("broken gurneys") is not an act.
  const ownText = cardText({ ...input.pkg, scene_cards: [input.scene] });
  const verbs = Object.keys(ACTION_VERBS).join('|');
  for (const sentence of sentencesOf(input.prose)) {
    for (const row of absent) {
      const match = row.tokens
        .map((token) =>
          new RegExp(`\\b${token}\\b(?:'s)?\\s+(?:had\\s+|has\\s+)?(?:\\w+ly\\s+)?(${verbs})\\b`).exec(sentence),
        )
        .find((found) => found !== null);
      const verb = match?.[1];
      if (verb === undefined || cardsUse(ownText, verb)) continue;
      findings.push({
        kind: 'offstage_report',
        detail: `${row.name}, who is not in this scene, "${verb}" something this scene's card does not author: "${sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence}"`,
      });
      break;
    }
  }

  for (const detail of input.digest.established_details ?? []) {
    if (input.isTracked(detail.entity_id)) continue;
    const words = detail.entity_id
      .toLowerCase()
      .replace(/^(prop|obj|item)_/, '')
      .split(/_+/)
      .filter((word) => word.length >= 4);
    if (words.length === 0 || words.some((word) => text.includes(word))) continue;
    if (findings.some((finding) => finding.kind === 'invented_prop' && finding.detail.includes(detail.entity_id))) continue;
    findings.push({
      kind: 'invented_prop',
      detail: `the prose introduced "${detail.entity_id}" (${detail.attribute}: ${detail.value}), which is on no card and not in the World Model`,
    });
  }
  return findings;
}
