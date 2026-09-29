/**
 * Every stake the arc raises is answered on the page (#200).
 */

import { describe, expect, it } from 'vitest';

import { draftPackage } from '@/arc/fabula';
import { briefsFor } from '@/arc/premises';
import { arcResponseJsonSchema, renderArcPrompt } from '@/arc/prompt';
import { applyEdits, repairPrompt, repairTargets } from '@/arc/repair';
import { lintFabulaArc, stakeProblems } from '@/authoring/lint-fabula';
import { FabulaArcSchema, readFabulaArc, type FabulaArc } from '@/schema/fabula';
import { writerContract } from '@/writer/contract';

function arc(stakes: Array<{ stake: string; introduced_by: string; resolved_by: string }>): FabulaArc {
  return FabulaArcSchema.parse({
    title: 'the apprentice’s bill',
    world_model_seed: {
      characters: [{ id: 'char_julien', name: 'Julien', location_id: 'loc_kitchen', status: 'alive' }],
      locations: [{ id: 'loc_kitchen', name: 'the kitchen' }],
      objects: [],
      relationships: [],
      character_knowledge: [],
    },
    events: [
      { id: 'ev_01', sequence: 1, summary: 'The critic Giles Lambert is seated.', characters_present: ['char_julien'], beats: ['b'] },
      { id: 'ev_02', sequence: 2, summary: 'The tart fails.', characters_present: ['char_julien'], beats: ['b'], caused_by: ['ev_01'] },
      { id: 'ev_03', sequence: 3, summary: 'The aftermath.', characters_present: ['char_julien'], beats: ['b'], caused_by: ['ev_02'] },
    ],
    stakes,
  });
}

describe('stake_unresolved (#200)', () => {
  it('is an error when no event answers a stake, or a named one does not exist', () => {
    const problems = stakeProblems(
      arc([
        { stake: 'the critic must taste the dish tonight', introduced_by: 'ev_01', resolved_by: '' },
        { stake: 'the rent is due', introduced_by: 'ev_01', resolved_by: 'ev_99' },
      ]),
    );
    expect(problems.map((problem) => [problem.code, problem.severity, problem.path])).toEqual([
      ['stake_unresolved', 'error', '_fabula.stakes[0]'],
      ['stake_unresolved', 'error', '_fabula.stakes[1]'],
    ]);
  });

  it('is an error when the answer comes before the stake is raised', () => {
    expect(stakeProblems(arc([{ stake: 's', introduced_by: 'ev_03', resolved_by: 'ev_02' }]))).toHaveLength(1);
  });

  it('passes a stake a later event answers, and an arc with none', () => {
    expect(stakeProblems(arc([{ stake: 's', introduced_by: 'ev_01', resolved_by: 'ev_03' }]))).toEqual([]);
    expect(stakeProblems(arc([]))).toEqual([]);
  });

  it('is a repair target in every plot shape, and a Fabula lint error', () => {
    const dropped = arc([{ stake: 'the critic must taste the dish', introduced_by: 'ev_01', resolved_by: '' }]);
    expect(repairTargets(dropped, 'x').map((target) => target.code)).toContain('stake_unresolved');
    expect(lintFabulaArc(dropped, 'x').errors.map((error) => error.code)).toContain('stake_unresolved');
    expect(repairPrompt(dropped, repairTargets(dropped, 'x'))).toContain(
      '0. the critic must taste the dish — ev_01 → NOTHING',
    );
  });
});

describe('resolve_stake repair (#200)', () => {
  const dropped = arc([{ stake: 'the critic must taste the dish', introduced_by: 'ev_01', resolved_by: '' }]);
  const edit = (event_id: string) => ({
    kind: 'resolve_stake' as const,
    event_id,
    fact_ref: '0',
    plant_event_id: '',
    text: 'Lambert tastes the saved dessert and says nothing',
    character_id: '',
    because: '',
  });

  it('points the stake at the answering event and stages the answer as a beat', () => {
    const { arc: repaired, applied } = applyEdits(dropped, [edit('ev_03')]);
    expect(repaired.stakes[0]!.resolved_by).toBe('ev_03');
    expect(repaired.events.find((event) => event.id === 'ev_03')!.beats).toContain(
      'Lambert tastes the saved dessert and says nothing',
    );
    expect(applied).toHaveLength(1);
    expect(repairTargets(repaired, 'x').map((target) => target.code)).not.toContain('stake_unresolved');
  });

  it('refuses an answer that comes before the stake', () => {
    const { arc: repaired } = applyEdits(dropped, [edit('ev_01')]);
    expect(repaired.stakes[0]!.resolved_by).toBe('');
  });
});

describe('stakes through generation (#200)', () => {
  it('asks the generator for every stake and the event that answers it', () => {
    const brief = briefsFor('structured', 6)[0]!;
    expect(renderArcPrompt(brief)).toContain('STAKES — after the facts');
    const schema = arcResponseJsonSchema(6) as { required: string[] };
    expect(schema.required).toContain('stakes');
  });

  it('rides the _fabula block and reads back', () => {
    const answered = arc([{ stake: 's', introduced_by: 'ev_01', resolved_by: 'ev_03' }]);
    const brief = briefsFor('structured', 6)[0]!;
    const envelope = draftPackage(answered, 'x', {
      generator: 'test',
      model: 'm',
      generated_at: '2026-09-29T00:00:00Z',
      brief,
      repairs: [],
    });
    expect(readFabulaArc(envelope).arc.stakes).toEqual(answered.stakes);
  });

  it('tells the writer never to report an offstage mechanism', () => {
    expect(writerContract()).toContain('Never report an offstage swap, visit, discovery or conversation');
  });
});
