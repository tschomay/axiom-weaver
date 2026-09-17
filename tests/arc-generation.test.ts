/**
 * Offline tests for the original-arc generator (issue #119).
 *
 * Nothing here calls the API. The live measurements are the run reports under
 * `prototypes/arc-generation/`; what these tests hold is the machinery those measurements rest
 * on — that the deliverable is the shape #113's integration boundary promises, that the
 * provisional projection really does put the *repo's own* linter over the graph, and that the
 * repair loop makes the atomic edits it claims to and no others.
 */

import { describe, expect, it } from 'vitest';

import { DraftStoryPackageSchema } from '../src/schema/manuscript';
import { parseStoryPackage } from '../src/schema/story-package';
import { lintPackage } from '../src/authoring/lint';
import { parseImport } from '../src/authoring/transfer';
import {
  EVENT_COUNT_BAND,
  eventCountForSceneTarget,
  materializeBrief,
  materializePlotShape,
  plantPolicyFor,
} from '../src/arc/brief';
import { draftPackage } from '../src/arc/fabula';
import { provisionalPackage } from '../src/authoring/lint-fabula';
import { FABULA_BLOCK, FabulaArcSchema, type FabulaArc } from '../src/schema/fabula';
import { presenceProblems, stateChainingProblems } from '../src/arc/chaining';
import { applyEdits, mechanicalRepairs, repairTargets } from '../src/arc/repair';
import {
  scoreDiversity,
  scoreMechanical,
  scoreMechanicalPackage,
  spanHistogram,
} from '../src/arc/rubric';
import { blindArcView, summarize } from '../src/arc/judge';
import { briefsFor } from '../src/arc/premises';
import { renderArcPrompt, arcResponseJsonSchema } from '../src/arc/prompt';
import cinderella from '../fixtures/cinderella/package.json';

/** A small, deliberately valid arc: 5 events, one span-3 plant/payoff pair. */
function sampleArc(): FabulaArc {
  return FabulaArcSchema.parse({
    title: 'The Low Water',
    world_model_seed: {
      characters: [
        { id: 'char_inspector', name: 'Wren Adeyemi', location_id: 'loc_office', status: 'working', goal: 'keep the crossing open', bag: {} },
        { id: 'char_pilot', name: 'Tomas Vrba', location_id: 'loc_landing', status: 'working', goal: 'get one more season', bag: {} },
      ],
      locations: [
        { id: 'loc_office', name: 'District office', bag: {} },
        { id: 'loc_landing', name: 'Ferry landing', bag: {} },
      ],
      objects: [{ id: 'obj_logbook', name: 'Inspection logbook', location_id: 'loc_office', status: 'intact', bag: {} }],
      relationships: [],
      character_knowledge: [],
    },
    events: [
      {
        id: 'ev_01_signing', sequence: 1, summary: 'The inspection is signed off.',
        pov: 'char_inspector', location_id: 'loc_office', characters_present: ['char_inspector'],
        dramatic_function: 'Establish the certification and the pressure behind it.',
        beats: ['the certificate is signed'], caused_by: [], reveals: ['hull_seam_was_reported'],
        conceals: [], pays_off: [], state_changes: [],
      },
      {
        id: 'ev_02_crossing', sequence: 2, summary: 'The ferry crosses.',
        pov: 'char_pilot', location_id: 'loc_landing', characters_present: ['char_pilot'],
        dramatic_function: 'Show the crossing as routine.',
        beats: ['the ferry makes the crossing'], caused_by: ['ev_01_signing'], reveals: [],
        conceals: [], pays_off: [], state_changes: [],
      },
      {
        id: 'ev_03_sinking', sequence: 3, summary: 'The ferry goes down in calm water.',
        pov: 'char_pilot', location_id: 'loc_landing', characters_present: ['char_pilot'],
        dramatic_function: 'The disturbance.',
        beats: ['the ferry sinks'], caused_by: ['ev_02_crossing'], reveals: [],
        conceals: [], pays_off: [], state_changes: [{ entity_id: 'char_pilot', column: 'status', value: 'missing' }],
      },
      {
        id: 'ev_04_inquiry', sequence: 4, summary: 'The inquiry opens.',
        pov: 'char_inspector', location_id: 'loc_office', characters_present: ['char_inspector'],
        dramatic_function: 'Raise the cost of the answer.',
        beats: ['the inquiry names her'], caused_by: ['ev_03_sinking'], reveals: [],
        conceals: [], pays_off: [], state_changes: [],
      },
      {
        id: 'ev_05_account', sequence: 5, summary: 'She finds the report she never wrote down.',
        pov: 'char_inspector', location_id: 'loc_office', characters_present: ['char_inspector'],
        dramatic_function: 'The solution, and its cost.',
        beats: ['she reads the seam report back'], caused_by: ['ev_04_inquiry'], reveals: [],
        conceals: [], pays_off: [{ fact_ref: 'hull_seam_was_reported', plant: 'ev_01_signing' }],
        state_changes: [],
      },
    ],
  });
}

