/**
 * The motivation gate (#199): a decisive act in a generated arc must have a reason the arc states.
 *
 * Panel batch 2026-09-29's character reviewer found the same top finding in all five stories: a
 * key decision made between scenes or with no visible reason. In `03`, Hettie trips the scour
 * right after the only two events before it argue against it; `ev_11` is `caused_by` both, so the
 * causal link exists and the motive does not. The judge already asks this question (#192's
 * unmotivated-actions criterion, `judge.ts`), but only after the fact, about a finished package.
 *
 * This asks it at generation time, of the events where it matters most — the final phase, where
 * the climax is, and any event whose summary or beats turn on a decision — and repairs in the same
 * call: for each unmotivated act, a beat that stages the reason on the page, just before it.
 * Nothing is inferred mechanically; the reason has to come from the arc's own people and events.
 */

import { z } from 'zod';

import { provisionalPackage } from '../authoring/lint-fabula';
import { eventsInOrder, type FabulaArc, type FabulaEvent } from '../schema/fabula';
import { blindArcView } from './judge';
import { isDecisionText } from './decision-text';
import { ARC_SYSTEM_INSTRUCTION, phaseEventCounts } from './prompt';
import type { GenerationCall } from './generator';
import type { ModelClient } from '../writer/model-client';

export { DECISION_PATTERN, isDecisionText } from './decision-text';

/**
 * The events the gate asks about: every event of the brief's last phase, plus any event whose
 * summary or beats turn on a decision. Phases are recovered by count, as `solutionEventIds` does.
 */
export function motivationCandidates(arc: FabulaArc, phaseShares: readonly number[]): FabulaEvent[] {
  const events = eventsInOrder(arc);
  const counts = phaseShares.length === 0 ? [] : phaseEventCounts(phaseShares, events.length);
  const finalCount = counts[counts.length - 1] ?? 0;
  const finalIds = new Set(events.slice(events.length - finalCount).map((event) => event.id));
  return events.filter(
    (event) =>
      finalIds.has(event.id) ||
      isDecisionText(event.summary) ||
      event.beats.some((beat) => isDecisionText(beat)),
  );
}

/** Why an act was flagged (#218). */
export const MOTIVATION_KINDS = [
  'no_reason',
  'stated_not_staged',
  'sudden_collapse',
  'contradicts_reveal',
] as const;

export const MotivationResponseSchema = z.object({
  unmotivated: z
    .array(
      z.object({
        event: z.string(),
        kind: z.enum(MOTIVATION_KINDS).catch('no_reason').default('no_reason'),
        action: z.string().default(''),
        why_missing: z.string().default(''),
        motive_beat: z.string().default(''),
      }),
    )
    .default([]),
  /** Stakes no later event resolves on the page, and the event that should (#218). */
  unresolved_stakes: z
    .array(
      z.object({
        stake: z.string(),
        event: z.string(),
        resolution_beat: z.string().default(''),
      }),
    )
    .default([]),
});

/**
 * Candidate stakes the arc may not have declared (#218): every revealed fact whose statement names
 * a number, a deadline, a debt or a threat, and every seed object two or more event summaries name.
 * The #204 re-run's dropped stakes were exactly these — the title's bill, a sixty-pound shortfall,
 * a cavern that would collapse — while every declared stake had a resolving event.
 */
export function deriveCandidateStakes(arc: FabulaArc): Array<{ stake: string; introduced_by: string }> {
  const events = eventsInOrder(arc);
  const statement = new Map(arc.facts.map((fact) => [fact.fact_ref, fact.statement]));
  const candidates: Array<{ stake: string; introduced_by: string }> = [];
  const seen = new Set<string>();
  for (const event of events) {
    for (const fact of event.reveals) {
      const text = statement.get(fact) ?? '';
      if (seen.has(fact) || !STAKE_PATTERN.test(text)) continue;
      seen.add(fact);
      candidates.push({ stake: text, introduced_by: event.id });
    }
  }
  for (const object of arc.world_model_seed.objects) {
    const name = object.name.toLowerCase().replace(/^(the|a|an)\s+/, '');
    if (name.length < 3) continue;
    const naming = events.filter((event) => event.summary.toLowerCase().includes(name));
    if (naming.length < 2) continue;
    candidates.push({ stake: `what becomes of ${object.name}`, introduced_by: naming[0]!.id });
  }
  return candidates;
}

const STAKE_PATTERN =
  /(£|\$|\b(pounds|dollars|deadline|due|debt|owe[sd]?|unless|before (dawn|dusk|midnight|morning|nightfall)|by (dawn|dusk|midnight|morning|monday|friday|sunday)|within|threat|threaten|collapse|evict|foreclos|ruin|lose|lost|die|kill|drown|flood|pay|paid|shortfall|short by|hundred|thousand)\b|\b(in|within|for) (a |two |three |\w+ )?(days|weeks|months|hours)\b)/i;

