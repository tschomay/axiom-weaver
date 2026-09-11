import { describe, expect, it } from 'vitest';
import {
  checkEntryState,
  checkGroundedClaims,
  commitValidated,
  sceneFootprint,
  validateStateUpdates,
  type Occasion,
} from '@/validator/state-update-authority';
import {
  characterKnowledgeInsert,
  columnUpdate,
  relationshipInsert,
  type StateUpdate,
} from '@/schema/state-update';
import { StateLog } from '@/world-model/state-log';
import type { SceneCard } from '@/schema/story-package';
import type { WorldModel } from '@/world-model/world-model';
import { jimsWorld, scene } from './helpers';

function validate(
  card: SceneCard,
  model: WorldModel,
  updates: StateUpdate[],
  occasion: Occasion = 'read_time',
) {
  return validateStateUpdates({ scene: card, model, updates, occasion });
}

describe('checkEntryState — the pre-generation entry check (ADR 0005 §1)', () => {
  it('passes when the card describes the world it is about to be layered onto', () => {
    const result = checkEntryState(scene(), jimsWorld());
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('raises entry_state_mismatch when the World Model has moved on', () => {
    const model = jimsWorld();
    model.setColumn('char_jim', 'location_id', 'loc_office');

    const result = checkEntryState(scene(), model);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'entry_state_mismatch',
      severity: 'error',
      entity_id: 'char_jim',
      column: 'location_id',
    });
  });

  it('raises entry_state_mismatch when the card names an entity the World Model lacks', () => {
    const card = scene({ entry_state: { char_ghost: { status: 'alive' } } });
    const result = checkEntryState(card, jimsWorld());

    expect(result.diagnostics[0]).toMatchObject({
      code: 'entry_state_mismatch',
      entity_id: 'char_ghost',
    });
  });

  it('checks P/E columns only — a volitional column may legitimately have diverged', () => {
    // ADR 0005 §4: run-to-run divergence on a V column is accepted variance, not a mismatch.
    const model = jimsWorld();
    model.setColumn('char_jim', 'goal', 'see the park in spring');

    const card = scene({
      entry_state: { char_jim: { location_id: 'loc_home', goal: 'keep his head down' } },
    });
    expect(checkEntryState(card, model).ok).toBe(true);
  });
});

