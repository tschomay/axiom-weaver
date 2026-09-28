/**
 * Every concealed fact is revealed somewhere, and every hidden cause has a stated cause (#180).
 */

import { describe, expect, it } from 'vitest';
import { StoryPackageSchema, type SceneCard } from '@/schema/story-package';
import { FABULA_BLOCK, FabulaArcSchema, type FabulaArc, type FabulaEvent } from '@/schema/fabula';
import { lintPackage } from '@/authoring/lint';
import { hiddenAccountProblems, lintFabulaArc } from '@/authoring/lint-fabula';
import { applyEdits, repairPrompt, repairTargets } from '@/arc/repair';
import { assignConcealedReveals, solutionEventIds } from '@/segmentation/segment';
import { materializePlotShape } from '@/arc/brief';

const SEED = {
  characters: [{ id: 'char_nita', name: 'Nita', location_id: 'loc_slip', status: 'alive' }],
  locations: [{ id: 'loc_slip', name: 'the slip' }],
  objects: [],
  relationships: [],
  character_knowledge: [],
};

function card(id: string, order: number, fields: Partial<SceneCard> = {}): Record<string, unknown> {
  return {
    id,
    order,
    pov: 'char_nita',
    location_id: 'loc_slip',
    characters_present: ['char_nita'],
    dramatic_function: 'f',
    entry_state: {},
    exit_state: {},
    required_beats: ['b'],
    ...fields,
  };
}

function pkg(cards: Record<string, unknown>[]) {
  return {
    schema_version: '1.0',
    package_version: 1,
    story_id: 'concealed',
    world_model_seed: SEED,
    scene_cards: cards,
    metadata: { title: 't' },
  };
}

const codes = (input: unknown) => lintPackage(input).warnings.map((warning) => warning.code);

describe('concealed_never_revealed', () => {
  it('warns when a withheld fact is never shown later', () => {
    const result = lintPackage(
      pkg([card('s1', 1, { must_stay_hidden: ['rudder_cause'] }), card('s2', 2)]),
    );
    const warning = result.warnings.find((w) => w.code === 'concealed_never_revealed');
    expect(warning?.path).toBe('scene_cards.s1.must_stay_hidden');
    expect(warning?.message).toMatch(/rudder_cause/);
  });

  it('is satisfied by a later reader_must_learn or pays_off', () => {
    expect(
      codes(
        pkg([
          card('s1', 1, { must_stay_hidden: ['rudder_cause'] }),
          card('s2', 2, { reader_must_learn: ['rudder_cause'] }),
        ]),
      ),
    ).not.toContain('concealed_never_revealed');
  });

  it('does not ask a revealed secret to be paid off a second time', () => {
    const warnings = codes(
      pkg([
        card('s1', 1, { must_stay_hidden: ['rudder_cause'] }),
        card('s2', 2, { reader_must_learn: ['rudder_cause', 'loose_rail'] }),
      ]),
    );
    // `loose_rail` was never withheld, so it still owes a payoff; the solution does not.
    expect(warnings.filter((code) => code === 'unpaid_fact')).toHaveLength(1);
  });
});

function event(id: string, sequence: number, fields: Partial<FabulaEvent> = {}): Record<string, unknown> {
  return {
    id,
    sequence,
    summary: `event ${id}`,
    pov: 'char_nita',
    location_id: 'loc_slip',
    characters_present: ['char_nita'],
    dramatic_function: 'f',
    beats: ['b'],
    ...fields,
  };
}

function arc(fields: Record<string, unknown> = {}): FabulaArc {
  return FabulaArcSchema.parse({
    title: 't',
    world_model_seed: SEED,
    events: [event('ev_01', 1, { conceals: ['rudder_cause'] }), event('ev_02', 2)],
    ...fields,
  });
}