export type MotivationResponse = z.infer<typeof MotivationResponseSchema>;

export function motivationResponseJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      unmotivated: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            event: { type: 'string', description: 'The E-number, e.g. "E07".' },
            kind: {
              type: 'string',
              enum: [...MOTIVATION_KINDS],
              description:
                'no_reason: nothing gives one. stated_not_staged: a reason is named but no earlier event on the page produces it. sudden_collapse: an antagonist confesses or collapses with no pressure event before. contradicts_reveal: the act contradicts or ignores a fact revealed earlier.',
            },
            action: { type: 'string', description: 'Who does what.' },
            why_missing: { type: 'string', description: 'The reason the skeleton never gives.' },
            motive_beat: {
              type: 'string',
              description:
                'One beat, staged on the page just before the act, that gives this character a ' +
                'reason to do it now — built only from people, facts and events already in the arc.',
            },
          },
          required: ['event', 'kind', 'action', 'why_missing', 'motive_beat'],
          propertyOrdering: ['event', 'kind', 'action', 'why_missing', 'motive_beat'],
        },
      },
      unresolved_stakes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            stake: { type: 'string', description: 'The stake, as listed.' },
            event: { type: 'string', description: 'The LATER E-number that should resolve it on the page.' },
            resolution_beat: {
              type: 'string',
              description: 'One beat that shows it resolved, or a character explicitly letting it go — never an assertion.',
            },
          },
          required: ['stake', 'event', 'resolution_beat'],
          propertyOrdering: ['stake', 'event', 'resolution_beat'],
        },
      },
    },
    required: ['unmotivated', 'unresolved_stakes'],
    propertyOrdering: ['unmotivated', 'unresolved_stakes'],
  };
}

/** E-number of an event in the blind view, which labels events by position. */
function labelOf(arc: FabulaArc): Map<string, string> {
  return new Map(
    eventsInOrder(arc).map((event, index) => [`E${String(index + 1).padStart(2, '0')}`, event.id]),
  );
}

export function motivationPrompt(arc: FabulaArc, storyId: string, candidates: readonly FabulaEvent[]): string {
  const byId = new Map([...labelOf(arc)].map(([label, id]) => [id, label]));
  const asked = candidates.map((event) => byId.get(event.id)).filter((label) => label !== undefined);
  const label = (id: string): string => byId.get(id) ?? id;
  const stakes = [
    ...arc.stakes.map((stake) => ({ stake: stake.stake, introduced_by: stake.introduced_by, declared: true })),
    ...deriveCandidateStakes(arc).map((stake) => ({ ...stake, declared: false })),
  ];
  return [
    blindArcView(provisionalPackage(arc, storyId)),
    '',
    `DECISIVE ACTS. Look only at these events: ${asked.join(', ')}. In each, find the DELIBERATE`,
    'act a character commits that the story turns on — a choice, a confession, a betrayal, a',
    'reversal, a refusal, a change of heart. Ask: WHICH EARLIER EVENT changes this character\'s mind,',
    'and is that event on the page, before the act? Do not supply one yourself. A reason that is',
    'only a word in a summary ("undone", "broken", "moved") is stated, not staged. If the events',
    'just before it argue against the act, or the reason arrives afterwards, or you would have to',
    'guess, flag it. An antagonist who confesses or collapses in the final events with no pressure',
    'event before it is a sudden_collapse. Accidents and forces of nature are not acts.',
    '',
    'CONTRADICTED REVEALS. Also flag any act that contradicts or ignores a fact the reader learned',
    'earlier — a danger the story established, a lie the reader watched a character tell. Its',
    'motive_beat must confront that fact on the page: the character weighs it, and the beat gives',
    'the reason the act still happens (or the fact is shown to be wrong).',
    '',
    'For each flagged act write motive_beat: one beat to stage on the page just before the act —',
    'pressure, a discovery, a cost, a person — using only people, facts and events already in the',
    'skeleton. List none rather than pad the list.',
    '',
    'STAKES. Each of these is something the reader has been told to worry about:',
    ...(stakes.length === 0
      ? ['  (none)']
      : stakes.map((stake) => `  - ${stake.stake} (raised in ${label(stake.introduced_by)}${stake.declared ? '' : ', not declared'})`)),
    'For each that no LATER event resolves ON THE PAGE — resolved, or a character explicitly letting',
    'it go, not merely asserted in a summary — list it under unresolved_stakes with the later event',
    'that should resolve it and a resolution_beat that shows it.',
  ].join('\n');
}

export interface MotivationRepair {
  readonly arc: FabulaArc;
  /** One line per beat installed, for the run report. */
  readonly applied: string[];
}