describe('validateStateUpdates — physical and epistemic (ADR 0005 §2)', () => {
  it('accepts an update satisfying the exit_state invariant', () => {
    // The worked example: the engine commits Jim.location = park, exactly what the card asked.
    const model = jimsWorld();
    const result = validate(scene(), model, [
      columnUpdate('character', 'char_jim', 'location_id', 'loc_park'),
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.verdicts[0]?.outcome).toBe('satisfies_invariant');
    expect(result.entries[0]).toMatchObject({
      status: 'committed',
      tier: 'P',
      previous_value: 'loc_home',
      new_value: 'loc_park',
    });
  });

  it('accepts an extension on a column the World Model leaves unset', () => {
    // Ordinary texture on a column no invariant names and nothing has committed a value to.
    const model = jimsWorld();
    model.setColumn('obj_umbrella', 'status', null);
    const card = scene({
      exit_state: { char_jim: { location_id: 'loc_park' }, obj_umbrella: { location_id: null } },
    });

    const result = validate(card, model, [
      columnUpdate('object', 'obj_umbrella', 'status', 'soaked'),
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.verdicts[0]?.outcome).toBe('extension');
    expect(result.entries[0]?.status).toBe('committed');
  });

  it('rejects a silent overwrite of a committed value even on a column no invariant names', () => {
    // The amnesia guard is strict by design: an *extension* adds a fact the World Model did not
    // hold, it never overwrites one. ADR 0005's own extension example — "Jim now also happens to
    // be carrying an umbrella" — is a new `possesses` row, not a change to a committed column.
    const model = jimsWorld();
    const card = scene({
      exit_state: { char_jim: { location_id: 'loc_park' }, obj_umbrella: { location_id: null } },
    });

    const result = validate(card, model, [
      columnUpdate('object', 'obj_umbrella', 'status', 'wet'),
    ]);

    expect(result.entries).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe('unentailed_reversion');
  });

  it('rejects an exit_state contradiction', () => {
    const model = jimsWorld();
    const result = validate(scene(), model, [
      columnUpdate('character', 'char_jim', 'location_id', 'loc_office'),
    ]);

    expect(result.entries).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'exit_state_contradiction',
      severity: 'error',
      entity_id: 'char_jim',
      column: 'location_id',
    });
  });

  it('rejects an unauthorized entity update — the mugging-on-the-way case', () => {
    // Ada is not present, is not the scene's location, and no state block names her.
    const model = jimsWorld();
    const result = validate(scene(), model, [
      columnUpdate('character', 'char_ada', 'status', 'injured'),
    ]);

    expect(result.entries).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'unauthorized_entity_update',
      severity: 'error',
      entity_id: 'char_ada',
    });
  });

  it('rejects an unentailed reversion — the amnesia guard', () => {
    const model = jimsWorld();
    model.setColumn('char_jim', 'status', 'injured');

    const card = scene({ entry_state: { char_jim: { location_id: 'loc_home', status: 'injured' } } });
    const result = validate(card, model, [
      columnUpdate('character', 'char_jim', 'status', 'alive'),
    ]);

    expect(result.entries).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'unentailed_reversion',
      severity: 'error',
      entity_id: 'char_jim',
      column: 'status',
    });
  });

  it('accepts the same change once a required beat asks for it', () => {
    const model = jimsWorld();
    model.setColumn('char_jim', 'status', 'injured');

    const card = scene({
      entry_state: { char_jim: { location_id: 'loc_home', status: 'injured' } },
      required_beats: ['Jim walks to the park', 'a stranger binds his leg and he is alive and well again'],
    });
    const result = validate(card, model, [
      columnUpdate('character', 'char_jim', 'status', 'alive'),
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.verdicts[0]?.outcome).toBe('extension');
  });

  it('records no entry for an update that changes nothing', () => {
    const card = scene({
      exit_state: { char_jim: { location_id: 'loc_park' }, obj_umbrella: { status: 'intact' } },
    });
    const result = validate(card, jimsWorld(), [
      columnUpdate('object', 'obj_umbrella', 'status', 'intact'),
    ]);

    expect(result.verdicts[0]?.outcome).toBe('unchanged');
    expect(result.entries).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects an update that restates the entry value the card requires it to leave behind', () => {
    // exit_state names the column, so "no change" is itself a contradiction of the invariant.
    const result = validate(scene(), jimsWorld(), [
      columnUpdate('character', 'char_jim', 'location_id', 'loc_home'),
    ]);

    expect(result.diagnostics[0]?.code).toBe('exit_state_contradiction');
  });

  it('rejects a write to an untiered column — bag is never engine-writable', () => {
    const result = validate(scene(), jimsWorld(), [
      columnUpdate('character', 'char_jim', 'bag', 'anything'),
      columnUpdate('character', 'char_jim', 'id', 'char_james'),
      columnUpdate('character', 'char_jim', 'mood', 'wistful'),
    ]);

    expect(result.entries).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'untiered_column_update',
      'untiered_column_update',
      'untiered_column_update',
    ]);
  });

  it('commits a character_knowledge row insert as an epistemic write', () => {
    const model = jimsWorld();
    const card = scene({ characters_present: ['char_jim', 'char_ada'] });
    const result = validate(card, model, [
      characterKnowledgeInsert({
        id: 'ck_001',
        character_id: 'char_jim',
        fact_ref: 'ada_saw_him_leave',
        learned_at_scene: card.id,
        bag: {},
      }),
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.entries[0]).toMatchObject({
      table: 'character_knowledge',
      column: '_row',
      tier: 'E',
      status: 'committed',
    });
  });

  it('commits a relationship insert as a physical write, and rejects one reaching outside', () => {
    const model = jimsWorld();
    const card = scene({ characters_present: ['char_jim'] });

    const inside = validate(card, model, [
      relationshipInsert({
        id: 'rel_002',
        from_id: 'char_jim',
        to_id: 'obj_umbrella',
        kind: 'possesses',
        sentiment: null,
        bag: {},
      }),
    ]);
    // obj_umbrella is named nowhere on this card, so the edge reaches outside the footprint.
    expect(inside.diagnostics[0]?.code).toBe('unauthorized_entity_update');

    const referenced = scene({
      exit_state: {
        char_jim: { location_id: 'loc_park' },
        obj_umbrella: { location_id: null },
      },
    });
    const result = validate(referenced, model, [
      relationshipInsert({
        id: 'rel_002',
        from_id: 'char_jim',
        to_id: 'obj_umbrella',
        kind: 'possesses',
        sentiment: null,
        bag: {},
      }),
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.entries[0]).toMatchObject({ table: 'relationship', column: '_row', tier: 'P' });
  });
});

