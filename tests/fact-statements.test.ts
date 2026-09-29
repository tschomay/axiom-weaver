/**
 * Fact statements and the hidden account (ADR 0022, issue #179).
 *
 * The fixture is The Slackwater Crossing's incident, reduced: the chain whose order scene 9's
 * prose swapped ("Jesse reversed the screw because he had no tiller").
 */

import { describe, expect, it } from 'vitest';
import { StoryPackageSchema, type Fact, type StoryPackage } from '@/schema/story-package';
import {
  FactIndex,
  factTableProblems,
  factsOf,
  mergeHiddenAccount,
} from '@/schema/facts';
import { FABULA_BLOCK, FabulaArcSchema, packageFacts, readFabulaArc } from '@/schema/fabula';
import { WorldModel } from '@/world-model/world-model';
import { DigestHierarchy } from '@/digest/hierarchy';
import { ToldLedger } from '@/digest/told-ledger';
import { buildImageryLedger } from '@/voice/imagery-ledger';
import { cardFromPreset } from '@/voice/voice-card';
import { assemblePrompt, promptText } from '@/assembler/context-assembler';
import { payoffInstructionsFor } from '@/plants/obligation-walk';
import { writerContract } from '@/writer/contract';
import { lintPackage } from '@/authoring/lint';
import { factTableRepairs } from '@/arc/repair';
import { arcResponseJsonSchema, renderArcPrompt } from '@/arc/prompt';
import { briefsFor } from '@/arc/premises';

const FACTS: Fact[] = [
  { fact_ref: 'stop_blocks_removed', statement: 'Teague removed the rudder stop blocks.', caused_by: [] },
  {
    fact_ref: 'jesse_reversed',
    statement: 'Jesse threw the engine full astern because the ferry was drifting onto the weir.',
    caused_by: [],
  },
  {
    fact_ref: 'rudder_jammed',
    statement: 'Under reverse, the unstopped rudder swung past its arc and wedged the shaft.',
    caused_by: ['stop_blocks_removed', 'jesse_reversed'],
  },
  {
    fact_ref: 'gland_torn',
    statement: 'The wedged shaft tore the hull gland and the ferry flooded.',
    caused_by: ['rudder_jammed'],
  },
  {
    fact_ref: 'teague_admits',
    statement: 'Teague admits he removed the stop blocks.',
    caused_by: ['stop_blocks_removed'],
  },
  { fact_ref: 'weir_is_loud', statement: 'The weir is loud enough to drown a whistle.', caused_by: [] },
];

const PACKAGE: StoryPackage = StoryPackageSchema.parse({
  schema_version: '1.0',
  package_version: 1,
  story_id: 'slackwater_reduced',
  world_model_seed: {
    characters: [
      { id: 'char_nita', name: 'Nita', location_id: 'loc_office', status: 'alive' },
      { id: 'char_teague', name: 'Teague', location_id: 'loc_office', status: 'alive' },
    ],
    locations: [{ id: 'loc_office', name: 'the Board office' }],
    objects: [],
    relationships: [],
    character_knowledge: [
      {
        id: 'ck_teague',
        character_id: 'char_teague',
        fact_ref: 'stop_blocks_removed',
        learned_at_scene: null,
      },
    ],
  },
  scene_cards: [
    {
      id: 'scene_09_teagues_offer',
      order: 1,
      pov: 'char_nita',
      location_id: 'loc_office',
      characters_present: ['char_nita', 'char_teague'],
      dramatic_function: 'Teague confesses and offers a deal.',
      entry_state: {},
      exit_state: {},
      required_beats: ['Teague admits pulling the stops'],
      reader_must_learn: ['teague_admits'],
      must_stay_hidden: ['weir_is_loud'],
      pays_off: [{ fact_ref: 'stop_blocks_removed', plant: null }],
    },
  ],
  metadata: { title: 'Slackwater, reduced' },
  facts: FACTS,
});