/** Install each motive beat first among its event's beats, so the reason is staged before the act. */
export function applyMotiveBeats(arc: FabulaArc, response: MotivationResponse): MotivationRepair {
  const labels = labelOf(arc);
  const applied: string[] = [];
  const beatsFor = new Map<string, string[]>();
  for (const entry of response.unmotivated) {
    const id = labels.get(entry.event.trim().toUpperCase()) ?? (arc.events.some((e) => e.id === entry.event) ? entry.event : undefined);
    const beat = entry.motive_beat.trim();
    if (id === undefined || beat === '') continue;
    beatsFor.set(id, [...(beatsFor.get(id) ?? []), beat]);
    applied.push(`motivation: ${id} gained a motive beat for "${entry.action}"`);
  }
  // #218: an unresolved stake gets its resolution staged in the named event, and is declared, so
  // `stake_unresolved` holds it from then on.
  const derived = deriveCandidateStakes(arc);
  const resolveBeats = new Map<string, string[]>();
  const stakes = arc.stakes.map((stake) => ({ ...stake }));
  const sequenceOf = new Map(arc.events.map((event) => [event.id, event.sequence]));
  for (const entry of response.unresolved_stakes ?? []) {
    const id = labels.get(entry.event.trim().toUpperCase()) ?? (arc.events.some((e) => e.id === entry.event) ? entry.event : undefined);
    const beat = entry.resolution_beat.trim();
    if (id === undefined || beat === '') continue;
    const known =
      stakes.find((stake) => stake.stake === entry.stake) ??
      derived.find((stake) => stake.stake === entry.stake);
    const introducedBy = known?.introduced_by ?? '';
    if (introducedBy !== '' && (sequenceOf.get(introducedBy) ?? 0) >= (sequenceOf.get(id) ?? 0)) continue;
    resolveBeats.set(id, [...(resolveBeats.get(id) ?? []), beat]);
    const declared = stakes.find((stake) => stake.stake === entry.stake);
    if (declared === undefined) stakes.push({ stake: entry.stake, introduced_by: introducedBy, resolved_by: id });
    else declared.resolved_by = id;
    applied.push(`stakes: ${id} now resolves "${entry.stake}" on the page`);
  }
  if (beatsFor.size === 0 && resolveBeats.size === 0) return { arc, applied };
  return {
    arc: {
      ...arc,
      stakes,
      events: arc.events.map((event) => {
        const before = beatsFor.get(event.id) ?? [];
        const after = resolveBeats.get(event.id) ?? [];
        return before.length === 0 && after.length === 0
          ? event
          : { ...event, beats: [...before, ...event.beats, ...after] };
      }),
    },
    applied,
  };
}

export interface MotivationGateResult extends MotivationRepair {
  /** Candidate events asked about. */
  readonly checked: number;
  /** Acts the answer found unmotivated. */
  readonly unmotivated: number;
  /** The call made, for the generation report; `null` when none was needed or it failed. */
  readonly call: GenerationCall | null;
}

/**
 * Ask about the candidates and install the motive beats, in one call. A failed call or an
 * unparseable answer leaves the arc exactly as it was — which is what it would have been without
 * the gate — rather than failing a generation that otherwise passed.
 */
export async function motivationGate(
  arc: FabulaArc,
  options: {
    readonly storyId: string;
    readonly phaseShares: readonly number[];
    readonly client: ModelClient;
    readonly model: string;
  },
): Promise<MotivationGateResult> {
  const unchanged = { arc, applied: [], checked: 0, unmotivated: 0, call: null };
  const candidates = motivationCandidates(arc, options.phaseShares);
  if (candidates.length === 0) return unchanged;

  const startedAt = Date.now();
  const response = await options.client
    .generate({
      model: options.model,
      systemInstruction: ARC_SYSTEM_INSTRUCTION,
      contents: motivationPrompt(arc, options.storyId, candidates),
      responseJsonSchema: motivationResponseJsonSchema(),
      maxOutputTokens: MOTIVATION_MAX_OUTPUT_TOKENS,
      thinkingLevel: 'MEDIUM',
    })
    .catch(() => null);
  if (response === null) return { ...unchanged, checked: candidates.length };

  const call: GenerationCall = {
    stage: 'motivation',
    model: response.model,
    finish_reason: response.finish_reason,
    prompt_tokens: response.usage.prompt_tokens,
    output_tokens: response.usage.output_tokens,
    thoughts_tokens: response.usage.thoughts_tokens,
    ms: Date.now() - startedAt,
  };
  let parsed: MotivationResponse | null = null;
  if (response.finish_reason === 'STOP') {
    try {
      const text = response.text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
      const result = MotivationResponseSchema.safeParse(JSON.parse(text));
      if (result.success) parsed = result.data;
    } catch {
      parsed = null;
    }
  }
  if (parsed === null) return { ...unchanged, checked: candidates.length, call };

  const repaired = applyMotiveBeats(arc, parsed);
  return {
    ...repaired,
    checked: candidates.length,
    unmotivated: parsed.unmotivated.length,
    call,
  };
}

export const MOTIVATION_MAX_OUTPUT_TOKENS = 4_000;