describe('the input surface', () => {
  it('names the Fabula-layer parameter plot_shape, never genre', () => {
    const brief = briefsFor('structured')[0];
    expect(brief).toBeDefined();
    expect(JSON.stringify(brief)).not.toMatch(/"genre"/);
    expect(brief?.plot_shape.name).toBe('Mystery');
  });

  it('materializes a preset into editable rows rather than carrying a tag (ADR 0007 d.4)', () => {
    const shape = materializePlotShape('mystery');
    expect(shape.phases.length).toBeGreaterThan(2);
    expect(shape.cast_roles.length).toBeGreaterThan(2);
    expect(shape.obligatory_moves.length).toBeGreaterThan(0);

    // Editing what came back must not reach the shared definition.
    shape.phases[0] = { ...shape.phases[0]!, name: 'edited' };
    expect(materializePlotShape('mystery').phases[0]?.name).not.toBe('edited');
  });

  it('keeps based_on as provenance only — the prompt reads the materialized fields', () => {
    const brief = materializeBrief({
      story_id: 's', title: 't',
      premise: { logline: 'a thing happens', modules: null },
      plot_shape_preset: 'quest',
      plot_shape_overrides: { name: 'Renamed shape' },
    });
    expect(brief.based_on.plot_shape_preset).toBe('quest');
    const prompt = renderArcPrompt(brief);
    expect(prompt).toContain('Renamed shape');
    expect(prompt).not.toContain('based_on');
  });

  it('measures length in events, calibrated against the fixtures\' scene counts', () => {
    // Cinderella is 14 Scene Cards, the Carol 20 — both land inside the band.
    expect(eventCountForSceneTarget(14)).toBeGreaterThanOrEqual(EVENT_COUNT_BAND.min);
    expect(eventCountForSceneTarget(20)).toBeLessThanOrEqual(EVENT_COUNT_BAND.max);
    expect(eventCountForSceneTarget(20)).toBeGreaterThan(eventCountForSceneTarget(14));
    expect(JSON.stringify(materializeBrief({
      story_id: 's', title: 't', premise: { logline: 'x', modules: null }, plot_shape_preset: 'quest',
    }))).not.toMatch(/length_budget/);
  });

  it('scales plant density the way ADR 0006 scales required_beats', () => {
    const loose = plantPolicyFor('loose', 20);
    const tight = plantPolicyFor('tight', 20);
    expect(tight.target_edges).toBeGreaterThan(loose.target_edges);
    // `loose` sits at the human-authored fixtures' own rate: 2 edges / 14 scenes, 3 / 20.
    expect(loose.target_edges).toBeLessThanOrEqual(4);
  });

  it('shows span guidance only in the arm that asked for it', () => {
    const [withGuidance] = briefsFor('structured');
    const [without] = briefsFor('no_span_guidance');
    expect(renderArcPrompt(withGuidance!)).toContain('must span');
    expect(renderArcPrompt(without!)).not.toContain('must span');
  });
});

describe('the deliverable', () => {
  it('is Fabula-only and valid against DraftStoryPackageSchema', () => {
    const arc = sampleArc();
    const pkg = draftPackage(arc, 'arc_test', {
      generator: 'test', model: 'test-model', generated_at: '2026-09-16T00:00:00Z',
      brief: briefsFor('structured')[0]!, repairs: [],
    });

    const parsed = DraftStoryPackageSchema.parse(pkg);
    expect(parsed.scene_cards).toHaveLength(0);
    expect(parsed.world_model_seed.characters.length).toBeGreaterThan(0);
  });

  it('rides through the import escape hatch with its event list intact (#113)', () => {
    const arc = sampleArc();
    const pkg = draftPackage(arc, 'arc_test', {
      generator: 'test', model: 'test-model', generated_at: '2026-09-16T00:00:00Z',
      brief: briefsFor('structured')[0]!, repairs: [],
    });

    const imported = parseImport(JSON.stringify(pkg));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.summary.extra_blocks).toContain(FABULA_BLOCK);
    expect((imported.package as Record<string, unknown>)[FABULA_BLOCK]).toBeDefined();
  });

  it('records the model that produced it, per AGENTS.md', () => {
    const pkg = draftPackage(sampleArc(), 'arc_test', {
      generator: 'test', model: 'gemini-3.8-flash', generated_at: '2026-09-16T00:00:00Z',
      brief: briefsFor('structured')[0]!, repairs: [],
    });
    expect(JSON.stringify(pkg)).toContain('gemini-3.8-flash');
  });
});