/** The same package with no facts table at all. */
function withoutFacts(): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...PACKAGE };
  delete copy['facts'];
  return copy;
}

function assemble(pkg: StoryPackage, ledger = ToldLedger.forPackage(pkg)) {
  const voiceCard = cardFromPreset('suspense_taut');
  return promptText(
    assemblePrompt({
      pkg,
      scene: pkg.scene_cards[0]!,
      model: WorldModel.fromSeed(pkg.story_id, pkg.world_model_seed),
      voiceCard,
      hierarchy: new DigestHierarchy(4),
      ledger,
      imageryLedger: buildImageryLedger(voiceCard, []),
      reanchoring: [],
      plantObligations: [],
      payoffInstructions: payoffInstructionsFor(pkg.scene_cards[0]!),
      previousParagraph: null,
      writerContract: writerContract(),
      volatileTailBudget: 20_000,
    }),
  );
}

describe('the fact index', () => {
  const index = new FactIndex(FACTS);

  it('orders a connected account causes before effects', () => {
    expect(index.account(['teague_admits']).map((fact) => fact.fact_ref)).toEqual([
      'stop_blocks_removed',
      'jesse_reversed',
      'rudder_jammed',
      'gland_torn',
      'teague_admits',
    ]);
  });

  it('leaves an unlinked fact out of the account', () => {
    expect(index.isLinked('weir_is_loud')).toBe(false);
    expect(index.account(['weir_is_loud'])).toEqual([]);
  });

  it('reports duplicates, unknown causes and cycles', () => {
    const codes = factTableProblems([
      ...FACTS,
      { fact_ref: 'weir_is_loud', statement: 'again', caused_by: [] },
      { fact_ref: 'orphan', statement: 'x', caused_by: ['never_stated'] },
      { fact_ref: 'loop_a', statement: 'a', caused_by: ['loop_b'] },
      { fact_ref: 'loop_b', statement: 'b', caused_by: ['loop_a'] },
    ]).map((problem) => `${problem.code}:${problem.fact_ref}`);
    expect(codes.sort()).toEqual([
      'fact_cycle:loop_a',
      'fact_cycle:loop_b',
      'fact_duplicate:weir_is_loud',
      'fact_unknown_cause:orphan',
    ]);
    expect(factTableProblems(FACTS)).toEqual([]);
  });
});

describe('rendering to the writer (ADR 0022 decisions 2–3)', () => {
  it('puts each statement beside its slug', () => {
    const prompt = assemble(PACKAGE);
    expect(prompt).toContain('The reader must learn:\n  - teague_admits: Teague admits he removed the stop blocks.');
    expect(prompt).toContain('  - weir_is_loud: The weir is loud enough to drown a whistle.');
    expect(prompt).toContain('    The fact: Teague removed the rudder stop blocks.');
  });

  it('renders the whole connected account in causal order, labelled by reader status', () => {
    const ledger = ToldLedger.forPackage(PACKAGE);
    ledger.touch('rudder_jammed', 1);
    const prompt = assemble(PACKAGE, ledger);

    const block = prompt.slice(prompt.indexOf('ESTABLISHED ACCOUNT'));
    const order = ['stop_blocks_removed:', 'jesse_reversed:', 'rudder_jammed:', 'gland_torn:', 'teague_admits:'];
    const positions = order.map((needle) => block.indexOf(needle));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    expect(block).toContain('[resolve here] stop_blocks_removed');
    expect(block).toContain('[not yet told — do not state it] jesse_reversed');
    expect(block).toContain('[reader already knows — do not re-explain] rudder_jammed');
    expect(block).toContain('[reveal here] teague_admits');
    expect(block).toContain('(because of: stop_blocks_removed, jesse_reversed)');
    // Unlinked, so it lives only in its own card line.
    expect(block).not.toContain('weir_is_loud');
  });

  it('assembles a package without a table exactly as before', () => {
    const bare = StoryPackageSchema.parse(withoutFacts());
    const prompt = assemble(bare);
    expect(prompt).not.toContain('ESTABLISHED ACCOUNT');
    expect(prompt).toContain('The reader must learn: teague_admits');
    expect(factsOf(bare)).toEqual([]);
  });
});

