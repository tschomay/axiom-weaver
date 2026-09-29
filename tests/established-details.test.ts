/**
 * Concrete details the prose commits to are carried forward and held (#198, ADR 0003's
 * 2026-09-29 amendment).
 */

import { describe, expect, it } from 'vitest';

import { renderArcPrompt } from '@/arc/prompt';
import { briefsFor } from '@/arc/premises';
import { promptText } from '@/assembler/context-assembler';
import { DetailsLedger, ESTABLISHED_DETAILS_SHOWN, canonicalAttribute, normalizeDetailValue } from '@/digest/details-ledger';
import { SceneDigestSchema, rollUp, sceneDigestEntry } from '@/digest/scene-digest';
import { readFixturePackage } from '@/fixtures/load';
import { walkPlantObligations } from '@/plants/obligation-walk';
import { scenesInOrder } from '@/schema/story-package';
import { severityOf } from '@/validator/diagnostics';
import { parseVoiceCard } from '@/voice/voice-card';
import { compileScene } from '@/writer/compile-scene';
import { writerContract } from '@/writer/contract';
import type { ModelClient, ModelRequest, ModelResponse } from '@/writer/model-client';
import { writerResponseJsonSchema } from '@/writer/response-schema';
import { RunState } from '@/writer/run-state';
import { SyntheticWriterClient } from '@/writer/synthetic-client';

const urn = { entity_id: 'prop_ash_urn', attribute: 'material', value: 'brass' };

describe('the established_details digest field', () => {
  const base = { event_summary: 'x', closing_situation: 'y' };

  it('defaults to empty, so every stored digest still parses', () => {
    expect(SceneDigestSchema.parse(base).established_details).toEqual([]);
  });

  it('is trimmed to 8, not rejected', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...urn, attribute: `a${i}` }));
    expect(SceneDigestSchema.parse({ ...base, established_details: many }).established_details).toHaveLength(8);
  });

  it('is on the wire schema, capped, and required', () => {
    const digest = (writerResponseJsonSchema()['$defs'] as Record<string, Record<string, unknown>>)['sceneDigest']!;
    const properties = digest['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['established_details']?.['maxItems']).toBe(8);
    expect(digest['required']).toContain('established_details');
  });

  it('is not aggregated by a rollup — the ledger holds every one', async () => {
    const digest = SceneDigestSchema.parse({ ...base, established_details: [urn] });
    const rolled = await rollUp([sceneDigestEntry(digest, 's1', 1)], () => ({ event_summary: 'z' }));
    expect(rolled.digest.established_details).toEqual([]);
  });

  it('is explained in the writer contract', () => {
    expect(writerContract()).toContain('ESTABLISHED DETAILS');
    expect(writerContract()).toContain('established_details');
  });
});

describe('DetailsLedger', () => {
  it('keeps the first value for an attribute, and reports a different later one as drift', () => {
    const ledger = new DetailsLedger();
    ledger.record([urn], 1);
    const tin = { ...urn, value: 'tin' };
    expect(ledger.driftIn([tin])).toEqual([{ established: { ...urn, scene_order: 1 }, reported: tin }]);
    ledger.record([tin], 3);
    expect(ledger.all()).toEqual([{ ...urn, scene_order: 1 }]);
  });

  it('does not call a rewording of the same value drift', () => {
    const ledger = new DetailsLedger();
    ledger.record([{ entity_id: 'char_julien', attribute: 'table_number', value: 'Table 4' }], 1);
    expect(ledger.driftIn([{ entity_id: 'char_julien', attribute: 'Table_Number', value: 'table 4.' }])).toEqual([]);
    expect(ledger.driftIn([{ entity_id: 'char_julien', attribute: 'table_number', value: 'Table nine' }])).toHaveLength(1);
    expect(normalizeDetailValue('Five winters, in Inverness!')).toBe('five winters in inverness');
  });

  it('shows details for entities on stage, then untracked ones, newest first — never an off-stage tracked one', () => {
    const ledger = new DetailsLedger();
    ledger.record([{ entity_id: 'char_helen', attribute: 'years_away', value: 'five winters' }], 1);
    ledger.record([{ entity_id: 'char_ruth', attribute: 'trade', value: 'nurse' }], 2);
    ledger.record([urn], 3);
    const shown = ledger.forScene(new Set(['char_helen']), (id) => id.startsWith('char_'));
    expect(shown.map((detail) => detail.entity_id)).toEqual(['char_helen', 'prop_ash_urn']);
  });

  it('caps what a scene is shown', () => {
    const ledger = new DetailsLedger();
    ledger.record(
      Array.from({ length: 40 }, (_, i) => ({ entity_id: 'prop_x', attribute: `a${i}`, value: 'v' })),
      1,
    );
    expect(ledger.forScene(new Set(), () => false)).toHaveLength(ESTABLISHED_DETAILS_SHOWN);
  });
});

/** The synthetic writer, reporting whatever established_details the test asks for. */
class DetailingClient implements ModelClient {
  constructor(
    private readonly inner: SyntheticWriterClient,
    private readonly details: unknown[],
  ) {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.inner.generate(request);
    const body = JSON.parse(response.text) as { scene_digest: Record<string, unknown> };
    body.scene_digest['established_details'] = this.details;
    return { ...response, text: JSON.stringify(body) };
  }
}