describe('the provisional projection', () => {
  it('parses as a real Story Package, so the real linter rules on it', () => {
    const pkg = provisionalPackage(sampleArc(), 'arc_test');
    expect(() => parseStoryPackage(pkg)).not.toThrow();
    expect(lintPackage(pkg).publishable).toBe(true);
  });

  it('lets the plant walk see a graph the deliverable itself cannot be linted for', () => {
    // The deliverable has no Scene Cards, so `lintPackage` refuses it outright — which is the
    // whole reason the projection exists.
    const deliverable = draftPackage(sampleArc(), 'arc_test', {
      generator: 'test', model: 'm', generated_at: 'now', brief: briefsFor('structured')[0]!, repairs: [],
    });
    expect(lintPackage(deliverable).publishable).toBe(false);
    expect(lintPackage(deliverable).errors.some((e) => e.path === 'scene_cards')).toBe(true);
  });

  it('carries an undeclared plant through to plant_not_declared', () => {
    const arc = sampleArc();
    const broken: FabulaArc = {
      ...arc,
      events: arc.events.map((event) =>
        event.id === 'ev_01_signing' ? { ...event, reveals: [] } : event,
      ),
    };
    const codes = repairTargets(broken, 'arc_test').map((target) => target.code);
    expect(codes).toContain('plant_not_declared');
  });

  it('catches a plant that does not precede its payoff', () => {
    const arc = sampleArc();
    const broken: FabulaArc = {
      ...arc,
      events: arc.events.map((event) =>
        event.id === 'ev_05_account'
          ? { ...event, pays_off: [{ fact_ref: 'hull_seam_was_reported', plant: 'ev_05_account' }] }
          : event,
      ),
    };
    expect(repairTargets(broken, 'arc_test').map((t) => t.code)).toContain('plant_after_payoff');
  });

  it('promotes unpaid_fact and no_required_beats to gates for a generated arc', () => {
    const arc = sampleArc();
    const broken: FabulaArc = {
      ...arc,
      events: arc.events.map((event) =>
        event.id === 'ev_02_crossing'
          ? { ...event, beats: [], reveals: ['nobody_ever_collects_this'] }
          : event,
      ),
    };
    const codes = repairTargets(broken, 'arc_test').map((t) => t.code);
    expect(codes).toContain('unpaid_fact');
    expect(codes).toContain('no_required_beats');
    // …and stay warnings in the linter itself, which this ticket does not change.
    const lint = lintPackage(provisionalPackage(broken, 'arc_test'));
    expect(lint.warnings.some((w) => w.code === 'unpaid_fact')).toBe(true);
    expect(lint.errors.some((w) => w.code === 'unpaid_fact')).toBe(false);
  });
});

describe('bounded atomic repair', () => {
  it('installs a declaration for a plant the generator named but did not declare', () => {
    const arc = sampleArc();
    const broken: FabulaArc = {
      ...arc,
      events: arc.events.map((e) => (e.id === 'ev_01_signing' ? { ...e, reveals: [] } : e)),
    };
    const repaired = mechanicalRepairs(broken);
    expect(repaired.applied).toHaveLength(1);
    expect(repairTargets(repaired.arc, 'arc_test')).toHaveLength(0);
  });

  it('never invents a plant for a payoff that named none — that is ADR 0004 d.2\'s guess', () => {
    const arc = sampleArc();
    const orphan: FabulaArc = {
      ...arc,
      events: arc.events.map((e) =>
        e.id === 'ev_05_account'
          ? { ...e, pays_off: [{ fact_ref: 'never_planted_anywhere', plant: 'ev_99_missing' }] }
          : e,
      ),
    };
    const repaired = mechanicalRepairs(orphan);
    expect(repaired.applied).toHaveLength(0);
    expect(repairTargets(repaired.arc, 'arc_test').map((t) => t.code)).toContain('plant_scene_unknown');
  });

  it('applies only the edits it is given, and skips ones naming nothing real', () => {
    const arc = sampleArc();
    const { arc: edited, applied } = applyEdits(arc, [
      { kind: 'drop_payoff', event_id: 'ev_05_account', fact_ref: 'hull_seam_was_reported', plant_event_id: '', text: '', character_id: '', because: '' },
      { kind: 'add_beat', event_id: 'ev_99_nope', fact_ref: '', plant_event_id: '', text: 'x', character_id: '', because: '' },
    ]);
    expect(applied).toHaveLength(1);
    expect(edited.events.find((e) => e.id === 'ev_05_account')?.pays_off).toHaveLength(0);
  });

  it('seeds a fact as a character_knowledge row a seed-grounded payoff can rest on', () => {
    const arc = sampleArc();
    const { arc: edited } = applyEdits(arc, [
      { kind: 'repoint_plant', event_id: 'ev_05_account', fact_ref: 'hull_seam_was_reported', plant_event_id: '', text: '', character_id: '', because: '' },
      { kind: 'seed_fact', event_id: '', fact_ref: 'hull_seam_was_reported', plant_event_id: '', text: '', character_id: 'char_pilot', because: '' },
    ]);
    expect(edited.world_model_seed.character_knowledge).toHaveLength(1);
    // Now unpaid_fact fires instead: ev_01 still reveals a fact nothing collects by that route.
    const codes = repairTargets(edited, 'arc_test').map((t) => t.code);
    expect(codes).not.toContain('unfounded_seed_payoff');
  });
});