describe('the hidden account', () => {
  const steps = [
    { id: 'hidden_01', sequence: 1, summary: 'Stops pulled.', caused_by: [], establishes: ['stops_pulled'] },
    { id: 'hidden_02', sequence: 2, summary: 'Jesse reverses.', caused_by: [], establishes: ['reversed'] },
    { id: 'hidden_03', sequence: 3, summary: 'Rudder jams.', caused_by: ['hidden_04'], establishes: [] },
    { id: 'hidden_04', sequence: 4, summary: 'Gland tears.', caused_by: ['hidden_03'], establishes: ['torn'] },
  ];

  it('names the uncaused step, the backwards cause and the empty step', () => {
    const problems = hiddenAccountProblems(arc({ hidden_account: steps })).map(
      (problem) => `${problem.code}@${problem.path.split('.').at(-1)}`,
    );
    expect(problems.sort()).toEqual([
      'hidden_cause_not_earlier@hidden_03',
      'hidden_step_establishes_nothing@hidden_03',
      'uncaused_hidden_event@hidden_02',
    ]);
    expect(lintFabulaArc(arc({ hidden_account: steps }), 'x').errors.map((e) => e.code)).toContain(
      'uncaused_hidden_event',
    );
  });

  it('is a repair target, and add_hidden_cause repairs it with a reason', () => {
    const broken = arc({ hidden_account: steps.slice(0, 2) });
    expect(repairTargets(broken, 'x').map((target) => target.code)).toContain('uncaused_hidden_event');
    expect(repairPrompt(broken, repairTargets(broken, 'x'))).toContain('THE HIDDEN ACCOUNT');

    const fixed = applyEdits(broken, [
      {
        kind: 'add_hidden_cause',
        event_id: 'hidden_02',
        fact_ref: '',
        plant_event_id: 'hidden_01',
        text: 'Jesse reverses because the ferry is drifting onto the weir.',
        character_id: '',
        because: '',
      },
    ]).arc;
    expect(fixed.hidden_account[1]!.caused_by).toEqual(['hidden_01']);
    expect(fixed.hidden_account[1]!.summary).toMatch(/because/);
    expect(hiddenAccountProblems(fixed)).toEqual([]);
  });
});

describe('the mystery gate', () => {
  it('promotes concealed_never_revealed for a mystery only', () => {
    const concealing = arc();
    expect(
      repairTargets(concealing, 'x', { plotShapeId: 'mystery' }).map((t) => t.code),
    ).toContain('concealed_never_revealed');
    expect(
      repairTargets(concealing, 'x', { plotShapeId: 'courtship' }).map((t) => t.code),
    ).not.toContain('concealed_never_revealed');
  });
});

describe('segmentation gives a concealed fact a reveal scene', () => {
  const scenes = (): SceneCard[] =>
    StoryPackageSchema.parse(
      pkg([
        card('s1', 1, { must_stay_hidden: ['rudder_cause'] }),
        card('s2', 2),
        card('s3', 3),
      ]),
    ).scene_cards;
  const ev = (id: string, sequence: number, fields: Partial<FabulaEvent> = {}) =>
    FabulaArcSchema.parse({ title: 't', world_model_seed: SEED, events: [event(id, sequence, fields)] })
      .events[0]!;

  it('prefers the scene whose event pays it off', () => {
    const cards = scenes();
    const assigned = assignConcealedReveals(
      cards,
      [[ev('e1', 1)], [ev('e2', 2)], [ev('e3', 3, { pays_off: [{ fact_ref: 'rudder_cause', plant: null }] })]],
      new Set(['e2']),
    );
    expect(assigned).toBe(1);
    expect(cards[2]!.reader_must_learn).toEqual(['rudder_cause']);
    expect(cards[1]!.reader_must_learn).toEqual([]);
  });

  it('falls back to the Solution-phase scene, and invents nothing without one', () => {
    const cards = scenes();
    assignConcealedReveals(cards, [[ev('e1', 1)], [ev('e2', 2)], [ev('e3', 3)]], new Set(['e2']));
    expect(cards[1]!.reader_must_learn).toEqual(['rudder_cause']);

    const untouched = scenes();
    expect(assignConcealedReveals(untouched, [[ev('e1', 1)], [ev('e2', 2)], [ev('e3', 3)]], new Set())).toBe(0);
    expect(untouched.flatMap((scene) => scene.reader_must_learn)).toEqual([]);
  });

  it("finds the Solution phase's events from the brief the arc carries", () => {
    const mystery = materializePlotShape('mystery');
    const events = Array.from({ length: 10 }, (_, index) =>
      ev(`e${index + 1}`, index + 1),
    );
    const ids = solutionEventIds({ [FABULA_BLOCK]: { brief: { plot_shape: mystery } } }, events);
    // Mystery's shares 0.2 / 0.35 / 0.2 / 0.15 / 0.1 over ten events allocate [2, 4, 2, 1, 1]
    // (the largest-remainder path in `phaseEventCounts`), so the Solution phase is event 9 alone.
    expect([...ids]).toEqual(['e9']);
    expect(solutionEventIds({}, events).size).toBe(0);
  });
});