describe('validateStateUpdates — volitional (ADR 0005 §3, ADR 0016 §3)', () => {
  it('applies a proposal a required beat asks for, at read time', () => {
    const model = jimsWorld();
    const card = scene({
      required_beats: ['Jim walks to the park', 'he resolves to ask for a raise'],
    });
    const result = validate(card, model, [
      columnUpdate('character', 'char_jim', 'goal', 'ask for a raise'),
    ]);

    expect(result.verdicts[0]?.outcome).toBe('proposal_applied');
    expect(result.entries[0]).toMatchObject({ status: 'proposed_applied', tier: 'V' });
    expect(result.diagnostics[0]).toMatchObject({ code: 'accepted_proposal', severity: 'info' });
  });

  it('drops a proposal the card gives no signal on — silence defaults to inaction', () => {
    const model = jimsWorld();
    const result = validate(scene(), model, [
      columnUpdate('character', 'char_jim', 'goal', 'leave town for good'),
    ]);

    expect(result.verdicts[0]?.outcome).toBe('proposal_dropped');
    expect(result.entries[0]?.status).toBe('proposed_dropped');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'dropped_proposal',
      severity: 'warn',
      reason: 'no_signal',
    });
  });

  it('drops a proposal that would contradict what the card holds in place', () => {
    const model = jimsWorld();
    const card = scene({
      invariants: ['whatever the walk turns up, Jim keeps his head down and nothing shakes him out of it'],
    });
    const result = validate(card, model, [
      columnUpdate('character', 'char_jim', 'goal', 'confront Ada'),
    ]);

    expect(result.diagnostics[0]).toMatchObject({
      code: 'dropped_proposal',
      reason: 'contradicts_invariant',
    });
  });

  it('treats a volitional column baked into exit_state as an invariant, not a proposal', () => {
    // ADR 0005 §3: baking it into exit_state "moves it out of proposal territory entirely".
    const model = jimsWorld();
    const card = scene({
      exit_state: { char_jim: { location_id: 'loc_park', goal: 'ask for a raise' } },
    });

    const matching = validate(card, model, [
      columnUpdate('character', 'char_jim', 'goal', 'ask for a raise'),
    ]);
    expect(matching.verdicts[0]?.outcome).toBe('satisfies_invariant');
    expect(matching.entries[0]?.status).toBe('committed');

    const conflicting = validate(card, model, [
      columnUpdate('character', 'char_jim', 'goal', 'quit on the spot'),
    ]);
    expect(conflicting.diagnostics[0]?.code).toBe('exit_state_contradiction');
  });

  it('queues a proposal at author time rather than resolving it', () => {
    const model = jimsWorld();
    const result = validate(
      scene(),
      model,
      [columnUpdate('character', 'char_jim', 'goal', 'leave town for good')],
      'author_time',
    );

    expect(result.verdicts[0]?.outcome).toBe('proposal_pending');
    expect(result.entries[0]?.status).toBe('proposed');
    expect(result.diagnostics[0]?.code).toBe('pending_proposal');
  });

  it('applies the same accept/drop test to a relationship sentiment', () => {
    const model = jimsWorld();
    const card = scene({
      characters_present: ['char_jim', 'char_ada'],
      required_beats: ['Jim walks to the park', 'Ada comes to resent him for it'],
    });
    const result = validate(card, model, [
      columnUpdate('relationship', 'rel_001', 'sentiment', 'resents'),
    ]);

    expect(result.verdicts[0]?.tier).toBe('V');
    expect(result.verdicts[0]?.outcome).toBe('proposal_applied');
  });
});

describe('sceneFootprint', () => {
  it('covers characters present, the scene location, POV, and every entity a state block names', () => {
    const card = scene({
      characters_present: ['char_jim'],
      exit_state: { char_jim: { location_id: 'loc_park' }, obj_umbrella: { status: 'wet' } },
    });

    expect([...sceneFootprint(card)].sort()).toEqual([
      'char_jim',
      'loc_home',
      'obj_umbrella',
    ]);
  });
});

