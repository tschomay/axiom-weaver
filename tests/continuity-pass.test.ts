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
import { z } from 'zod';
import { SceneDigestSchema, type SceneDigest } from '@/digest/scene-digest';
import {
  groupBySharedRepair,
  locatePhrase,
  repairPrompt,
  repairResponseJsonSchema,
} from '@/continuity/continuity-pass';
import { normalizeProse } from '@/writer/salvage';
import { ToldLedger } from '@/digest/told-ledger';
import type { BandDecision } from '@/assembler/reanchoring';
import type { ModelClient, ModelRequest, ModelResponse } from '@/writer/model-client';
import type { WriterStateUpdates } from '@/writer/response-schema';
import { scene } from './helpers';

/** Input type, not `SceneDigest` itself — lets a test omit fields the schema defaults. */
function digest(overrides: Partial<z.input<typeof SceneDigestSchema>> = {}): SceneDigest {
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

  it('reports one finding per broken seam, not one per check that catches it', () => {
    const findings = detectSeams(
      check({
        // Both the band comparison and the never-met check see this entity.
        expectedBands: [band('char_ada', 'introduce')],
        digest: digest({ reanchor_used: [{ entity_id: 'char_ada', band: 'assume' }] }),
        previous: null,
      }),
    );

    expect(findings).toHaveLength(1);
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

  it('catches a light band whose own anchor_text needed truncating (ADR 0018 decision 3)', () => {
    const ledger = new ToldLedger();
    ledger.touch('met:char_ada', 1);
    const truncated = `${'a distinguishing clause that ran on and on'.repeat(6)}…`;
    const findings = detectSeams(
      check({
        ledgerAtEntry: ledger,
        expectedBands: [band('char_ada', 'assume')],
        digest: digest({
          entities_on_stage: ['char_ada'],
          reanchor_used: [{ entity_id: 'char_ada', band: 'assume', anchor_text: truncated }],
        }),
        previous: null,
      }),
    );

    expect(findings.map((finding) => finding.mode)).toEqual(['told_ledger_miscalibration']);
    expect(findings[0]?.detail).toContain('needed truncating');
  });

  it('does not flag a light band whose anchor_text is a short clause, or none at all', () => {
    const ledger = new ToldLedger();
    ledger.touch('met:char_ada', 1);

    const shortClause = detectSeams(
      check({
        ledgerAtEntry: ledger,
        expectedBands: [band('char_ada', 'assume')],
        digest: digest({
          entities_on_stage: ['char_ada'],
          reanchor_used: [
            { entity_id: 'char_ada', band: 'assume', anchor_text: "her brother's ring" },
          ],
        }),
        previous: null,
      }),
    );
    expect(shortClause).toEqual([]);

    const noAnchor = detectSeams(
      check({
        ledgerAtEntry: ledger,
        expectedBands: [band('char_ada', 'assume')],
        digest: digest({
          entities_on_stage: ['char_ada'],
          reanchor_used: [{ entity_id: 'char_ada', band: 'assume', anchor_text: null }],
        }),
        previous: null,
      }),
    );
    expect(noAnchor).toEqual([]);
  });

  it('does not double-report an entity bandMismatches already caught', () => {
    const ledger = new ToldLedger();
    ledger.touch('met:char_ada', 1);
    const truncated = `${'a distinguishing clause that ran on and on'.repeat(6)}…`;
    const findings = detectSeams(
      check({
        ledgerAtEntry: ledger,
        // The policy expected a heavier band than "assume" — bandMismatches catches this first.
        expectedBands: [band('char_ada', 'reanchor')],
        digest: digest({
          entities_on_stage: ['char_ada'],
          reanchor_used: [{ entity_id: 'char_ada', band: 'assume', anchor_text: truncated }],
        }),
        previous: null,
      }),
    );

    expect(findings).toHaveLength(1);
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

  it('refuses an imagery repair that names a phrase the prose does not contain at all', () => {
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
        imagery_signature: null,
        reanchor_used: null,
      },
    });

    expect(applied).toContain('not in the prose');
  });

  it('maps each mode to its shape', () => {
    expect(shapeFor('cold_open')).toBe('opening_rewrite');
    expect(shapeFor('told_ledger_miscalibration')).toBe('opening_rewrite');
    expect(shapeFor('stale_imagery')).toBe('imagery_swap');
    // ADR 0018 decision 4: reuses imagery_swap's locate-and-swap shape, not a new one.
    expect(shapeFor('prose_grounding_mismatch')).toBe('imagery_swap');
  });

  it('repairs a prose-grounding mismatch by swapping the phrase and dropping the resolved claim', () => {
    const prose = 'The resin copy tucked against her ribs had its chipped eye on the wrong side.';
    const applied = applyRepair({
      prose,
      digest: digest({
        grounded_claims: [
          { entity_id: 'obj_forgery', column: 'location_id', asserted_value: 'char_vess' },
          { entity_id: 'char_vess', column: 'status', asserted_value: 'alive' },
        ],
      }),
      finding: {
        mode: 'prose_grounding_mismatch',
        scene_id: 'scene_04',
        scene_index: 4,
        subject: 'obj_forgery.location_id',
        detail: '',
      },
      repair: {
        replacement: 'The resin copy on the pedestal',
        original_phrase: 'The resin copy tucked against her ribs',
        imagery_signature: null,
        reanchor_used: null,
      },
    });

    if (typeof applied === 'string') throw new Error(applied);
    expect(applied.prose).toBe(
      'The resin copy on the pedestal had its chipped eye on the wrong side.',
    );
    // The resolved claim is gone; an unrelated claim on a different entity/column survives.
    expect(applied.digest.grounded_claims).toEqual([
      { entity_id: 'char_vess', column: 'status', asserted_value: 'alive' },
    ]);
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

  it('folds in the validator-detected grounding mismatches and repairs them (ADR 0018)', async () => {
    const client = new ScriptedClient([
      JSON.stringify({
        replacement: 'the amber cat now in her coat',
        original_phrase: 'the resin copy tucked against her ribs',
      }),
    ]);
    const result = await continuityPass({
      ...check({
        digest: digest({
          grounded_claims: [
            { entity_id: 'obj_forgery', column: 'location_id', asserted_value: 'char_vess' },
          ],
        }),
      }),
      prose: 'She felt the resin copy tucked against her ribs.',
      state_updates: NO_UPDATES,
      client,
      occasion: 'read_time',
      groundedClaimMismatches: [
        {
          entity_id: 'obj_forgery',
          column: 'location_id',
          asserted_value: 'char_vess',
          committed_value: 'loc_vault_pedestal',
        },
      ],
    });

    expect(result.findings.map((finding) => finding.mode)).toEqual(['prose_grounding_mismatch']);
    expect(result.repairs[0]?.applied).toBe(true);
    expect(result.prose).toBe('She felt the amber cat now in her coat.');
    expect(result.digest.grounded_claims).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(['continuity_seam_repaired']);
  });
});

describe('one repair per set of words, not per finding (ADR 0011 §5/§7)', () => {
  const seam = (mode: 'cold_open' | 'told_ledger_miscalibration' | 'stale_imagery', subject: string) => ({
    mode,
    scene_id: 'scene_03',
    scene_index: 3,
    subject,
    detail: `${subject} was pitched wrong`,
  });

  it('groups every opening rewrite into one call', () => {
    const groups = groupBySharedRepair([
      seam('told_ledger_miscalibration', 'char_brisk'),
      seam('told_ledger_miscalibration', 'char_nan'),
      seam('cold_open', 'char_pellow'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('keeps imagery swaps one per finding — each names its own phrase in its own place', () => {
    const groups = groupBySharedRepair([
      seam('stale_imagery', 'hearth ash'),
      seam('stale_imagery', 'rain on glass'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.length === 1)).toBe(true);
  });

  it('splits a mixed scene into one opening call plus one call per image', () => {
    const groups = groupBySharedRepair([
      seam('cold_open', 'char_jim'),
      seam('stale_imagery', 'rain on glass'),
      seam('told_ledger_miscalibration', 'char_ada'),
    ]);
    expect(groups.map((group) => group.length)).toEqual([2, 1]);
  });

  it('states every grouped seam in the one prompt, so none is silently dropped', () => {
    const prompt = repairPrompt({
      findings: [
        seam('told_ledger_miscalibration', 'char_brisk'),
        seam('told_ledger_miscalibration', 'char_nan'),
      ],
      fragment: 'The opening paragraph.',
      previousClosing: 'They were on the hill.',
      toldLedgerLines: [],
    });
    expect(prompt).toContain('char_brisk was pitched wrong');
    expect(prompt).toContain('char_nan was pitched wrong');
  });

  it('never asks a repair for closing_situation — an opening rewrite cannot move the ending', () => {
    const schema = repairResponseJsonSchema('opening_rewrite');
    expect(Object.keys(schema['properties'] as object)).not.toContain('closing_situation');
  });
});

describe('prose whose paragraph breaks arrived escaped (issue #64)', () => {
  const escaped = 'The ridge gave out. \\n\\n"Downwind," she said. \\n\\nHe put it down.';

  it('turns literal \\n back into a paragraph break', () => {
    expect(normalizeProse(escaped)).toBe(
      'The ridge gave out. \n\n"Downwind," she said. \n\nHe put it down.',
    );
  });

  it('leaves prose that already has real breaks alone, backslashes and all', () => {
    const real = 'A line.\n\nAnd a path like C:\\names\\here.';
    expect(normalizeProse(real)).toBe(real);
  });

  it('stops an opening rewrite from swallowing a scene with no paragraph break', () => {
    // Before the fallback, this returned the whole string — so the "opening paragraph" a repair
    // replaced was the entire scene.
    const unbroken = 'She opened the hive. The bees were having a difficult morning.';
    expect(openingParagraph(unbroken)).toBe('She opened the hive.');
    expect(openingParagraph(unbroken).length).toBeLessThan(unbroken.length);
  });
});

describe('locating the words an imagery repair named (issue #77)', () => {
  const prose = 'Rain on the glass,\n  again, and the room went quiet.';

  it('takes an exact match, which is what the prompt asks for', () => {
    expect(locatePhrase(prose, 'the room went quiet')).toEqual({ start: 32, end: 51 });
  });

  it('forgives a capital and a line break the model did not reproduce', () => {
    const span = locatePhrase(prose, 'rain on the glass, again');
    expect(span).not.toBeNull();
    expect(prose.slice(span!.start, span!.end)).toBe('Rain on the glass,\n  again');
  });

  it('still refuses a phrase the prose does not contain', () => {
    expect(locatePhrase(prose, 'sleet on the sill')).toBeNull();
  });

  it('swaps over the located span, not over the phrase the model typed', () => {
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
        // Lowercased and with the break collapsed — a repair that used to be thrown away.
        replacement: 'Sleet on the sill',
        original_phrase: 'rain on the glass, again',
        imagery_signature: null,
        reanchor_used: null,
      },
    });

    if (typeof applied === 'string') throw new Error(applied);
    expect(applied.prose).toBe('Sleet on the sill, and the room went quiet.');
  });
});