describe('§4.1 mechanical scoring', () => {
  it('passes every gate on a well-formed arc and reports its span histogram', () => {
    const score = scoreMechanical(sampleArc(), 'arc_test');
    expect(score.all_gates_passed).toBe(true);
    expect(score.plant_spans.histogram.edges).toBe(1);
    expect(score.plant_spans.histogram.counts[4]).toBe(1);
    expect(score.plant_spans.histogram.share_span_1).toBe(0);
  });

  /**
   * #120 scores §4.1 over the segmented Story Package rather than the Fabula projection, so the
   * package-level half is its own function. On the projection the two must agree exactly, or
   * #119's published numbers and #120's stop being comparable.
   */
  it('scores a real package and the projection through the same code', () => {
    const arc = sampleArc();
    expect(scoreMechanicalPackage(provisionalPackage(arc, 'arc_test'), arc, 'arc_test')).toEqual(
      scoreMechanical(arc, 'arc_test'),
    );
    expect(scoreMechanical(arc, 'arc_test').events).toBe(arc.events.length);
  });

  it('reports the span-1 share, which is the number §6 predicts will collapse', () => {
    const arc = sampleArc();
    const adjacent: FabulaArc = {
      ...arc,
      events: arc.events.map((e) =>
        e.id === 'ev_04_inquiry'
          ? { ...e, reveals: ['the_seam'] }
          : e.id === 'ev_05_account'
            ? { ...e, pays_off: [...e.pays_off, { fact_ref: 'the_seam', plant: 'ev_04_inquiry' }] }
            : e,
      ),
    };
    const histogram = scoreMechanical(adjacent, 'arc_test').plant_spans.histogram;
    expect(histogram.edges).toBe(2);
    expect(histogram.share_span_1).toBe(0.5);
  });

  it('flags a teleport the linter cannot see', () => {
    const arc = sampleArc();
    const teleport: FabulaArc = {
      ...arc,
      events: arc.events.map((e) =>
        e.id === 'ev_02_crossing' ? { ...e, characters_present: ['char_pilot', 'char_inspector'], pov: 'char_pilot' } : e,
      ),
    };
    const problems = presenceProblems(teleport);
    expect(problems.some((p) => p.code === 'character_teleported')).toBe(true);
    // …and the linter is still perfectly happy, which is the point.
    expect(lintPackage(provisionalPackage(teleport, 'arc_test')).publishable).toBe(true);
  });

  it('says so when entry/exit chaining had nothing to compare', () => {
    const score = scoreMechanical(sampleArc(), 'arc_test');
    expect(score.state_chaining.vacuous).toBe(true);
    expect(score.state_chaining.coverage.compared).toBe(0);
  });

  it('finds a real chaining contradiction in a package that has entry states', () => {
    const pkg = parseStoryPackage({
      ...parseStoryPackage(cinderella),
      scene_cards: [
        { id: 'a', order: 1, pov: 'char_cinderella', location_id: 'loc_house', characters_present: ['char_cinderella'], dramatic_function: 'x', entry_state: {}, exit_state: { char_cinderella: { status: 'alive' } }, required_beats: ['x'], reader_must_learn: [], must_stay_hidden: [], force_reintroduce: [], invariants: [], pays_off: [] },
        { id: 'b', order: 2, pov: 'char_cinderella', location_id: 'loc_house', characters_present: ['char_cinderella'], dramatic_function: 'x', entry_state: { char_cinderella: { status: 'transformed' } }, exit_state: {}, required_beats: ['x'], reader_must_learn: [], must_stay_hidden: [], force_reintroduce: [], invariants: [], pays_off: [] },
      ],
    });
    const problems = stateChainingProblems(pkg);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe('entry_state_contradicts_exit');
  });

  it('flags the documented lexical mode-collapse vocabulary', () => {
    const arc = sampleArc();
    const collapsed: FabulaArc = {
      ...arc,
      world_model_seed: {
        ...arc.world_model_seed,
        locations: [{ id: 'loc_light', name: 'The lighthouse', bag: {} }, ...arc.world_model_seed.locations],
      },
    };
    expect(scoreMechanical(collapsed, 'arc_test').lexical_canary).toContain('lighthouse');
    expect(scoreMechanical(arc, 'arc_test').lexical_canary).toHaveLength(0);
  });

  it('scores the human-authored fixtures with the same instruments', () => {
    const pkg = parseStoryPackage(cinderella);
    const histogram = spanHistogram(pkg);
    // The measured human baseline: 2 edges across 14 scenes, spans 5 and 2.
    expect(histogram.edges).toBe(2);
    expect(histogram.max).toBe(5);
    expect(lintPackage(pkg).publishable).toBe(true);
  });

  it('reports cross-arc diversity over several arcs', () => {
    const one = sampleArc();
    const two: FabulaArc = {
      ...one,
      world_model_seed: {
        ...one.world_model_seed,
        characters: one.world_model_seed.characters.map((row) => ({ ...row, name: `Other ${row.name}` })),
      },
    };
    const diversity = scoreDiversity([one, two]);
    expect(diversity.arcs).toBe(2);
    expect(diversity.mean_pairwise_overlap).toBeGreaterThan(0.9);
    expect(diversity.shared_names).toContain('wren');
  });
});

