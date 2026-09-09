import { describe, expect, it } from 'vitest';
import { StateLog, replayOrder, worldModelAsOf } from '@/world-model/state-log';
import { commitValidated, validateStateUpdates } from '@/validator/state-update-authority';
import { columnUpdate, relationshipInsert } from '@/schema/state-update';
import { jimsWorld, scene } from './helpers';

function walkLog() {
  const seed = jimsWorld();
  const log = new StateLog('jim');

  log.appendAll([
    {
      scene_index: 1,
      entity_id: 'char_jim',
      table: 'character',
      column: 'location_id',
      tier: 'P',
      previous_value: 'loc_home',
      new_value: 'loc_park',
      status: 'committed',
    },
    {
      scene_index: 2,
      entity_id: 'char_jim',
      table: 'character',
      column: 'status',
      tier: 'P',
      previous_value: 'alive',
      new_value: 'injured',
      status: 'committed',
    },
    {
      scene_index: 2,
      entity_id: 'char_jim',
      table: 'character',
      column: 'goal',
      tier: 'V',
      previous_value: 'keep his head down',
      new_value: 'get home',
      status: 'proposed_applied',
    },
    {
      scene_index: 3,
      entity_id: 'char_jim',
      table: 'character',
      column: 'goal',
      tier: 'V',
      previous_value: 'get home',
      new_value: 'leave town',
      status: 'proposed_dropped',
    },
    {
      scene_index: 4,
      entity_id: 'rel_002',
      table: 'relationship',
      column: '_row',
      tier: 'P',
      previous_value: null,
      new_value: {
        id: 'rel_002',
        from_id: 'char_jim',
        to_id: 'obj_umbrella',
        kind: 'possesses',
        sentiment: null,
        bag: {},
      },
      status: 'committed',
    },
  ]);

  return { seed, log };
}

describe('the state-update commit log (ADR 0016 §2)', () => {
  it('is append-only, with a sequence that keeps replay order stable', () => {
    const { log } = walkLog();
    expect(log.all().map((entry) => entry.sequence)).toEqual([0, 1, 2, 3, 4]);
    expect(replayOrder(log.all()).map((entry) => entry.sequence)).toEqual([0, 1, 2, 3, 4]);
    expect(log.all().every((entry) => typeof entry.recorded_at === 'string')).toBe(true);
  });

  it('round-trips through its persisted JSON shape', () => {
    const { log } = walkLog();
    const restored = StateLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())));
    expect(restored.all()).toEqual(log.all());
  });

  it('reconstructs the World Model as of scene N for an arbitrary N', () => {
    const { seed, log } = walkLog();

    // Scene 0 is the seed itself.
    expect(worldModelAsOf(seed, log, 0).value('char_jim', 'location_id')).toBe('loc_home');

    const afterOne = worldModelAsOf(seed, log, 1);
    expect(afterOne.value('char_jim', 'location_id')).toBe('loc_park');
    expect(afterOne.value('char_jim', 'status')).toBe('alive');

    const afterTwo = worldModelAsOf(seed, log, 2);
    expect(afterTwo.value('char_jim', 'status')).toBe('injured');
    expect(afterTwo.value('char_jim', 'goal')).toBe('get home');

    // Scene 3's proposal was dropped, so the World Model keeps its prior value.
    expect(worldModelAsOf(seed, log, 3).value('char_jim', 'goal')).toBe('get home');

    const afterFour = worldModelAsOf(seed, log, 4);
    expect(afterFour.row('rel_002')).toMatchObject({ kind: 'possesses', story_id: 'jim' });
    expect(afterFour.relationshipsFrom('char_jim').map((e) => e.id)).toEqual(['rel_002']);

    // The seed is never mutated by a replay.
    expect(seed.value('char_jim', 'location_id')).toBe('loc_home');
    expect(seed.has('rel_002')).toBe(false);
  });

  it('replays every intermediate N monotonically, not just the endpoints', () => {
    const { seed, log } = walkLog();
    const locations = [0, 1, 2, 3, 4, 5].map((n) =>
      worldModelAsOf(seed, log, n).value('char_jim', 'location_id'),
    );
    expect(locations).toEqual([
      'loc_home',
      'loc_park',
      'loc_park',
      'loc_park',
      'loc_park',
      'loc_park',
    ]);
  });

  it('backs the proposals queue: a proposal is an entry not yet resolved', () => {
    const log = new StateLog('jim');
    const pending = log.append({
      scene_index: 1,
      entity_id: 'char_jim',
      table: 'character',
      column: 'goal',
      tier: 'V',
      previous_value: 'keep his head down',
      new_value: 'ask for a raise',
      status: 'proposed',
    });

    expect(log.pendingProposals()).toHaveLength(1);

    log.resolveProposal(pending.sequence, 'accept');
    expect(log.pendingProposals()).toHaveLength(0);
    expect(log.all()[0]?.status).toBe('proposed_applied');

    // The ledger keeps what was decided — resolving twice is an error, not a silent no-op.
    expect(() => log.resolveProposal(pending.sequence, 'reject')).toThrow(/not a pending proposal/);
  });

  it('applies an accepted proposal to the replay only after it is resolved', () => {
    const seed = jimsWorld();
    const log = new StateLog('jim');
    const pending = log.append({
      scene_index: 1,
      entity_id: 'char_jim',
      table: 'character',
      column: 'goal',
      tier: 'V',
      previous_value: 'keep his head down',
      new_value: 'ask for a raise',
      status: 'proposed',
    });

    expect(worldModelAsOf(seed, log, 1).value('char_jim', 'goal')).toBe('keep his head down');
    log.resolveProposal(pending.sequence, 'accept');
    expect(worldModelAsOf(seed, log, 1).value('char_jim', 'goal')).toBe('ask for a raise');
  });
});

describe('the validator and the log together', () => {
  it('records every committed update and resolved proposal, and replays back to them', () => {
    const seed = jimsWorld();
    const model = seed.copy();
    const log = new StateLog('jim');

    const walk = scene({
      required_beats: ['Jim walks to the park', 'he resolves to ask for a raise'],
      exit_state: { char_jim: { location_id: 'loc_park' }, obj_umbrella: { location_id: null } },
    });
    commitValidated(
      model,
      log,
      validateStateUpdates({
        scene: walk,
        model,
        occasion: 'read_time',
        updates: [
          columnUpdate('character', 'char_jim', 'location_id', 'loc_park'),
          columnUpdate('character', 'char_jim', 'goal', 'ask for a raise'),
          relationshipInsert({
            id: 'rel_002',
            from_id: 'char_jim',
            to_id: 'obj_umbrella',
            kind: 'possesses',
            sentiment: null,
            bag: {},
          }),
        ],
      }),
    );

    expect(log.all().map((entry) => entry.status)).toEqual([
      'committed',
      'proposed_applied',
      'committed',
    ]);

    const replayed = worldModelAsOf(seed, log, 1);
    expect(replayed.toJSON()).toEqual(model.toJSON());
  });
});