describe('the linter (ADR 0022 decision 6)', () => {
  it('is silent on a package with no table', () => {
    const codes = lintPackage(withoutFacts()).warnings.map((warning) => warning.code);
    expect(codes).not.toContain('fact_without_statement');
  });

  it('errors on a broken table and warns on a card fact with no statement', () => {
    const result = lintPackage({
      ...PACKAGE,
      facts: [
        ...FACTS.filter((fact) => fact.fact_ref !== 'weir_is_loud'),
        { fact_ref: 'orphan', statement: 'x', caused_by: ['never_stated'] },
      ],
    });
    expect(result.errors.map((error) => error.code)).toContain('fact_unknown_cause');
    expect(result.warnings.find((warning) => warning.code === 'fact_without_statement')?.message).toMatch(
      /weir_is_loud/,
    );
  });
});

describe('the hidden account (ADR 0022 decisions 4–5)', () => {
  const steps = [
    { id: 'hidden_01', sequence: 1, summary: 'Teague pulls the stop blocks.', caused_by: [], establishes: ['stop_blocks_removed'] },
    {
      id: 'hidden_02',
      sequence: 2,
      summary: 'Jesse reverses because the ferry drifts onto the weir.',
      caused_by: [],
      establishes: ['jesse_reversed'],
    },
    {
      id: 'hidden_03',
      sequence: 3,
      summary: 'The rudder swings past its arc and wedges the shaft.',
      caused_by: ['hidden_01', 'hidden_02'],
      establishes: ['rudder_jammed'],
    },
  ];

  it('becomes fact statements with inherited causes, table statements winning', () => {
    const merged = mergeHiddenAccount(
      [{ fact_ref: 'rudder_jammed', statement: 'Stated in the table.', caused_by: [] }],
      steps,
    );
    expect(merged.map((fact) => fact.fact_ref)).toEqual([
      'stop_blocks_removed',
      'jesse_reversed',
      'rudder_jammed',
    ]);
    expect(merged[0]!.statement).toBe('Teague pulls the stop blocks.');
    expect(merged[2]).toEqual({
      fact_ref: 'rudder_jammed',
      statement: 'Stated in the table.',
      caused_by: ['stop_blocks_removed', 'jesse_reversed'],
    });
  });

  it('never closes a cycle through inherited causes', () => {
    const looping = [
      { id: 'h1', sequence: 1, summary: 'a', caused_by: ['h2'], establishes: ['a'] },
      { id: 'h2', sequence: 2, summary: 'b', caused_by: ['h1'], establishes: ['b'] },
    ];
    expect(factTableProblems(mergeHiddenAccount([], looping))).toEqual([]);
  });

  it('rides the _fabula block and lands in the package', () => {
    const arc = readFabulaArc({
      metadata: { title: 't' },
      world_model_seed: PACKAGE.world_model_seed,
      [FABULA_BLOCK]: {
        events: [{ id: 'ev_01', sequence: 1, summary: 's', beats: ['b'] }],
        hidden_account: steps,
        facts: [{ fact_ref: 'teague_admits', statement: 'He admits it.', caused_by: ['stop_blocks_removed'] }],
      },
    }).arc;
    expect(arc.hidden_account).toHaveLength(3);
    const facts = packageFacts(arc).facts!;
    expect(facts.map((fact) => fact.fact_ref)).toContain('teague_admits');
    expect(facts.find((fact) => fact.fact_ref === 'rudder_jammed')?.caused_by).toEqual([
      'stop_blocks_removed',
      'jesse_reversed',
    ]);
  });

  it('adds nothing to a package from an arc with neither', () => {
    const arc = FabulaArcSchema.parse({
      title: 't',
      world_model_seed: PACKAGE.world_model_seed,
      events: [{ id: 'ev_01', sequence: 1, summary: 's', beats: ['b'] }],
    });
    expect(packageFacts(arc)).toEqual({});
  });
});

