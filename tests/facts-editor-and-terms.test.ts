/**
 * The facts table's editor form (ADR 0022) and glossed-term tracking (#182's deferred half).
 */

import { describe, expect, it } from 'vitest';
import { DraftStoryPackageSchema } from '@/schema/manuscript';
import {
  causalPreview,
  draftFacts,
  factRefsInUse,
  sectionForPath,
  unstatedFactRefs,
  withFacts,
} from '@/authoring/editor-model';
import { ToldLedger, termFact } from '@/digest/told-ledger';
import { SceneDigestSchema, rollUp, sceneDigestEntry } from '@/digest/scene-digest';
import { concatenatingSummarizer } from '@/digest/hierarchy';
import { writerContract } from '@/writer/contract';
import { writerResponseJsonSchema } from '@/writer/response-schema';

const DRAFT = DraftStoryPackageSchema.parse({
  story_id: 'draft',
  metadata: { title: 'Draft' },
  world_model_seed: {
    character_knowledge: [{ id: 'ck_1', character_id: 'char_a', fact_ref: 'seeded_fact', learned_at_scene: null }],
  },
  scene_cards: [
    { id: 's2', order: 2, reader_must_learn: ['rudder_jammed'], pays_off: [{ fact_ref: 'stops_removed', plant: 's1' }] },
    { id: 's1', order: 1, reader_must_learn: ['stops_removed'], must_stay_hidden: ['rudder_jammed'] },
  ],
});

describe('the facts form', () => {
  it('offers every slug the cards use, in first-use order, minus the stated ones', () => {
    expect(factRefsInUse(DRAFT)).toEqual(['stops_removed', 'rudder_jammed', 'seeded_fact']);
    const stated = withFacts(DRAFT, [{ fact_ref: 'stops_removed', statement: 'x', caused_by: [] }]);
    expect(unstatedFactRefs(stated)).toEqual(['rudder_jammed', 'seeded_fact']);
  });

  it('writes no key at all for an empty table, so an untouched story round-trips', () => {
    const withOne = withFacts(DRAFT, [{ fact_ref: 'a', statement: 'A.', caused_by: [] }]);
    expect(withOne.facts).toHaveLength(1);
    expect('facts' in withFacts(withOne, [])).toBe(false);
  });

  it('reads a half-written row without throwing', () => {
    const draft = { ...DRAFT, facts: [{ fact_ref: 'half' }] };
    expect(draftFacts(draft)).toEqual([{ fact_ref: 'half', statement: '', caused_by: [] }]);
  });

  it('previews linked facts causes-first, skipping rows that cannot render yet', () => {
    const preview = causalPreview([
      { fact_ref: 'rudder_jammed', statement: 'It jammed.', caused_by: ['stops_removed'] },
      { fact_ref: 'stops_removed', statement: 'They were removed.', caused_by: [] },
      { fact_ref: 'unfinished', statement: '', caused_by: ['stops_removed'] },
    ]);
    expect(preview.map((fact) => fact.fact_ref)).toEqual(['stops_removed', 'rudder_jammed']);
  });

  it('routes a facts lint problem to the facts section', () => {
    expect(sectionForPath('facts["loop_a"]')).toBe('facts');
    expect(sectionForPath('facts.0.statement')).toBe('facts');
  });
});

describe('glossed terms', () => {
  const digest = (terms: string[]) =>
    SceneDigestSchema.parse({ event_summary: 'x', closing_situation: 'y', terms_glossed: terms });

  it('touch term: facts in the told-ledger, oldest first', () => {
    const ledger = new ToldLedger();
    ledger.applyDigest(digest(['hull_gland']), 3);
    ledger.applyDigest(digest(['stop_blocks', 'hull_gland']), 5);
    expect(ledger.row(termFact('hull_gland'))).toMatchObject({ first_learned_scene: 3, last_touched_scene: 5 });
    expect(ledger.termSlice().map((row) => row.fact_ref)).toEqual(['term:hull_gland', 'term:stop_blocks']);
  });

  it('default to none on a digest recorded before the field existed', () => {
    expect(SceneDigestSchema.parse({ event_summary: 'x', closing_situation: 'y' }).terms_glossed).toEqual([]);
  });

  it('union across a rollup window', async () => {
    const rolled = await rollUp(
      [sceneDigestEntry(digest(['a']), 's1', 1), sceneDigestEntry(digest(['b', 'a']), 's2', 2)],
      concatenatingSummarizer,
    );
    expect(rolled.digest.terms_glossed).toEqual(['a', 'b']);
  });

  it('are asked for by the contract and the response schema', () => {
    expect(writerContract()).toContain('terms_glossed');
    expect(JSON.stringify(writerResponseJsonSchema())).toContain('terms_glossed');
  });
});

describe('a half-written fact at publish', () => {
  it('names the missing half in words, at a path the facts section owns', async () => {
    const { lintPackage } = await import('@/authoring/lint');
    const result = lintPackage({
      schema_version: '1.0',
      package_version: 1,
      story_id: 'half',
      world_model_seed: { characters: [], locations: [], objects: [], relationships: [], character_knowledge: [] },
      scene_cards: [],
      metadata: { title: 't' },
      facts: [{ fact_ref: 'a', statement: '', caused_by: [] }],
    });
    const problem = result.errors.find((error) => error.path === 'facts.0.statement');
    expect(problem?.message).toMatch(/no statement yet/);
    expect(sectionForPath(problem!.path)).toBe('facts');
  });
});
