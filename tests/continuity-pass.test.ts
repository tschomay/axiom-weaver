import { describe, expect, it } from 'vitest';
import {
  applyRepair,
  checkRepairAuthority,
  continuityPass,
  detectSeams,
  openingParagraph,
  shapeFor,
  type SeamCheckInput,
} from '@/continuity/continuity-pass';
import { SceneDigestSchema, type SceneDigest } from '@/digest/scene-digest';
import { ToldLedger } from '@/digest/told-ledger';
import type { BandDecision } from '@/assembler/reanchoring';
import type { ModelClient, ModelRequest, ModelResponse } from '@/writer/model-client';
import type { WriterStateUpdates } from '@/writer/response-schema';
import { scene } from './helpers';

function digest(overrides: Partial<SceneDigest> = {}): SceneDigest {
  return SceneDigestSchema.parse({
    event_summary: 'Jim walks to the park.',
    closing_situation: 'Jim is on the bench, watching the gate.',
    entities_on_stage: ['char_jim'],
    ...overrides,
  });
}

const NO_UPDATES: WriterStateUpdates = {
  updates: [],
  new_relationships: [],
  new_character_knowledge: [],
};

function band(entityId: string, value: BandDecision['band']): BandDecision {
  return {
    entity_id: entityId,
    name: entityId,
    centrality: 'medium',
    scenes_since_last_touch: 1,
    band: value,
    forced: false,
  };
}

function check(overrides: Partial<SeamCheckInput> = {}): SeamCheckInput {
  return {
    scene: scene({ order: 4 }),
    digest: digest(),
    previous: { scene_id: 'scene_03', digest: digest() },
    ledgerAtEntry: new ToldLedger(),
    expectedBands: [],
    imageryHistory: [],
    ...overrides,
  };
}

/** A client that answers every call with one scripted body. */
class ScriptedClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly bodies: string[]) {}
  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return {
      text: this.bodies[Math.min(this.requests.length - 1, this.bodies.length - 1)] ?? '{}',
      finish_reason: 'STOP',
      model: 'test-model',
      usage: { prompt_tokens: 1, output_tokens: 1, cached_tokens: 0, thoughts_tokens: 0 },
    };
  }
}