describe('generation (ADR 0022 decision 4)', () => {
  it('asks for the hidden account before the events and statements after them', () => {
    const prompt = renderArcPrompt(briefsFor('structured', 8)[0]!);
    expect(prompt.indexOf('HIDDEN ACCOUNT')).toBeLessThan(prompt.indexOf('EVENTS —'));
    expect(prompt.indexOf('FACTS —')).toBeGreaterThan(prompt.indexOf('EVENTS —'));
    expect((arcResponseJsonSchema(8) as { propertyOrdering: string[] }).propertyOrdering).toEqual([
      'title',
      'world_model_seed',
      'hidden_account',
      'events',
      'facts',
      'stakes',
    ]);
  });

  it('repairs the table mechanically, logging each fix', () => {
    const arc = FabulaArcSchema.parse({
      title: 't',
      world_model_seed: PACKAGE.world_model_seed,
      events: [{ id: 'ev_01', sequence: 1, summary: 's', beats: ['b'] }],
      facts: [
        { fact_ref: 'a', statement: 'a', caused_by: ['b', 'ghost'] },
        { fact_ref: 'b', statement: 'b', caused_by: ['a'] },
        { fact_ref: 'a', statement: 'a again', caused_by: [] },
      ],
    });
    const repaired = factTableRepairs(arc);
    expect(repaired.applied.map((line) => line.split(':')[0]).sort()).toEqual([
      'fact_cycle',
      'fact_duplicate',
      'fact_unknown_cause',
    ]);
    expect(factTableProblems(packageFacts(repaired.arc).facts!)).toEqual([]);
  });
});

describe('recounts (ADR 0022 amendment)', () => {
  it('gives a retelling scene the account even when its card reveals nothing', () => {
    const cards = PACKAGE.scene_cards.map((card) => ({
      ...card,
      reader_must_learn: [],
      must_stay_hidden: [],
      pays_off: [],
      recounts: ['gland_torn'],
    }));
    const pkg = StoryPackageSchema.parse({ ...PACKAGE, scene_cards: cards });
    const ledger = ToldLedger.forPackage(pkg);
    for (const ref of ['stop_blocks_removed', 'jesse_reversed', 'rudder_jammed', 'gland_torn']) {
      ledger.touch(ref, 0);
    }
    const prompt = assemble(pkg, ledger);
    expect(prompt).toContain('The reader already knows these — refer to them in a clause');
    const block = prompt.slice(prompt.indexOf('ESTABLISHED ACCOUNT'));
    expect(block).toContain('[the reader already knows it — a clause, never a re-narration] gland_torn');
    expect(block.indexOf('jesse_reversed:')).toBeLessThan(block.indexOf('rudder_jammed:'));
  });

  it('warns on retelling a fact no earlier scene revealed', () => {
    const early = { ...PACKAGE.scene_cards[0]!, id: 'scene_01', order: 1, reader_must_learn: ['gland_torn'], pays_off: [], must_stay_hidden: [] };
    const late = { ...PACKAGE.scene_cards[0]!, id: 'scene_02', order: 2, reader_must_learn: [], pays_off: [], must_stay_hidden: [], recounts: ['gland_torn', 'jesse_reversed'] };
    const warnings = lintPackage({ ...PACKAGE, scene_cards: [early, late] }).warnings.filter(
      (warning) => warning.code === 'recounts_untold',
    );
    expect(warnings.map((warning) => warning.message)).toEqual([expect.stringMatching(/jesse_reversed/)]);
  });
});
