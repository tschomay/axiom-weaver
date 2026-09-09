import { describe, expect, it } from 'vitest';
import { ToldLedger, metFact, entityOfMetFact, type Centrality } from '@/digest/told-ledger';
import {
  BAND_CUTOFFS,
  bandFor,
  bandInstruction,
  bandMismatches,
  reanchorDecisions,
  renderReanchoring,
} from '@/assembler/reanchoring';

function ledgerWith(entries: Array<[string, Centrality, number]>): ToldLedger {
  const centralities = new Map<string, Centrality>(
    entries.map(([id, centrality]) => [id, centrality]),
  );
  const ledger = new ToldLedger(centralities);
  for (const [id, , lastTouched] of entries) ledger.touch(metFact(id), lastTouched);
  return ledger;
}

describe('re-anchoring bands (ADR 0009 decision 3)', () => {
  it('scales cutoffs by centrality', () => {
    expect(bandFor('high', 5)).toBe('assume');
    expect(bandFor('high', 6)).toBe('reanchor');
    expect(bandFor('high', 41)).toBe('reintroduce');

    expect(bandFor('medium', 3)).toBe('assume');
    expect(bandFor('medium', 4)).toBe('reanchor');
    expect(bandFor('medium', 16)).toBe('reintroduce');

    expect(bandFor('low', 1)).toBe('assume');
    expect(bandFor('low', 2)).toBe('reanchor');
    expect(bandFor('low', 7)).toBe('reintroduce');
  });

  it('treats a never-touched entity as a first introduction', () => {
    expect(bandFor('high', null)).toBe('introduce');
    expect(bandFor('low', null)).toBe('introduce');
  });

  it('keeps the cutoff table consistent with itself', () => {
    for (const centrality of ['low', 'medium', 'high'] as const) {
      const cutoffs = BAND_CUTOFFS[centrality];
      expect(cutoffs.assume).toBeLessThan(cutoffs.reanchor);
    }
  });
});

describe('per-entity decisions', () => {
  const ledger = ledgerWith([
    ['char_marcus', 'high', 10],
    ['obj_ring', 'low', 8],
  ]);

  it('computes the gap against the current scene order', () => {
    const decisions = reanchorDecisions({
      entityIds: ['char_marcus', 'obj_ring', 'char_new'],
      sceneOrder: 12,
      ledger,
      forceReintroduce: [],
      nameOf: (id) => ({ char_marcus: 'Marcus', obj_ring: 'the pawnshop ring' })[id] ?? null,
    });

    expect(decisions[0]).toMatchObject({ scenes_since_last_touch: 2, band: 'assume' });
    expect(decisions[1]).toMatchObject({ scenes_since_last_touch: 4, band: 'reanchor' });
    expect(decisions[2]).toMatchObject({ scenes_since_last_touch: null, band: 'introduce' });
    // Falls back to the id when there is no display name, rather than rendering "null".
    expect(decisions[2]?.name).toBe('char_new');
  });

  it('lets force_reintroduce override the computed band', () => {
    const decisions = reanchorDecisions({
      entityIds: ['char_marcus'],
      sceneOrder: 11,
      ledger,
      forceReintroduce: ['char_marcus'],
      nameOf: () => 'Marcus',
    });
    expect(decisions[0]).toMatchObject({ band: 'reintroduce', forced: true });
  });

  it('accepts the override written as the met: fact, which is how the ledger keys it', () => {
    const decisions = reanchorDecisions({
      entityIds: ['char_marcus'],
      sceneOrder: 11,
      ledger,
      forceReintroduce: [metFact('char_marcus')],
      nameOf: () => 'Marcus',
    });
    expect(decisions[0]?.forced).toBe(true);
  });

  it('renders an annotated list carrying the craft rule, not just the band name', () => {
    const rendered = renderReanchoring(
      reanchorDecisions({
        entityIds: ['obj_ring'],
        sceneOrder: 12,
        ledger,
        forceReintroduce: [],
        nameOf: () => 'the pawnshop ring',
      }),
    );
    expect(rendered).toContain('the pawnshop ring');
    expect(rendered).toContain('4 scenes since last touch');
    expect(rendered).toContain('distinguishing clause');
  });

  it('spells out what each band asks for', () => {
    expect(bandInstruction('assume')).toContain('no re-explanation');
    expect(bandInstruction('reanchor')).toContain('distinguishing clause');
    expect(bandInstruction('reintroduce')).toContain('as if newly met');
    expect(bandInstruction('introduce')).toContain('first appearance');
  });
});

describe('told-ledger miscalibration (ADR 0009 decision 8)', () => {
  const expected = reanchorDecisions({
    entityIds: ['char_marcus'],
    sceneOrder: 20,
    ledger: ledgerWith([['char_marcus', 'high', 10]]),
    forceReintroduce: [],
    nameOf: () => 'Marcus',
  });

  it('flags a band the writer used that the ledger did not imply', () => {
    expect(expected[0]?.band).toBe('reanchor');
    const mismatches = bandMismatches(expected, [{ entity_id: 'char_marcus', band: 'assume' }]);
    expect(mismatches).toEqual([
      { entity_id: 'char_marcus', expected: 'reanchor', used: 'assume' },
    ]);
  });

  it('accepts a matching band, and ignores an entity the writer never reported', () => {
    expect(bandMismatches(expected, [{ entity_id: 'char_marcus', band: 'reanchor' }])).toEqual([]);
    expect(bandMismatches(expected, [])).toEqual([]);
  });

  it('treats introduce and reintroduce as equivalent — they share one instruction', () => {
    const firstTime = reanchorDecisions({
      entityIds: ['char_new'],
      sceneOrder: 1,
      ledger: new ToldLedger(),
      forceReintroduce: [],
      nameOf: () => 'Newcomer',
    });
    expect(firstTime[0]?.band).toBe('introduce');
    expect(bandMismatches(firstTime, [{ entity_id: 'char_new', band: 'reintroduce' }])).toEqual([]);
  });
});

describe('the met: fact convention (ADR 0003 decision 4)', () => {
  it('round-trips an entity id through its met: fact', () => {
    expect(metFact('char_marcus')).toBe('met:char_marcus');
    expect(entityOfMetFact('met:char_marcus')).toBe('char_marcus');
    // A plot fact is not an entity, and must not be mistaken for one.
    expect(entityOfMetFact('loose_stair_rail')).toBeNull();
  });
});
