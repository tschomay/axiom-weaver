import { describe, expect, it } from 'vitest';
import {
  RESPONSE_PROPERTY_ORDER,
  WriterResponseSchema,
  fallbackResponseJsonSchema,
  writerResponseJsonSchema,
} from '@/writer/response-schema';
import { finalParagraph, lengthVerdict, salvageProse, wordCount } from '@/writer/salvage';
import { SceneDigestSchema } from '@/digest/scene-digest';
import { checkVarianceContract, shouldRetry } from '@/variance/variance-contract';
import { SceneCardSchema } from '@/schema/story-package';

describe('the response schema (ADR 0012 decision 1)', () => {
  it('pins prose first, because prose is what streams to the reader', () => {
    const schema = writerResponseJsonSchema();
    expect(schema['propertyOrdering']).toEqual([
      'prose',
      'scene_digest',
      'state_updates',
      'diagnostics',
    ]);
    expect(RESPONSE_PROPERTY_ORDER[0]).toBe('prose');
  });

  it('reuses shapes through $defs/$ref rather than repeating them', () => {
    const schema = writerResponseJsonSchema();
    const defs = schema['$defs'] as Record<string, unknown>;
    expect(Object.keys(defs)).toEqual(
      expect.arrayContaining(['factRef', 'entityRef', 'imagerySignature', 'sceneDigest']),
    );
  });

  it('carries no sibling properties beside a $ref, which the API forbids', () => {
    const visit = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      const record = node as Record<string, unknown>;
      if ('$ref' in record) {
        const siblings = Object.keys(record).filter((key) => !key.startsWith('$'));
        expect(siblings).toEqual([]);
      }
      Object.values(record).forEach(visit);
    };
    visit(writerResponseJsonSchema());
  });

  it('lets the writer propose values but never a tier', () => {
    const schema = writerResponseJsonSchema();
    const defs = schema['$defs'] as Record<string, Record<string, unknown>>;
    const update = (defs['stateUpdates']!['properties'] as Record<string, Record<string, unknown>>)[
      'updates'
    ]!;
    const fields = ((update['items'] as Record<string, unknown>)['properties'] ??
      {}) as Record<string, unknown>;
    expect(Object.keys(fields)).toEqual(['entity_id', 'column', 'value']);
    expect(Object.keys(fields)).not.toContain('tier');
  });

  it('offers the writer exactly two diagnostic types to self-report', () => {
    const schema = writerResponseJsonSchema();
    const diagnostics = (schema['properties'] as Record<string, Record<string, unknown>>)[
      'diagnostics'
    ]!;
    const items = diagnostics['items'] as Record<string, Record<string, Record<string, unknown>>>;
    expect(items['properties']!['type']!['enum']).toEqual(['beat_unsatisfied', 'missing_fact']);
  });

  it('narrows the fallback schema to digest and state updates, dropping diagnostics', () => {
    const fallback = fallbackResponseJsonSchema();
    expect(Object.keys(fallback['properties'] as object)).toEqual([
      'scene_digest',
      'state_updates',
    ]);
    // The writer never finished the call those diagnostics would have come from.
    expect(Object.keys(fallback['properties'] as object)).not.toContain('diagnostics');
  });

  it('caps imagery_signature at three entries in the schema itself, not in prompt wording', () => {
    expect(
      SceneDigestSchema.safeParse({
        event_summary: 'x',
        closing_situation: 'y',
        imagery_signature: [
          { image: '1', domain: null },
          { image: '2', domain: null },
          { image: '3', domain: null },
          { image: '4', domain: null },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('salvaging prose from a truncated response (ADR 0012 decision 5)', () => {
  it('recovers complete prose when only the digest tail was cut', () => {
    const buffer =
      '{"prose":"She opened the door.\\n\\nIt was raining.","scene_digest":{"event_summary":"she op';
    const salvaged = salvageProse(buffer);
    expect(salvaged?.complete).toBe(true);
    expect(salvaged?.prose).toBe('She opened the door.\n\nIt was raining.');
  });

  it('reports incomplete prose when the cut landed mid-clause', () => {
    const salvaged = salvageProse('{"prose":"She opened the door and');
    expect(salvaged?.complete).toBe(false);
    expect(salvaged?.prose).toBe('She opened the door and');
  });

  it('unescapes what JSON escaped, including a unicode escape', () => {
    const salvaged = salvageProse('{"prose":"a \\"quoted\\" word, a tab\\there, \\u00e9"}');
    expect(salvaged?.prose).toBe('a "quoted" word, a tab\there, é');
    expect(salvaged?.complete).toBe(true);
  });

  it('returns null when the cut landed before prose was written at all', () => {
    expect(salvageProse('{"pro')).toBeNull();
    expect(salvageProse('')).toBeNull();
  });

  it('takes the final paragraph as the next scene s verbatim tail', () => {
    expect(finalParagraph('One.\n\nTwo.\n\nThree.')).toBe('Three.');
    expect(finalParagraph('   ')).toBeNull();
  });
});

describe('length control (ADR 0012 decision 4)', () => {
  it('treats overshoot and undershoot asymmetrically', () => {
    const prose = new Array(100).fill('word').join(' ');
    expect(wordCount(prose)).toBe(100);
    expect(lengthVerdict(prose, 100).verdict).toBe('ok');
    expect(lengthVerdict(prose, 125).verdict).toBe('ok');
    // Well under budget is the signal that a beat got cut.
    expect(lengthVerdict(prose, 200).verdict).toBe('under');
    expect(lengthVerdict(prose, 50).verdict).toBe('over');
    expect(lengthVerdict(prose, undefined).verdict).toBe('unbudgeted');
  });
});

describe('the variance contract (ADR 0006)', () => {
  const scene = SceneCardSchema.parse({
    id: 'scene_01',
    order: 1,
    pov: 'char_a',
    location_id: 'loc_a',
    characters_present: ['char_a'],
    dramatic_function: 'a thing happens',
    entry_state: {},
    exit_state: {},
    reader_must_learn: ['must_learn'],
    must_stay_hidden: ['stay_hidden'],
    pays_off: [{ fact_ref: 'owed_payoff', plant: null }],
  });

  const digest = (overrides: Record<string, unknown> = {}) =>
    SceneDigestSchema.parse({
      event_summary: 'x',
      closing_situation: 'y',
      facts_revealed: ['must_learn'],
      payoffs_closed: ['owed_payoff'],
      ...overrides,
    });

  it('passes a scene that revealed what it had to and hid what it had to', () => {
    expect(
      checkVarianceContract({ scene, digest: digest(), writerDiagnostics: [], owedPlants: [] }),
    ).toEqual([]);
  });

  it('flags a missed reveal as correctable', () => {
    const findings = checkVarianceContract({
      scene,
      digest: digest({ facts_revealed: [] }),
      writerDiagnostics: [],
      owedPlants: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'reader_must_learn_missed', correctable: true });
  });

  it('flags a leaked secret as uncorrectable — a retry cannot un-show streamed prose', () => {
    const findings = checkVarianceContract({
      scene,
      digest: digest({ facts_revealed: ['must_learn', 'stay_hidden'] }),
      writerDiagnostics: [],
      owedPlants: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'must_stay_hidden_violation',
      correctable: false,
    });
    expect(shouldRetry(findings, 'read_time')).toBe(false);
  });

  it('flags a dropped plant and an unclosed payoff', () => {
    const findings = checkVarianceContract({
      scene,
      digest: digest({ payoffs_closed: [] }),
      writerDiagnostics: [],
      owedPlants: ['owed_plant'],
    });
    expect(findings.map((finding) => finding.code).sort()).toEqual([
      'payoff_not_closed',
      'plant_obligation_missed',
    ]);
  });

  it('carries the writer s beat self-report through without re-deriving it', () => {
    const findings = checkVarianceContract({
      scene,
      digest: digest(),
      writerDiagnostics: [{ type: 'beat_unsatisfied', detail: 'beat 3 contradicted an invariant' }],
      owedPlants: [],
    });
    expect(findings[0]).toMatchObject({ code: 'beat_unsatisfied' });
    expect(findings[0]?.detail).toContain('beat 3');
  });

  it('retries at read time only, and only when something is correctable', () => {
    const correctable = checkVarianceContract({
      scene,
      digest: digest({ facts_revealed: [] }),
      writerDiagnostics: [],
      owedPlants: [],
    });
    expect(shouldRetry(correctable, 'read_time')).toBe(true);
    // Author-time warns immediately instead: the author is right there and can fix the card.
    expect(shouldRetry(correctable, 'author_time')).toBe(false);
    expect(shouldRetry([], 'read_time')).toBe(false);
  });
});

describe('client-side response validation', () => {
  it('rejects a response missing a required digest field', () => {
    const result = WriterResponseSchema.safeParse({
      prose: 'text',
      scene_digest: { event_summary: 'x' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed response and defaults the optional lists', () => {
    const result = WriterResponseSchema.safeParse({
      prose: 'text',
      scene_digest: { event_summary: 'x', closing_situation: 'y' },
    });
    expect(result.success).toBe(true);
    expect(result.data?.diagnostics).toEqual([]);
    expect(result.data?.state_updates.updates).toEqual([]);
  });
});