describe('commitValidated', () => {
  it('applies committed and applied entries, and records dropped ones without applying them', () => {
    const model = jimsWorld();
    const log = new StateLog('jim');
    const card = scene({
      required_beats: ['Jim walks to the park', 'he resolves to ask for a raise'],
    });

    commitValidated(
      model,
      log,
      validate(card, model, [
        columnUpdate('character', 'char_jim', 'location_id', 'loc_park'),
        columnUpdate('character', 'char_jim', 'goal', 'ask for a raise'),
        columnUpdate('object', 'obj_umbrella', 'status', 'wet'),
      ]),
    );

    expect(model.value('char_jim', 'location_id')).toBe('loc_park');
    expect(model.value('char_jim', 'goal')).toBe('ask for a raise');
    // obj_umbrella is outside the footprint of this card, so it was never committed.
    expect(model.value('obj_umbrella', 'status')).toBe('intact');
    expect(log.length).toBe(2);
  });

  it('leaves a pending proposal out of the World Model but inside the queue', () => {
    const model = jimsWorld();
    const log = new StateLog('jim');

    commitValidated(
      model,
      log,
      validate(
        scene(),
        model,
        [columnUpdate('character', 'char_jim', 'goal', 'leave town for good')],
        'author_time',
      ),
    );

    expect(model.value('char_jim', 'goal')).toBe('keep his head down');
    expect(log.pendingProposals()).toHaveLength(1);
  });
});

describe('checkGroundedClaims — prose grounding (ADR 0018 decision 2)', () => {
  it('is silent when a claim agrees with the World Model', () => {
    const mismatches = checkGroundedClaims(
      scene(),
      { grounded_claims: [{ entity_id: 'char_jim', column: 'status', asserted_value: 'alive' }] },
      jimsWorld(),
    );
    expect(mismatches).toEqual([]);
  });

  it('reports the same amnesia guard unentailed_reversion catches, over prose instead of state_updates', () => {
    const model = jimsWorld();
    model.setColumn('char_jim', 'status', 'injured');

    const mismatches = checkGroundedClaims(
      scene({ entry_state: { char_jim: { location_id: 'loc_home', status: 'injured' } } }),
      {
        grounded_claims: [{ entity_id: 'char_jim', column: 'status', asserted_value: 'alive' }],
      },
      model,
    );

    expect(mismatches).toEqual([
      {
        entity_id: 'char_jim',
        column: 'status',
        asserted_value: 'alive',
        committed_value: 'injured',
      },
    ]);
  });

  it('is silent once a required beat entails the claimed value — same test as unentailed_reversion', () => {
    const model = jimsWorld();
    model.setColumn('char_jim', 'status', 'injured');

    const card = scene({
      entry_state: { char_jim: { location_id: 'loc_home', status: 'injured' } },
      required_beats: ['Jim walks to the park', 'a stranger binds his leg and he is alive and well again'],
    });

    const mismatches = checkGroundedClaims(
      card,
      { grounded_claims: [{ entity_id: 'char_jim', column: 'status', asserted_value: 'alive' }] },
      model,
    );
    expect(mismatches).toEqual([]);
  });

  it('is silent when nothing is committed yet — filling a null column is an extension, not a reversion', () => {
    const model = jimsWorld();
    model.setColumn('char_jim', 'status', null);

    const mismatches = checkGroundedClaims(
      scene(),
      { grounded_claims: [{ entity_id: 'char_jim', column: 'status', asserted_value: 'alive' }] },
      model,
    );
    expect(mismatches).toEqual([]);
  });

  it('ignores a claim about a volitional column — out of scope for a P/E-only checkpoint', () => {
    const mismatches = checkGroundedClaims(
      scene(),
      {
        grounded_claims: [
          { entity_id: 'char_jim', column: 'goal', asserted_value: 'leave town for good' },
        ],
      },
      jimsWorld(),
    );
    expect(mismatches).toEqual([]);
  });

  it('ignores a claim about an entity the World Model has no row for', () => {
    const mismatches = checkGroundedClaims(
      scene(),
      {
        grounded_claims: [
          { entity_id: 'char_ghost', column: 'status', asserted_value: 'alive' },
        ],
      },
      jimsWorld(),
    );
    expect(mismatches).toEqual([]);
  });
});
