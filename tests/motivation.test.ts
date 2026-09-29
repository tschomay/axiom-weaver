/**
 * Decisive turns happen on the page, for a reason the arc states (#199).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isDecisionText } from '@/arc/decision-text';
import {
  MotivationResponseSchema,
  deriveCandidateStakes,
  motivationCandidates,
  motivationGate,
  motivationPrompt,
} from '@/arc/motivation';
import { lintPackage } from '@/authoring/lint';
import { assemblePrompt, promptText } from '@/assembler/context-assembler';
import { DigestHierarchy } from '@/digest/hierarchy';
import { ToldLedger } from '@/digest/told-ledger';
import { eventsInOrder, readFabulaArc, type FabulaEvent } from '@/schema/fabula';
import { StoryPackageSchema, type SceneCard, type StoryPackage } from '@/schema/story-package';
import { stageDecisionTriggers } from '@/segmentation/segment';
import { buildImageryLedger } from '@/voice/imagery-ledger';
import { cardFromPreset } from '@/voice/voice-card';
import { writerContract } from '@/writer/contract';
import type { ModelClient, ModelRequest, ModelResponse } from '@/writer/model-client';
import { WorldModel } from '@/world-model/world-model';

const BATCH = join(__dirname, '..', 'prototypes', 'story-review', '2026-09-29');
const toll = () => {
  const dir = readdirSync(BATCH).find((name) => name.startsWith('03-'))!;
  const envelope = JSON.parse(readFileSync(join(BATCH, dir, 'package.json'), 'utf8')) as Record<string, unknown>;
  const phases = (envelope['_fabula'] as { brief: { plot_shape: { phases: Array<{ share: number }> } } }).brief
    .plot_shape.phases;
  return { arc: readFabulaArc(envelope).arc, shares: phases.map((phase) => phase.share) };
};

class ScriptedClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly body: unknown | Error) {}
  generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    if (this.body instanceof Error) return Promise.reject(this.body);
    return Promise.resolve({
      model: 'gemini-3.8-flash',
      text: JSON.stringify(this.body),
      finish_reason: 'STOP',
      usage: { prompt_tokens: 1, output_tokens: 1, thoughts_tokens: 0, cached_tokens: 0 },
    });
  }
}

describe('decision text', () => {
  it('recognises the verbs a turn hangs on', () => {
    for (const text of [
      'Julian realizes leaving would be running from reality',
      'she decides to trip the scour',
      'Hester confesses to the company',
      'Helen agrees to share the drydock rent',
      'he gives up Hull',
    ]) {
      expect(isDecisionText(text), text).toBe(true);
    }
    expect(isDecisionText('The tide comes in over the sill.')).toBe(false);
  });
});

describe('the motivation gate on the arc (#199)', () => {
  it('asks about the final phase — which in 03 holds the scour detonation', () => {
    const { arc, shares } = toll();
    const ids = motivationCandidates(arc, shares).map((event) => event.id);
    expect(ids).toContain('ev_11_scour_detonation');
    // Not every event: setup events with no decision in them are not asked about.
    expect(ids.length).toBeLessThan(arc.events.length);
  });

  it('installs a motive beat before the act, from one call', async () => {
    const { arc, shares } = toll();
    const at = eventsInOrder(arc).findIndex((event) => event.id === 'ev_11_scour_detonation');
    const label = `E${String(at + 1).padStart(2, '0')}`;
    const client = new ScriptedClient({
      unmotivated: [
        {
          event: label,
          action: 'Hettie trips the scour',
          why_missing: 'the two events before it argue against it',
          motive_beat: 'Hettie learns the ministry will flood the valley anyway at dawn, with or without her',
        },
      ],
    });
    const gate = await motivationGate(arc, { storyId: 'toll', phaseShares: shares, client, model: 'm' });

    const scour = gate.arc.events.find((event) => event.id === 'ev_11_scour_detonation') as FabulaEvent;
    expect(scour.beats[0]).toMatch(/flood the valley anyway/);
    expect(gate.unmotivated).toBe(1);
    expect(gate.applied).toHaveLength(1);
    expect(gate.call?.stage).toBe('motivation');
    expect(client.requests[0]!.contents).toContain('DECISIVE ACTS');
    expect(client.requests[0]!.contents).toContain(label);
  });

  it('leaves the arc alone when the call fails or finds nothing', async () => {
    const { arc, shares } = toll();
    for (const body of [new Error('down'), { unmotivated: [] }, { nonsense: true }]) {
      const gate = await motivationGate(arc, {
        storyId: 'toll',
        phaseShares: shares,
        client: new ScriptedClient(body),
        model: 'm',
      });
      expect(gate.arc).toEqual(arc);
      expect(gate.applied).toEqual([]);
    }
  });

  it('shows the judge the whole arc, blind', () => {
    const { arc, shares } = toll();
    const prompt = motivationPrompt(arc, 'toll', motivationCandidates(arc, shares));
    expect(prompt).toContain('EVENTS, IN ORDER');
    expect(prompt).not.toContain('ev_11_scour_detonation');
  });
});

const card = (id: string, order: number, beats: string[]): SceneCard =>
  ({
    id,
    order,
    pov: 'char_julian',
    location_id: 'loc_dock',
    characters_present: ['char_julian'],
    dramatic_function: 'f',
    entry_state: {},
    exit_state: {},
    required_beats: beats,
    reader_must_learn: [],
    must_stay_hidden: [],
    force_reintroduce: [],
    invariants: [],
    pays_off: [],
  }) as SceneCard;

const event = (id: string, sequence: number, summary: string, caused_by: string[] = []): FabulaEvent =>
  ({
    id,
    sequence,
    summary,
    characters_present: [],
    beats: [summary],
    caused_by,
    reveals: [],
    conceals: [],
    recounts: [],
    pays_off: [],
    state_changes: [],
  }) as unknown as FabulaEvent;

describe('segmentation: a decision beat never opens its card (#199)', () => {
  it('stages the most recent cause before a card that opens on a decision', () => {
    const events = [
      event('ev_12', 12, 'Clara tells Julian the savings are the family’s last money'),
      event('ev_13', 13, 'Julian is undone'),
      event('ev_14', 14, 'Julian realizes leaving would be running and confesses he cannot go', ['ev_12', 'ev_13']),
    ];
    const scenes = [
      card('s13', 13, ['Julian is undone']),
      card('s14', 14, ['Julian realizes leaving would be running and confesses he cannot go']),
    ];
    expect(stageDecisionTriggers(scenes, [[events[1]!], [events[2]!]], events)).toBe(1);
    expect(scenes[1]!.required_beats[0]).toBe('What pushes this decision now, staged first: Julian is undone');
    expect(scenes[1]!.required_beats).toHaveLength(2);
  });

  it('leaves a decision that already follows a beat, or has no stated cause, alone', () => {
    const events = [event('ev_1', 1, 'She decides to go')];
    const staged = [card('s1', 1, ['The letter arrives', 'She decides to go'])];
    const uncaused = [card('s1', 1, ['She decides to go'])];
    expect(stageDecisionTriggers(staged, [events], events)).toBe(0);
    expect(stageDecisionTriggers(uncaused, [events], events)).toBe(0);
    expect(uncaused[0]!.required_beats).toEqual(['She decides to go']);
  });
});

describe('writer contract: dramatise the decision (#199)', () => {
  const text = (beats: string[]) => {
    const pkg = StoryPackageSchema.parse({
      schema_version: '1.0',
      package_version: 1,
      story_id: 'd',
      world_model_seed: {
        characters: [{ id: 'char_julian', name: 'Julian', location_id: 'loc_dock', status: 'alive' }],
        locations: [{ id: 'loc_dock', name: 'the dock' }],
        objects: [],
        relationships: [],
        character_knowledge: [],
      },
      scene_cards: [card('s1', 1, beats)],
      voice_card: {},
      metadata: { title: 't' },
    }) as StoryPackage;
    const voiceCard = cardFromPreset('gothic_brooding');
    return promptText(
      assemblePrompt({
        pkg,
        scene: pkg.scene_cards[0]!,
        model: WorldModel.fromSeed(pkg.story_id, pkg.world_model_seed),
        voiceCard,
        hierarchy: new DigestHierarchy(4),
        ledger: ToldLedger.forPackage(pkg),
        imageryLedger: buildImageryLedger(voiceCard, []),
        reanchoring: [],
        plantObligations: [],
        payoffInstructions: [],
        previousParagraph: null,
        writerContract: writerContract(),
      }),
    );
  };

  it('tells the writer to put the decision on the page when a beat is one', () => {
    expect(text(['Clara pleads', 'Julian decides to stay'])).toContain(
      'dramatise the moment of decision on the page',
    );
    expect(text(['The tide comes in'])).not.toContain('dramatise the moment of decision');
  });
});

describe('the sharper gate (#218)', () => {
  const tollRandom = () => {
    const dir = readdirSync(join(__dirname, '..', 'prototypes', 'story-review', '2026-09-29-random')).find((name) =>
      name.startsWith('04-'),
    )!;
    return readFabulaArc(
      JSON.parse(
        readFileSync(join(__dirname, '..', 'prototypes', 'story-review', '2026-09-29-random', dir, 'package.json'), 'utf8'),
      ) as Record<string, unknown>,
    ).arc;
  };

  it('derives the stakes the stories dropped: random Toll\'s cavern collapse', () => {
    const stakes = deriveCandidateStakes(tollRandom()).map((stake) => stake.stake);
    expect(stakes.some((stake) => /cavern/.test(stake) && /collapse/.test(stake))).toBe(true);
  });

  it('asks staged-not-stated, contradicted reveals, and lists declared and derived stakes', () => {
    const { arc, shares } = toll();
    const prompt = motivationPrompt(arc, 'toll', motivationCandidates(arc, shares));
    expect(prompt).toContain('WHICH EARLIER EVENT changes this character\'s mind');
    expect(prompt).toContain('stated, not staged');
    expect(prompt).toContain('sudden_collapse');
    expect(prompt).toContain('CONTRADICTED REVEALS');
    expect(prompt).toContain('STAKES.');
    for (const stake of arc.stakes) expect(prompt).toContain(stake.stake);
  });

  it('accepts a kind, and falls back when the model invents one', () => {
    const parsed = MotivationResponseSchema.parse({
      unmotivated: [
        { event: 'E01', kind: 'contradicts_reveal', action: 'a' },
        { event: 'E02', kind: 'made_up', action: 'b' },
      ],
    });
    expect(parsed.unmotivated.map((entry) => entry.kind)).toEqual(['contradicts_reveal', 'no_reason']);
    expect(parsed.unresolved_stakes).toEqual([]);
  });

  it('stages an unresolved stake in its event and declares it, so stake_unresolved holds it', async () => {
    const arc = tollRandom();
    const cavern = deriveCandidateStakes(arc).find((stake) => /cavern/.test(stake.stake))!;
    const last = eventsInOrder(arc)[eventsInOrder(arc).length - 1]!;
    const label = `E${String(eventsInOrder(arc).length).padStart(2, '0')}`;
    const gate = await motivationGate(arc, {
      storyId: 'toll',
      phaseShares: [0.5, 0.5],
      model: 'm',
      client: new ScriptedClient({
        unmotivated: [],
        unresolved_stakes: [
          { stake: cavern.stake, event: label, resolution_beat: 'The ridge settles; the cavern holds on the silt that Teresa counted on' },
        ],
      }),
    });
    const resolved = gate.arc.stakes.find((stake) => stake.stake === cavern.stake);
    expect(resolved).toEqual({ stake: cavern.stake, introduced_by: cavern.introduced_by, resolved_by: last.id });
    const event = gate.arc.events.find((candidate) => candidate.id === last.id)!;
    expect(event.beats[event.beats.length - 1]).toMatch(/cavern holds/);
    expect(gate.applied.some((line) => line.startsWith('stakes:'))).toBe(true);
  });

  it('refuses a resolution placed before the stake is raised', async () => {
    const arc = tollRandom();
    const cavern = deriveCandidateStakes(arc).find((stake) => /cavern/.test(stake.stake))!;
    const gate = await motivationGate(arc, {
      storyId: 'toll',
      phaseShares: [0.5, 0.5],
      model: 'm',
      client: new ScriptedClient({
        unmotivated: [],
        unresolved_stakes: [{ stake: cavern.stake, event: 'E01', resolution_beat: 'too early' }],
      }),
    });
    expect(gate.arc.stakes.some((stake) => stake.stake === cavern.stake)).toBe(false);
  });
});

describe('decision_party_absent (#218)', () => {
  const base = {
    schema_version: '1.0',
    package_version: 1,
    story_id: 'boat',
    world_model_seed: {
      characters: [
        { id: 'char_ruth', name: 'Ruth Miller', location_id: 'loc_boat', status: 'alive' },
        { id: 'char_cleo', name: 'Cleo Miller', location_id: 'loc_boat', status: 'alive' },
        { id: 'char_gent', name: 'the portly gentleman', location_id: 'loc_boat', status: 'alive' },
      ],
      locations: [{ id: 'loc_boat', name: 'the boat' }],
      objects: [],
      relationships: [],
      character_knowledge: [],
    },
    voice_card: {},
    metadata: { title: 't' },
  };
  const scene = (present: string[], beat: string) => ({
    ...base,
    scene_cards: [
      { id: 's6', order: 1, pov: 'char_cleo', location_id: 'loc_boat', characters_present: present, dramatic_function: 'f', entry_state: {}, exit_state: {}, required_beats: [beat] },
    ],
  });
  const codes = (pkg: unknown) => lintPackage(pkg).warnings.map((warning) => warning.code);

  it('warns when a reconciliation turns on someone not in the scene', () => {
    expect(codes(scene(['char_cleo'], 'Cleo and Ruth reconcile over the urn'))).toContain('decision_party_absent');
    expect(codes(scene(['char_cleo', 'char_ruth'], 'Cleo and Ruth reconcile over the urn'))).not.toContain('decision_party_absent');
    expect(codes(scene(['char_cleo'], 'Cleo walks Ruth to the harbour'))).not.toContain('decision_party_absent');
    // A name with no capitalised word is never matched ("the portly gentleman" → "the").
    expect(codes(scene(['char_cleo'], 'Cleo apologizes to the gentleman'))).not.toContain('decision_party_absent');
  });
});
