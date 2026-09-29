/**
 * Secrets are withheld up to their reveal, and revealed exactly once (#196).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { lintPackage } from '@/authoring/lint';
import { lintFabulaArc } from '@/authoring/lint-fabula';
import { repairTargets, secretRevealRepairs } from '@/arc/repair';
import { assemblePrompt, promptText } from '@/assembler/context-assembler';
import { writerContract } from '@/writer/contract';
import { DigestHierarchy } from '@/digest/hierarchy';
import { ToldLedger } from '@/digest/told-ledger';
import { FABULA_BLOCK, FabulaArcSchema, hiddenAccountFactsOf, readFabulaArc } from '@/schema/fabula';
import { StoryPackageSchema, type SceneCard, type StoryPackage } from '@/schema/story-package';
import { segmentMechanically } from '@/segmentation/segment';
import { wireSecrets } from '@/segmentation/secrets';
import { cardFromPreset } from '@/voice/voice-card';
import { buildImageryLedger } from '@/voice/imagery-ledger';
import { WorldModel } from '@/world-model/world-model';

const SEED = {
  characters: [
    { id: 'char_ruth', name: 'Ruth', location_id: 'loc_boat', status: 'alive' },
    { id: 'char_helen', name: 'Helen', location_id: 'loc_boat', status: 'alive' },
  ],
  locations: [{ id: 'loc_boat', name: 'the boat' }],
  objects: [],
  relationships: [],
  character_knowledge: [
    { id: 'ck_1', character_id: 'char_ruth', fact_ref: 'second_family', learned_at_scene: null },
  ],
};

function card(id: string, order: number, fields: Partial<SceneCard> = {}): SceneCard {
  return {
    id,
    order,
    pov: 'char_ruth',
    location_id: 'loc_boat',
    characters_present: ['char_ruth', 'char_helen'],
    dramatic_function: 'f',
    entry_state: {},
    exit_state: {},
    required_beats: ['b'],
    reader_must_learn: [],
    must_stay_hidden: [],
    force_reintroduce: [],
    invariants: [],
    pays_off: [],
    ...fields,
  } as SceneCard;
}

function pkg(cards: SceneCard[], hidden: string[] = []): Record<string, unknown> {
  return {
    schema_version: '1.0',
    package_version: 1,
    story_id: 'secrets',
    world_model_seed: SEED,
    scene_cards: cards,
    voice_card: {},
    metadata: { title: 't' },
    ...(hidden.length === 0
      ? {}
      : {
          [FABULA_BLOCK]: {
            hidden_account: [{ id: 'hidden_01', sequence: 1, summary: 's', establishes: hidden }],
          },
        }),
  };
}

const errorCodes = (input: unknown) => lintPackage(input).errors.map((error) => error.code);

describe('wireSecrets', () => {
  it('carries a concealed fact from its concealing scene to the scene that reveals it', () => {
    const scenes = [
      card('s1', 1),
      card('s2', 2, { must_stay_hidden: ['forged_cue'] }),
      card('s3', 3),
      card('s4', 4),
      card('s5', 5, { reader_must_learn: ['forged_cue'] }),
      card('s6', 6),
    ];
    wireSecrets(scenes, []);
    expect(scenes.map((scene) => scene.must_stay_hidden.includes('forged_cue'))).toEqual([
      false, true, true, true, false, false,
    ]);
  });

  it('withholds a hidden-account fact from scene 1, and reveals it where it is first paid off', () => {
    const scenes = [
      card('s1', 1),
      card('s2', 2),
      card('s3', 3, { pays_off: [{ fact_ref: 'second_family', plant: null }] }),
    ];
    const report = wireSecrets(scenes, ['second_family']);
    expect(report.revealed_at_payoff).toBe(1);
    expect(scenes[2]!.reader_must_learn).toEqual(['second_family']);
    expect(scenes.map((scene) => scene.must_stay_hidden)).toEqual([
      ['second_family'],
      ['second_family'],
      [],
    ]);
  });

  it('turns a second reveal into a retelling, and re-points a payoff planted at it', () => {
    const scenes = [
      card('s1', 1, { reader_must_learn: ['forged_cue'] }),
      card('s2', 2, { reader_must_learn: ['forged_cue', 'other'] }),
      card('s3', 3, { pays_off: [{ fact_ref: 'forged_cue', plant: 's2' }] }),
    ];
    const report = wireSecrets(scenes, []);
    expect(report.reveals_made_recounts).toBe(1);
    expect(scenes[1]!.reader_must_learn).toEqual(['other']);
    expect(scenes[1]!.recounts).toEqual(['forged_cue']);
    expect(scenes[2]!.pays_off).toEqual([{ fact_ref: 'forged_cue', plant: 's1' }]);
    expect(lintPackage(pkg(scenes)).errors).toEqual([]);
  });
});

describe('secret lints', () => {
  it('revealed_twice: the same fact in reader_must_learn on two cards is an error', () => {
    const cards = [
      card('s1', 1, { reader_must_learn: ['forged_cue'] }),
      card('s2', 2, { reader_must_learn: ['forged_cue'] }),
      card('s3', 3, { pays_off: [{ fact_ref: 'forged_cue', plant: 's1' }] }),
    ];
    const problem = lintPackage(pkg(cards)).errors.find((error) => error.code === 'revealed_twice');
    expect(problem?.path).toBe('scene_cards.s2.reader_must_learn');
    expect(problem?.message).toMatch(/recounts/);
  });

  it('hidden_fact_never_revealed: a hidden-account fact no card reveals is an error', () => {
    const cards = [card('s1', 1), card('s2', 2)];
    expect(errorCodes(pkg(cards, ['second_family']))).toContain('hidden_fact_never_revealed');
    const revealed = [card('s1', 1), card('s2', 2, { reader_must_learn: ['second_family'] })];
    expect(errorCodes(pkg(revealed, ['second_family']))).not.toContain('hidden_fact_never_revealed');
    // A hand-authored package has no hidden account, so the rule is silent there.
    expect(errorCodes(pkg(cards))).not.toContain('hidden_fact_never_revealed');
  });

  it('does not ask for a further payoff for a revealed secret — the reveal pays it off', () => {
    const revealed = [card('s1', 1), card('s2', 2, { reader_must_learn: ['second_family'] })];
    const warnings = lintPackage(pkg(revealed, ['second_family'])).warnings.map((w) => w.code);
    expect(warnings).not.toContain('unpaid_fact');
  });
});

describe('arc-level repair (#196)', () => {
  const arc = FabulaArcSchema.parse({
    title: 'borrowed boat',
    world_model_seed: SEED,
    hidden_account: [
      { id: 'hidden_01', sequence: 1, summary: 'a second family', establishes: ['second_family'] },
      { id: 'hidden_02', sequence: 2, summary: 'a deposit', caused_by: ['hidden_01'], establishes: ['deposit'] },
    ],
    events: [
      { id: 'ev_01', sequence: 1, summary: 'departure', characters_present: ['char_ruth'], beats: ['b'], reveals: ['logbook'] },
      { id: 'ev_02', sequence: 2, summary: 'the logbook again', characters_present: ['char_ruth'], beats: ['b'], reveals: ['logbook'] },
      {
        id: 'ev_03',
        sequence: 3,
        summary: 'the cottage',
        characters_present: ['char_ruth'],
        beats: ['b'],
        pays_off: [
          { fact_ref: 'second_family', plant: null },
          { fact_ref: 'logbook', plant: 'ev_02' },
        ],
      },
    ],
  });

  it('makes a hidden fact that no event reveals a repair target in any plot shape', () => {
    const codes = repairTargets(arc, 'x', { plotShapeId: 'quest' }).map((target) => target.code);
    expect(codes).toContain('hidden_fact_never_revealed');
    expect(codes).toContain('revealed_twice');
    expect(lintFabulaArc(arc, 'x').errors.map((e) => e.code)).toContain('hidden_fact_never_revealed');
  });

  it('mechanically declares a secret where it is paid off, and makes a double reveal a retelling', () => {
    const { arc: repaired, applied } = secretRevealRepairs(arc);
    const byId = new Map(repaired.events.map((event) => [event.id, event]));
    expect(byId.get('ev_03')!.reveals).toContain('second_family');
    expect(byId.get('ev_02')!.reveals).toEqual([]);
    expect(byId.get('ev_02')!.recounts).toEqual(['logbook']);
    expect(byId.get('ev_03')!.pays_off).toContainEqual({ fact_ref: 'logbook', plant: 'ev_01' });
    expect(applied.length).toBe(2);
    // `deposit` is paid off nowhere, so it is left for the model pass rather than invented.
    const codes = repairTargets(repaired, 'x').map((target) => target.code);
    expect(codes).toEqual(['hidden_fact_never_revealed']);
  });
});

describe('panel batch 2026-09-29, re-segmented offline', () => {
  const batch = join(__dirname, '..', 'prototypes', 'story-review', '2026-09-29');
  const envelope = (prefix: string): Record<string, unknown> => {
    const dir = readdirSync(batch).find((name) => name.startsWith(prefix))!;
    return JSON.parse(readFileSync(join(batch, dir, 'package.json'), 'utf8')) as Record<string, unknown>;
  };

  for (const prefix of ['02-', '05-']) {
    it(`${prefix} withholds every secret on every scene up to its single reveal`, () => {
      const source = envelope(prefix);
      const { package: segmented } = segmentMechanically(source);
      const hidden = hiddenAccountFactsOf(source);
      expect(hidden.length).toBeGreaterThan(0);
      const scenes = [...segmented.scene_cards].sort((a, b) => a.order - b.order);

      for (const fact of hidden) {
        const reveals = scenes.filter((scene) => scene.reader_must_learn.includes(fact));
        expect(reveals.length).toBeLessThanOrEqual(1);
        const revealAt = reveals[0]?.order ?? Infinity;
        for (const scene of scenes) {
          expect(scene.must_stay_hidden.includes(fact), `${fact} at scene ${scene.order}`).toBe(
            scene.order < revealAt,
          );
        }
      }
      const all = scenes.flatMap((scene) => scene.reader_must_learn);
      expect(new Set(all).size).toBe(all.length);
    });
  }

  it('02: what the arc never reveals is the one error left, and the arc repair targets it', () => {
    const source = envelope('02-');
    const { package: segmented } = segmentMechanically(source);
    const errors = lintPackage({ ...segmented, [FABULA_BLOCK]: source[FABULA_BLOCK] }).errors;
    expect(errors.map((error) => `${error.code} ${error.path}`)).toEqual([
      'hidden_fact_never_revealed _fabula.hidden_account["father_second_family_tern_bay"]',
    ]);
    const { arc } = readFabulaArc(source);
    expect(repairTargets(arc, 'x').map((target) => target.path)).toContain(
      '_fabula.hidden_account["father_second_family_tern_bay"]',
    );
  });
});

describe('the writer is told who already knows a withheld fact (#196)', () => {
  it('renders the knower line on the card, so it is never evicted', () => {
    const scene = card('s1', 1, { must_stay_hidden: ['second_family'] });
    const parsed = StoryPackageSchema.parse(pkg([scene, card('s2', 2, { reader_must_learn: ['second_family'] })])) as StoryPackage;
    const voiceCard = cardFromPreset('fairy_tale_fable');
    const assembled = assemblePrompt({
      pkg: parsed,
      scene: parsed.scene_cards[0]!,
      model: WorldModel.fromSeed(parsed.story_id, parsed.world_model_seed),
      voiceCard,
      hierarchy: new DigestHierarchy(4),
      ledger: ToldLedger.forPackage(parsed),
      imageryLedger: buildImageryLedger(voiceCard, []),
      reanchoring: [],
      plantObligations: [],
      payoffInstructions: [],
      previousParagraph: '',
      writerContract: writerContract(),
      // A budget so small every optional tail group is evicted.
      volatileTailBudget: 1,
    });
    const text = promptText(assembled);
    expect(text).toContain(
      'Ruth already knows second_family. The narration must not state it, and Ruth must not discover it here',
    );
    expect(text).not.toContain('Helen already knows');
  });
});