describe('through the run (#198)', () => {
  async function compile(details: unknown[]) {
    const pkg = await readFixturePackage('cinderella');
    const state = new RunState(pkg);
    const [first, second] = scenesInOrder(pkg);
    state.details.record([urn], first!.order);
    const compiled = await compileScene({
      pkg,
      scene: second!,
      model: state.model,
      voiceCard: parseVoiceCard(pkg.voice_card),
      hierarchy: state.hierarchy,
      ledger: state.ledger,
      plantWalk: walkPlantObligations(pkg),
      client: new DetailingClient(new SyntheticWriterClient(pkg), details),
      imageryHistory: state.imageryHistory,
      previousParagraph: null,
      details: state.details,
      occasion: 'author_time',
    });
    return { compiled, state, scene: second! };
  }

  it('renders what earlier scenes established into the prompt core', async () => {
    const { compiled } = await compile([]);
    const text = promptText(compiled.assembled);
    expect(text).toContain('ESTABLISHED DETAILS (the reader has been told these — do not change them):');
    expect(text).toContain('prop_ash_urn — material [prop_ash_urn / material]: brass (scene 1)');
  });

  it('flags a contradiction as detail_drift, a warning', async () => {
    const { compiled } = await compile([{ ...urn, value: 'tin' }]);
    const drift = compiled.diagnostics.find((entry) => entry.code === 'detail_drift');
    expect(drift?.message).toContain('"tin"');
    expect(drift?.message).toContain('"brass"');
    expect(severityOf('detail_drift')).toBe('warn');
  });

  it('records a scene’s new details when the run advances', async () => {
    const detail = { entity_id: 'prop_slipper', attribute: 'material', value: 'glass' };
    const { compiled, state, scene } = await compile([detail]);
    expect(compiled.diagnostics.some((entry) => entry.code === 'detail_drift')).toBe(false);
    await state.advance(scene, compiled.digest, compiled.prose);
    expect(state.details.all()).toContainEqual({ ...detail, scene_order: scene.order });
  });
});

describe('arc prompt: props that pass between events are tracked objects (#198)', () => {
  it('asks for a seeded object for anything two or more events turn on', () => {
    const prompt = renderArcPrompt(briefsFor('structured', 5)[0]!);
    expect(prompt).toContain('Every physical object that two or more events turn on');
  });
});

describe('keys that can collide (#215)', () => {
  it('folds attribute synonyms and spelling to one canonical key', () => {
    expect(canonicalAttribute('Location')).toBe('where_kept');
    expect(canonicalAttribute('hiding place')).toBe('where_kept');
    expect(canonicalAttribute('colour')).toBe('color');
    expect(canonicalAttribute('current_total')).toBe('amount');
    expect(canonicalAttribute('Play Title')).toBe('title');
    expect(canonicalAttribute('years_in_role')).toBe('years');
    expect(canonicalAttribute('table_number')).toBe('table_number');
  });

  it('catches drift reported under a synonym (after-04: the cash moves; random-02: eleven years become thirty)', () => {
    const ledger = new DetailsLedger();
    ledger.record(
      [
        { entity_id: 'obj_deposit_envelope', attribute: 'location', value: 'the toe of his left boot' },
        { entity_id: 'char_hester', attribute: 'tenure', value: 'eleven years' },
      ],
      1,
    );
    const drifts = ledger.driftIn([
      { entity_id: 'obj_deposit_envelope', attribute: 'hidden_in', value: 'the boiler flue' },
      { entity_id: 'char_hester', attribute: 'years in role', value: 'thirty years' },
    ]);
    expect(drifts.map((drift) => drift.established.attribute)).toEqual(['where_kept', 'years']);
    expect(ledger.all().map((detail) => detail.attribute)).toEqual(['where_kept', 'years']);
  });

  it('suggests the on-stage ids and attribute names even before anything is established', async () => {
    const pkg = await readFixturePackage('cinderella');
    const state = new RunState(pkg);
    const [, second] = scenesInOrder(pkg);
    const compiled = await compileScene({
      pkg,
      scene: second!,
      model: state.model,
      voiceCard: parseVoiceCard(pkg.voice_card),
      hierarchy: state.hierarchy,
      ledger: state.ledger,
      plantWalk: walkPlantObligations(pkg),
      client: new SyntheticWriterClient(pkg),
      imageryHistory: state.imageryHistory,
      previousParagraph: null,
      details: state.details,
      occasion: 'author_time',
    });
    const text = promptText(compiled.assembled);
    expect(text).toContain('RECORDING DETAILS: when this scene states a specific');
    expect(text).toContain(`= ${second!.pov}`);
    expect(text).toContain('where_kept, amount, age, years');
    expect(text).not.toContain('ESTABLISHED DETAILS (the reader has been told these');
  });

  it('asks the writer for load-bearing details and repeated keys', () => {
    expect(writerContract()).toContain('most likely to mention');
    expect(writerContract()).toContain('report a');
  });
});