describe('the judge', () => {
  it('renders a fixture and a generated arc into the same blind shape', () => {
    const fixtureView = blindArcView(parseStoryPackage(cinderella));
    const generatedView = blindArcView(provisionalPackage(sampleArc(), 'arc_test'));
    for (const view of [fixtureView, generatedView]) {
      expect(view).toContain('EVENTS, IN ORDER');
      expect(view).toMatch(/^E01 @ /m);
    }
    // No scene/event id, no entity id, and no title survives to tell the judge which is which.
    expect(fixtureView).not.toContain('scene_01');
    expect(fixtureView).not.toContain('char_cinderella');
    expect(fixtureView).not.toContain('Cinderella, or the Little Glass Slipper');
    expect(generatedView).not.toContain('ev_01');
    expect(generatedView).not.toContain('char_inspector');
    // …and the names, which the judge needs, are still there.
    expect(fixtureView).toContain('Cinderella');
  });

  it('applies each §4.2 bar separately and never composites them', () => {
    const score = summarize(
      {
        causal_pairs: [
          { pair: 'E01→E02', verdict: 'causes', why: '' },
          { pair: 'E02→E03', verdict: 'contradicts', why: '' },
        ],
        payoffs: [{ fact_ref: 'f', verdict: 'earned', why: '' }],
        closest_stock_shape: 'whodunnit',
        stock_adherence: 2,
        thematic_coherence: 5,
        engagement: 5,
        notes: '',
      },
      'test',
      'gemini-3.8-flash',
    );
    // A single `contradicts` fails causal follow-through however good everything else is.
    expect(score.causal.passed).toBe(false);
    expect(score.thematic_coherence.passed).toBe(true);
    expect(score).not.toHaveProperty('overall');
    expect(score.judge_model).toBe('gemini-3.8-flash');
  });
});

describe('the response schema', () => {
  it('carries no array bound — 10+ is a measured 400 from the API (see ./prompt.ts)', () => {
    const properties = arcResponseJsonSchema(17)['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    const events = properties['events'] as {
      minItems?: number;
      maxItems?: number;
      description: string;
    };
    expect(events.minItems).toBeUndefined();
    expect(events.maxItems).toBeUndefined();
    expect(events.description).toContain('17');
  });

  it('orders pays_off after the event\'s own content', () => {
    const schema = arcResponseJsonSchema(17);
    const properties = schema['properties'] as Record<string, Record<string, unknown>>;
    const events = properties['events'] as { items: { propertyOrdering: string[] } };
    const order = events.items.propertyOrdering;
    expect(order.indexOf('pays_off')).toBe(order.length - 1);
    expect(order.indexOf('reveals')).toBeLessThan(order.indexOf('pays_off'));
    // The seed comes back before the events that reference it.
    expect(schema['propertyOrdering']).toEqual(['title', 'world_model_seed', 'events']);
  });
});