describe('detecting seams (ADR 0011 §1)', () => {
  it('catches a cold open: an entity the reader was with one scene ago, re-introduced', () => {
    const findings = detectSeams(
      check({
        digest: digest({
          entities_on_stage: ['char_jim'],
          reanchor_used: [{ entity_id: 'char_jim', band: 'reintroduce' }],
        }),
        previous: { scene_id: 'scene_03', digest: digest({ entities_on_stage: ['char_jim'] }) },
      }),
    );

    expect(findings.map((finding) => finding.mode)).toEqual(['cold_open']);
    expect(findings[0]?.subject).toBe('char_jim');
  });

  it('does not call a genuine first appearance a cold open', () => {
    const findings = detectSeams(
      check({
        digest: digest({
          entities_on_stage: ['char_ada'],
          reanchor_used: [{ entity_id: 'char_ada', band: 'introduce' }],
        }),
        previous: { scene_id: 'scene_03', digest: digest({ entities_on_stage: ['char_jim'] }) },
      }),
    );

    expect(findings).toEqual([]);
  });

  it('catches told-ledger miscalibration against the band the policy expected', () => {
    const ledger = new ToldLedger();
    ledger.touch('met:char_ada', 1);
    const findings = detectSeams(
      check({
        ledgerAtEntry: ledger,
        expectedBands: [band('char_ada', 'reanchor')],
        digest: digest({
          entities_on_stage: ['char_ada'],
          reanchor_used: [{ entity_id: 'char_ada', band: 'assume' }],
        }),
        previous: null,
      }),
    );

    expect(findings.map((finding) => finding.mode)).toEqual(['told_ledger_miscalibration']);
  });

  it('catches a fact revealed as new that the reader already holds', () => {
    const ledger = new ToldLedger();
    ledger.touch('fact_the_will', 1);
    const findings = detectSeams(
      check({ ledgerAtEntry: ledger, digest: digest({ facts_revealed: ['fact_the_will'] }) }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toContain('first learned in scene 1');
  });

  it('catches an entity assumed known that the reader has never met', () => {
    const findings = detectSeams(
      check({
        digest: digest({ reanchor_used: [{ entity_id: 'char_ada', band: 'assume' }] }),
        previous: null,
      }),
    );

    expect(findings.map((finding) => finding.mode)).toEqual(['told_ledger_miscalibration']);
    expect(findings[0]?.detail).toContain('never met them');
  });

  it('catches stale imagery: the same phrasing inside a domain, never the domain itself', () => {
    const history = [
      { scene_order: 2, signature: [{ image: 'rain on glass', domain: 'weather' }] },
    ];
    const stale = detectSeams(
      check({
        imageryHistory: history,
        digest: digest({ imagery_signature: [{ image: 'Rain on glass ', domain: 'weather' }] }),
      }),
    );
    expect(stale.map((finding) => finding.mode)).toEqual(['stale_imagery']);

    const licensed = detectSeams(
      check({
        imageryHistory: history,
        digest: digest({ imagery_signature: [{ image: 'sleet on the sill', domain: 'weather' }] }),
      }),
    );
    expect(licensed).toEqual([]);
  });

  it('leaves dropped setup alone — the plant-obligation walk owns it (ADR 0011 §1)', () => {
    const findings = detectSeams(
      check({ digest: digest({ plants_opened: [], payoffs_closed: ['fact_never_planted'] }) }),
    );
    expect(findings).toEqual([]);
  });
});

describe('edit authority (ADR 0011 §4)', () => {
  it('accepts a repair that only touched the three repairable fields', () => {
    const before = digest();
    const after = { ...before, closing_situation: 'Jim is at the gate.', reanchor_used: [] };
    expect(
      checkRepairAuthority(
        { digest: before, state_updates: NO_UPDATES },
        { digest: after, state_updates: NO_UPDATES },
      ),
    ).toBeNull();
  });

  it.each(['facts_revealed', 'plants_opened', 'payoffs_closed', 'entities_on_stage'] as const)(
    'rejects a repair that changed %s',
    (field) => {
      const before = digest();
      const after = { ...before, [field]: ['something_new'] };
      expect(
        checkRepairAuthority(
          { digest: before, state_updates: NO_UPDATES },
          { digest: after, state_updates: NO_UPDATES },
        ),
      ).toBe(`a repair may not change scene_digest.${field}`);
    },
  );

  it('rejects a repair that changed state_updates', () => {
    expect(
      checkRepairAuthority(
        { digest: digest(), state_updates: NO_UPDATES },
        {
          digest: digest(),
          state_updates: {
            ...NO_UPDATES,
            updates: [{ entity_id: 'char_jim', column: 'location_id', value: 'loc_park' }],
          },
        },
      ),
    ).toBe('a repair may not change state_updates');
  });
});

describe('the two repair shapes (ADR 0011 §5)', () => {
  it('rewrites only the opening paragraph for a cold open', () => {
    const prose = 'A cold open.\n\nThe body of the scene.\n\nAnd its close.';
    const applied = applyRepair({
      prose,
      digest: digest(),
      finding: {
        mode: 'cold_open',
        scene_id: 'scene_04',
        scene_index: 4,
        subject: 'char_jim',
        detail: '',
      },
      repair: {
        replacement: 'Still on the bench, Jim watched the gate.',
        original_phrase: null,
        closing_situation: null,
        imagery_signature: null,
        reanchor_used: null,
      },
    });

    expect(typeof applied).not.toBe('string');
    if (typeof applied === 'string') return;
    expect(applied.prose).toBe(
      'Still on the bench, Jim watched the gate.\n\nThe body of the scene.\n\nAnd its close.',
    );
    expect(applied.digest).toEqual(digest());
  });

  it('swaps just the offending phrase for stale imagery, anywhere in the scene', () => {
    const prose = 'The body of the scene.\n\nRain on glass, again.';
    const applied = applyRepair({
      prose,
      digest: digest({ imagery_signature: [{ image: 'rain on glass', domain: 'weather' }] }),
      finding: {
        mode: 'stale_imagery',
        scene_id: 'scene_04',
        scene_index: 4,
        subject: 'rain on glass',
        detail: '',
      },
      repair: {
        replacement: 'Sleet on the sill',
        original_phrase: 'Rain on glass',
        closing_situation: null,
        imagery_signature: null,
        reanchor_used: null,
      },
    });

    if (typeof applied === 'string') throw new Error(applied);
    expect(applied.prose).toBe('The body of the scene.\n\nSleet on the sill, again.');
    // The domain survives — recurrence inside a domain is a licensed motif (ADR 0010).
    expect(applied.digest.imagery_signature).toEqual([
      { image: 'Sleet on the sill', domain: 'weather' },
    ]);
  });

  it('refuses an imagery repair that names a phrase the prose does not contain verbatim', () => {
    const applied = applyRepair({
      prose: 'The body of the scene.',
      digest: digest(),
      finding: {
        mode: 'stale_imagery',
        scene_id: 'scene_04',
        scene_index: 4,
        subject: 'rain on glass',
        detail: '',
      },
      repair: {
        replacement: 'sleet',
        original_phrase: 'a phrase that is not there',
        closing_situation: null,
        imagery_signature: null,
        reanchor_used: null,
      },
    });

    expect(applied).toContain('not in the prose verbatim');
  });

  it('maps each mode to its shape', () => {
    expect(shapeFor('cold_open')).toBe('opening_rewrite');
    expect(shapeFor('told_ledger_miscalibration')).toBe('opening_rewrite');
    expect(shapeFor('stale_imagery')).toBe('imagery_swap');
  });

  it('finds the opening beat as everything before the first paragraph break', () => {
    expect(openingParagraph('one\n\ntwo')).toBe('one');
    expect(openingParagraph('only one paragraph')).toBe('only one paragraph');
  });
});

describe('the pass end to end', () => {
  const coldOpen = () =>
    check({
      digest: digest({
        entities_on_stage: ['char_jim'],
        reanchor_used: [{ entity_id: 'char_jim', band: 'reintroduce' }],
      }),
      previous: { scene_id: 'scene_03', digest: digest({ entities_on_stage: ['char_jim'] }) },
    });

  it('repairs the persisted prose and logs the repair at info severity', async () => {
    const client = new ScriptedClient([
      JSON.stringify({ replacement: 'Still on the bench, Jim watched the gate.' }),
    ]);
    const result = await continuityPass({
      ...coldOpen(),
      prose: 'A cold open.\n\nThe body of the scene.',
      state_updates: NO_UPDATES,
      client,
      occasion: 'read_time',
    });

    expect(result.findings).toHaveLength(1);
    expect(result.repairs[0]?.applied).toBe(true);
    expect(result.prose.startsWith('Still on the bench')).toBe(true);
    expect(result.diagnostics.map((entry) => [entry.code, entry.severity])).toEqual([
      ['continuity_seam_repaired', 'info'],
    ]);
    expect(result.calls.map((call) => call.purpose)).toEqual(['continuity_repair']);
  });

  it('discards a repair it cannot apply, leaves the seam standing, and logs it', async () => {
    const failing = await continuityPass({
      ...coldOpen(),
      prose: 'A cold open.\n\nThe body.',
      state_updates: NO_UPDATES,
      client: new ScriptedClient(['not json at all']),
      occasion: 'read_time',
    });

    expect(failing.repairs[0]?.applied).toBe(false);
    expect(failing.prose).toBe('A cold open.\n\nThe body.');
    expect(failing.diagnostics.map((entry) => [entry.code, entry.severity])).toEqual([
      ['continuity_repair_rejected', 'warn'],
    ]);
  });

  it('gives a seam exactly one attempt at read-time and a second at author-time (§2/§6)', async () => {
    const unparseable = () => new ScriptedClient(['not json at all']);

    const readTime = unparseable();
    await continuityPass({
      ...coldOpen(),
      prose: 'A cold open.\n\nThe body.',
      state_updates: NO_UPDATES,
      client: readTime,
      occasion: 'read_time',
    });
    expect(readTime.requests).toHaveLength(1);

    const authorTime = unparseable();
    await continuityPass({
      ...coldOpen(),
      prose: 'A cold open.\n\nThe body.',
      state_updates: NO_UPDATES,
      client: authorTime,
      occasion: 'author_time',
    });
    expect(authorTime.requests).toHaveLength(2);
  });

  it('never calls a model when no seam is broken', async () => {
    const client = new ScriptedClient(['{}']);
    const result = await continuityPass({
      ...check(),
      prose: 'The body.',
      state_updates: NO_UPDATES,
      client,
      occasion: 'read_time',
    });

    expect(result.findings).toEqual([]);
    expect(client.requests).toEqual([]);
    expect(result.prose).toBe('The body.');
  });
});
