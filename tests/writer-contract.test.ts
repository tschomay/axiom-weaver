import { describe, expect, it } from 'vitest';
import {
  RESPONSE_PROPERTY_ORDER,
  WriterResponseSchema,
  fallbackResponseJsonSchema,
  writerResponseJsonSchema,
} from '@/writer/response-schema';
import { finalParagraph, lengthVerdict, salvageProse, wordCount } from '@/writer/salvage';
import { writerContract } from '@/writer/contract';
import { SceneDigestSchema, TWO_SENTENCE_CHARS } from '@/digest/scene-digest';
import { plantInstruction, payoffInstruction } from '@/plants/obligation-walk';
import { renderVoiceCard, cardFromPreset } from '@/voice/voice-card';
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

describe('the reporting tokens the writer is asked for', () => {
  it('opens the plant instruction with the fact_ref it wants back in plants_opened', () => {
    const instruction = plantInstruction('the_dragons_smoke_smells_of_clover');
    // The slug verbatim, so the writer has a token to copy rather than a sentence to echo.
    expect(instruction).toContain('`the_dragons_smoke_smells_of_clover`');
    expect(instruction).toContain('plants_opened');
    // And the deslugged phrase, which is what actually goes on the page.
    expect(instruction).toContain("the dragon's smoke smells of clover".replace("'", ''));
  });

  it('opens the payoff instruction the same way, for payoffs_closed', () => {
    const instruction = payoffInstruction('loose_stair_rail');
    expect(instruction).toContain('`loose_stair_rail`');
    expect(instruction).toContain('payoffs_closed');
  });

  it('names neither the payoff scene nor any scene id, per ADR 0004 decision 5', () => {
    expect(plantInstruction('loose_stair_rail')).not.toMatch(/scene_\d/);
  });

  it('describes factRef and entityRef so the writer returns slugs, not sentences', () => {
    const defs = writerResponseJsonSchema()['$defs'] as Record<string, Record<string, unknown>>;
    expect(defs['factRef']?.['description']).toMatch(/slug/i);
    expect(defs['factRef']?.['description']).toMatch(/never a sentence/i);
    expect(defs['entityRef']?.['description']).toMatch(/never a display name/i);
  });

  it('tells the writer an image and its domain are never the same text', () => {
    const defs = writerResponseJsonSchema()['$defs'] as Record<string, Record<string, unknown>>;
    const properties = defs['imagerySignature']?.['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties['domain']?.['description']).toMatch(/never the same text/i);
    expect(properties['image']?.['description']).toMatch(/not the domain label/i);
  });

  it('sells the Voice Card palette as domains to draw from, not phrases to reuse', () => {
    const rendered = renderVoiceCard(cardFromPreset('gothic_brooding'));
    expect(rendered).toMatch(/Imagery domains/);
    expect(rendered).toMatch(/never phrases to reuse verbatim/);
  });
});

describe('the two-sentence caps (ADR 0003 decision 5)', () => {
  it('constrains decoding on the wire, where the cap can still do something', () => {
    const defs = writerResponseJsonSchema()['$defs'] as Record<string, Record<string, unknown>>;
    const properties = defs['sceneDigest']?.['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties['event_summary']?.['maxLength']).toBe(TWO_SENTENCE_CHARS);
    expect(properties['closing_situation']?.['maxLength']).toBe(TWO_SENTENCE_CHARS);
  });

  it('trims an over-long summary rather than throwing away the scene it came with', () => {
    const long = `${'The stepsisters argued about the ribbons. '.repeat(20)}`;
    const parsed = SceneDigestSchema.safeParse({
      event_summary: long,
      closing_situation: long,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.event_summary.length).toBeLessThanOrEqual(TWO_SENTENCE_CHARS);
    // Trimmed at a sentence end, not mid-word.
    expect(parsed.data?.event_summary).toMatch(/ribbons\.$/);
  });

  it('leaves a summary inside the cap exactly as written', () => {
    const summary = 'Cinderella loses a slipper on the stair.';
    expect(SceneDigestSchema.parse({ event_summary: summary, closing_situation: 'x' })
      .event_summary).toBe(summary);
  });
});

describe('prose form (issue #73)', () => {
  it('asks for paragraphs in the cached header, where a whole-telling rule belongs', () => {
    const contract = writerContract();
    expect(contract).toMatch(/FORM:/);
    expect(contract).toMatch(/separated by a blank line/);
  });

  it('hands forward the closing sentences of an unbroken scene, not the whole of it', () => {
    // 445 words in one block is a real thing a writer call returned. Before this, the verbatim
    // tail was the entire scene, then trimmed from the front — so the next scene opened against a
    // fragment starting mid-sentence.
    const unbroken =
      'She opened the hive. The bees were having a difficult morning. ' +
      'He put the lance down. The clover crock came out. He forgot what he came for.';
    const tail = finalParagraph(unbroken);
    expect(tail).toBe('He put the lance down. The clover crock came out. He forgot what he came for.');
    expect(tail!.length).toBeLessThan(unbroken.length);
  });

  it('leaves a properly paragraphed scene alone', () => {
    expect(finalParagraph('First beat.\n\nSecond beat.\n\nAnd its close.')).toBe('And its close.');
  });
});
