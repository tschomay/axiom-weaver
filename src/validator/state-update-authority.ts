/**
 * State-update authority: what the engine may commit (ADR 0005, with ADR 0016 §3's author-time
 * addition).
 *
 * Two checkpoints, not one:
 *
 *   1. **Pre-generation** — `checkEntryState`. Before the writer runs, the Scene Card's declared
 *      `entry_state` is compared against the actual World Model, on P/E columns only. A mismatch
 *      means the card no longer describes the world it is about to be layered onto.
 *   2. **Post-generation** — `validateStateUpdates`. Every proposed update is checked before it
 *      is committed: accepted as an extension, accepted as satisfying the invariant, rejected
 *      with one of ADR 0005 §2's named errors, or — for volitional columns — captured as a
 *      proposal and resolved per §3 (read-time) or queued per ADR 0016 §3 (author-time).
 *
 * Nothing here aborts a run. A rejected update simply never reaches the World Model, which keeps
 * its pre-scene value for that column, and a diagnostic is logged (§5).
 */

import {
  ROW_COLUMN,
  columnAuthority,
  isAutoCommittedTier,
  type Tier,
} from '../schema/tiers';
import {
  entityAssertions,
  newCharacterKnowledge,
  newRelationships,
  type SceneCard,
  type SceneState,
  type StateValue,
} from '../schema/story-package';
import {
  updateColumn,
  updateTargetId,
  updateValue,
  type StateUpdate,
} from '../schema/state-update';
import { WorldModel, type WorldModelRow } from '../world-model/world-model';
import type { NewStateLogEntry, StateLog, StateLogStatus } from '../world-model/state-log';
import { diagnostic, type Diagnostic } from './diagnostics';
import type { SceneDigest } from '../digest/scene-digest';

/** Author-time compiling has a human present; read-time never does. */
export type Occasion = 'author_time' | 'read_time';

export type UpdateOutcome =
  /** The update's column is named in `exit_state` and the value matches. */
  | 'satisfies_invariant'
  /** Ordinary texture: a column no invariant names, not contradicting anything asserted. */
  | 'extension'
  /** The value already equals the committed one — nothing to record. */
  | 'unchanged'
  /** Rejected; the World Model keeps its pre-scene value. */
  | 'rejected'
  /** Volitional, resolved as applied (read-time). */
  | 'proposal_applied'
  /** Volitional, resolved as dropped (read-time). */
  | 'proposal_dropped'
  /** Volitional, awaiting the author's decision (author-time). */
  | 'proposal_pending';

export interface UpdateVerdict {
  readonly update: StateUpdate;
  readonly table: StateUpdate['table'];
  readonly entity_id: string;
  readonly column: string;
  readonly tier: Tier | null;
  readonly outcome: UpdateOutcome;
  readonly diagnostic: Diagnostic | null;
  /** The log entry this verdict produces, or `null` where there is nothing to record. */
  readonly entry: NewStateLogEntry | null;
}

export interface ValidationResult {
  readonly scene: SceneCard;
  readonly occasion: Occasion;
  readonly verdicts: UpdateVerdict[];
  readonly diagnostics: Diagnostic[];
  /** Ready to append to the state-update commit log, in update order. */
  readonly entries: NewStateLogEntry[];
}

export interface EntryCheckResult {
  readonly ok: boolean;
  readonly diagnostics: Diagnostic[];
}

// --- The scene's footprint ----------------------------------------------------------------

/**
 * The set of entity ids a scene gives the engine a narrative reason to touch.
 *
 * ADR 0005 §2 names it as "`characters_present`, its `location_id`, or an object not referenced
 * by the scene". Made concrete here as: every character present, the scene's location, and every
 * entity the card names in `entry_state` or `exit_state` — which is where a card references an
 * object it means the scene to touch. Relationship and character-knowledge rows are not listed
 * directly; they are in-footprint when their endpoints are (see `isInFootprint`).
 */
export function sceneFootprint(scene: SceneCard): Set<string> {
  const footprint = new Set<string>(scene.characters_present);
  footprint.add(scene.location_id);
  footprint.add(scene.pov);
  for (const state of [scene.entry_state, scene.exit_state]) {
    for (const [entityId] of entityAssertions(state)) {
      footprint.add(entityId);
    }
    // A row the card itself declares under `_new_relationships` / `_new_character_knowledge` is
    // authorized by that declaration, and so are its endpoints — the author has named the
    // narrative reason. Cinderella's fitting records that the Prince learns who she is without
    // the Prince standing in the room; the Carol's Scrooge becomes a merciful creditor to
    // Caroline, who is not present either.
    for (const row of newRelationships(state)) {
      footprint.add(row.id);
      footprint.add(row.from_id);
      footprint.add(row.to_id);
    }
    for (const row of newCharacterKnowledge(state)) {
      footprint.add(row.id);
      footprint.add(row.character_id);
    }
  }
  return footprint;
}

function isInFootprint(
  update: StateUpdate,
  footprint: Set<string>,
  model: WorldModel,
): boolean {
  if (update.kind === 'row') {
    if (update.table === 'relationship') {
      const row = update.row as { from_id: string; to_id: string };
      return footprint.has(row.from_id) && footprint.has(row.to_id);
    }
    const row = update.row as { character_id: string };
    return footprint.has(row.character_id);
  }

  if (footprint.has(update.entity_id)) return true;

  // A relationship or knowledge row is in-footprint when its endpoints are.
  const row = model.row(update.entity_id);
  if (row === null) return false;
  if (update.table === 'relationship') {
    const edge = row as { from_id: string; to_id: string };
    return footprint.has(edge.from_id) && footprint.has(edge.to_id);
  }
  if (update.table === 'character_knowledge') {
    const known = row as { character_id: string };
    return footprint.has(known.character_id);
  }
  return false;
}

// --- Reading the card's assertions ---------------------------------------------------------

function assertedValue(
  state: SceneState,
  entityId: string,
  column: string,
): { asserted: boolean; value: StateValue } {
  for (const [id, columns] of entityAssertions(state)) {
    if (id !== entityId) continue;
    if (Object.prototype.hasOwnProperty.call(columns, column)) {
      return { asserted: true, value: columns[column] ?? null };
    }
  }
  return { asserted: false, value: null };
}

function allAssertedValues(scene: SceneCard): StateValue[] {
  const values: StateValue[] = [];
  for (const state of [scene.entry_state, scene.exit_state]) {
    for (const [, columns] of entityAssertions(state)) {
      values.push(...Object.values(columns));
    }
  }
  return values;
}

/**
 * The phrasings a value could plausibly take in a card's prose fields.
 *
 * A slug (`loc_ball_hall`) never appears verbatim in a required beat, so the readable forms —
 * the slug's words, and the display name of the row it points at — are what get matched.
 */
function textCandidates(value: StateValue, model: WorldModel): string[] {
  if (typeof value !== 'string' || value.length < 3) return [];
  const candidates = new Set<string>([value]);

  const name = model.nameOf(value);
  if (name !== null) candidates.add(name);

  const withoutPrefix = value.replace(/^(char|loc|obj|rel|ck|scene)_/, '');
  if (withoutPrefix.length >= 3) {
    candidates.add(withoutPrefix.replace(/_/g, ' '));
  }

  return [...candidates].filter((candidate) => candidate.length >= 3);
}

/**
 * Tokenize a phrase for prose matching: lowercase words, with a naive trailing-`s` stem so a
 * beat that reads "comes to resent him" matches a `sentiment` of `resents`.
 *
 * Deliberately shallow. Both sides go through the same transform, so it never matters that the
 * stem is not a real one — only that the two agree.
 */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token));
}

/** Whether `needle`'s tokens appear as a contiguous run inside `haystack`'s. */
function containsPhrase(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * Whether the card asks for a value: it appears in an `entry_state`/`exit_state` assertion, or
 * one of its readable forms appears in a `required_beat` or an `invariant`.
 *
 * This is the "appears nowhere in `entry_state`, `exit_state`, or `required_beats`" test ADR
 * 0005 §2 states for `unentailed_reversion`, and the same test §3 uses to resolve a volitional
 * proposal. Beats and invariants are free text, so matching them is necessarily a heuristic —
 * a phrase match over the readable forms above. Tightening it belongs with the writer prompt
 * contract (issue #16), which is where the writer gains a way to name the beat it satisfied.
 */
function isEntailedByCard(value: StateValue, scene: SceneCard, model: WorldModel): boolean {
  if (allAssertedValues(scene).some((asserted) => asserted === value)) return true;

  const candidates = textCandidates(value, model).map(tokens).filter((t) => t.length > 0);
  if (candidates.length === 0) return false;

  const prose = [...scene.required_beats, ...scene.invariants].map(tokens);
  return candidates.some((candidate) =>
    prose.some((line) => containsPhrase(line, candidate)),
  );
}

// --- Checkpoint 1: pre-generation entry check ----------------------------------------------

/**
 * ADR 0005 §1's pre-generation entry check.
 *
 * Every column the card asserts in `entry_state` is compared against the World Model's actual
 * value, on P/E columns only. The ADR frames the check over `characters_present`; the assertion
 * set is used instead because it is a superset — both fixtures assert object state on entry too,
 * and an assertion about an entity the card forgot to list is exactly as wrong.
 */
export function checkEntryState(scene: SceneCard, model: WorldModel): EntryCheckResult {
  const diagnostics: Diagnostic[] = [];

  const mismatch = (entityId: string, column: string | null, message: string) => {
    diagnostics.push(
      diagnostic('entry_state_mismatch', {
        entity_id: entityId,
        column,
        scene_id: scene.id,
        scene_index: scene.order,
        message,
      }),
    );
  };

  for (const [entityId, columns] of entityAssertions(scene.entry_state)) {
    const table = model.tableOf(entityId);
    if (table === null) {
      mismatch(entityId, null, `entry_state names "${entityId}", which is not in the World Model`);
      continue;
    }

    for (const [column, asserted] of Object.entries(columns)) {
      const authority = columnAuthority(table, column);
      if (!authority.known) {
        mismatch(entityId, column, `entry_state names "${column}", which is not a ${table} column`);
        continue;
      }
      // "on P/E columns only" — a volitional column may legitimately have diverged run to run
      // (ADR 0005 §4), and an untiered column is not the engine's to have changed.
      if (!isAutoCommittedTier(authority.tier)) continue;

      const actual = model.value(entityId, column) ?? null;
      if (actual !== asserted) {
        mismatch(
          entityId,
          column,
          `entry_state asserts ${entityId}.${column} = ${JSON.stringify(asserted)}, ` +
            `but the World Model holds ${JSON.stringify(actual)}`,
        );
      }
    }
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

// --- Checkpoint 2: post-generation state-update validation ---------------------------------

interface VerdictDraft {
  outcome: UpdateOutcome;
  status: StateLogStatus | null;
  diagnostic: Diagnostic | null;
}

export interface ValidateOptions {
  readonly scene: SceneCard;
  readonly model: WorldModel;
  readonly updates: StateUpdate[];
  /** Author-time queues volitional proposals; read-time resolves them (ADR 0016 §3). */
  readonly occasion: Occasion;
}

export function validateStateUpdates(options: ValidateOptions): ValidationResult {
  const { scene, model, updates, occasion } = options;
  const footprint = sceneFootprint(scene);
  const verdicts: UpdateVerdict[] = [];

  for (const update of updates) {
    const entityId = updateTargetId(update);
    const column = updateColumn(update);
    const value = updateValue(update);
    const authority = columnAuthority(update.table, column);

    const reject = (
      code: 'unauthorized_entity_update' | 'exit_state_contradiction' | 'unentailed_reversion' | 'untiered_column_update',
      message: string,
    ): VerdictDraft => ({
      outcome: 'rejected',
      status: null,
      diagnostic: diagnostic(code, {
        entity_id: entityId,
        column,
        scene_id: scene.id,
        scene_index: scene.order,
        message,
      }),
    });

    const draft = ((): VerdictDraft => {
      // (a) Does the engine have any authority over this column at all?
      if (!authority.known) {
        return reject(
          'untiered_column_update',
          `"${column}" is not a ${update.table} column`,
        );
      }
      if (authority.tier === null) {
        return reject(
          'untiered_column_update',
          `${update.table}.${column} carries no tier and is never engine-writable (ADR 0001)`,
        );
      }
      if (update.kind === 'row' && model.has(update.row.id)) {
        return reject(
          'untiered_column_update',
          `row "${update.row.id}" already exists; a row insert may not restate a committed row identity`,
        );
      }
      if (update.kind === 'column' && !model.has(entityId)) {
        return reject(
          'unauthorized_entity_update',
          `"${entityId}" is not a row in the World Model`,
        );
      }

      // (b) Did the scene give the engine a reason to touch this entity?
      if (!isInFootprint(update, footprint, model)) {
        return reject(
          'unauthorized_entity_update',
          `${entityId} is outside the scene's footprint (characters present, its location, and ` +
            `the entities entry_state/exit_state name)`,
        );
      }

      // (c) Volitional columns are never auto-committed unless the card baked the outcome in.
      if (authority.tier === 'V') {
        return resolveVolitional(update, entityId, column, value as StateValue, scene, model, occasion);
      }

      // (d) Physical and epistemic: accept, extend, or reject.
      return resolveAutoCommitted(update, entityId, column, value, scene, model);
    })();

    const previous =
      update.kind === 'row' ? null : ((model.value(entityId, column) ?? null) as StateValue);

    verdicts.push({
      update,
      table: update.table,
      entity_id: entityId,
      column,
      tier: authority.tier,
      outcome: draft.outcome,
      diagnostic: draft.diagnostic,
      entry:
        draft.status === null
          ? null
          : {
              scene_index: scene.order,
              scene_id: scene.id,
              entity_id: entityId,
              table: update.table,
              column,
              tier: authority.tier,
              previous_value: previous,
              new_value: value as StateValue,
              status: draft.status,
            },
    });
  }

  const diagnostics = verdicts
    .map((verdict) => verdict.diagnostic)
    .filter((entry): entry is Diagnostic => entry !== null);
  const entries = verdicts
    .map((verdict) => verdict.entry)
    .filter((entry): entry is NewStateLogEntry => entry !== null);

  return { scene, occasion, verdicts, diagnostics, entries };
}

// --- Prose grounding (ADR 0018) -------------------------------------------------------------

export interface GroundedClaimMismatch {
  readonly entity_id: string;
  readonly column: string;
  readonly asserted_value: StateValue;
  readonly committed_value: StateValue;
}

/**
 * ADR 0018 decision 2: the amnesia guard's own test — §2's `unentailed_reversion` — run a second
 * time, over `grounded_claims` instead of `state_updates`. Must run *before* this scene's own
 * `state_updates` are committed (`model` is read as of scene entry), the same snapshot
 * `unentailed_reversion` itself reads inside `validateStateUpdates`.
 *
 * Unlike `state_updates`, a claim is never committed and there is nothing to accept or reject —
 * it is a read-out of what the prose already asserts, not a proposed write — so this returns
 * mismatches for the caller to route into the continuity pass's repair machinery (ADR 0011 §5)
 * instead of a `Diagnostic` directly: the World Model was never wrong, only the prose disagrees
 * with it, and "what happened about it" is exactly what `continuity_seam_repaired`/
 * `continuity_repair_rejected` already exist to record (`diagnostics.ts`).
 */
export function checkGroundedClaims(
  scene: SceneCard,
  digest: Pick<SceneDigest, 'grounded_claims'>,
  model: WorldModel,
): GroundedClaimMismatch[] {
  const mismatches: GroundedClaimMismatch[] = [];

  for (const claim of digest.grounded_claims) {
    const table = model.tableOf(claim.entity_id);
    if (table === null) continue; // extraction named an entity the World Model doesn't have

    const authority = columnAuthority(table, claim.column);
    // Physical/epistemic claims only (ADR 0018 decision 1's own scope) — an unknown column or a
    // volitional one may legitimately have diverged run to run (ADR 0005 §4) or not exist at all;
    // either way it is an extraction-quality question, not this checkpoint's to flag.
    if (!authority.known || !isAutoCommittedTier(authority.tier)) continue;

    const current = (model.value(claim.entity_id, claim.column) ?? null) as StateValue;
    // Only a change *away from* a committed value can be a reversion — the same carve-out
    // `resolveAutoCommitted`'s amnesia guard makes below for a column that was null.
    if (current === null) continue;
    if (current === claim.asserted_value) continue;
    if (isEntailedByCard(claim.asserted_value, scene, model)) continue;

    mismatches.push({
      entity_id: claim.entity_id,
      column: claim.column,
      asserted_value: claim.asserted_value,
      committed_value: current,
    });
  }

  return mismatches;
}

function resolveAutoCommitted(
  update: StateUpdate,
  entityId: string,
  column: string,
  value: StateValue | WorldModelRow,
  scene: SceneCard,
  model: WorldModel,
): VerdictDraft {
  // A row insert has no prior value to contradict or revert; the scene's footprint check has
  // already established the engine had a reason to create it.
  if (update.kind === 'row' || column === ROW_COLUMN) {
    return { outcome: 'extension', status: 'committed', diagnostic: null };
  }

  const current = (model.value(entityId, column) ?? null) as StateValue;
  const exit = assertedValue(scene.exit_state, entityId, column);

  if (exit.asserted) {
    if (exit.value === value) {
      // The walk-to-the-park case: exactly what exit_state required.
      return current === value
        ? { outcome: 'unchanged', status: null, diagnostic: null }
        : { outcome: 'satisfies_invariant', status: 'committed', diagnostic: null };
    }
    return {
      outcome: 'rejected',
      status: null,
      diagnostic: diagnostic('exit_state_contradiction', {
        entity_id: entityId,
        column,
        scene_id: scene.id,
        scene_index: scene.order,
        message:
          `exit_state requires ${entityId}.${column} = ${JSON.stringify(exit.value)}, ` +
          `but the engine proposed ${JSON.stringify(value)}`,
      }),
    };
  }

  if (current === value) {
    return { outcome: 'unchanged', status: null, diagnostic: null };
  }

  // The amnesia guard. Only a change *away from* a committed value can be a reversion — filling
  // a column that was null is an extension, not a forgetting.
  if (current !== null && !isEntailedByCard(value as StateValue, scene, model)) {
    return {
      outcome: 'rejected',
      status: null,
      diagnostic: diagnostic('unentailed_reversion', {
        entity_id: entityId,
        column,
        scene_id: scene.id,
        scene_index: scene.order,
        message:
          `${entityId}.${column} is committed as ${JSON.stringify(current)}; the engine proposed ` +
          `${JSON.stringify(value)}, which appears in no entry_state, exit_state, or required beat`,
      }),
    };
  }

  // Ordinary texture — Jim now also happens to be carrying an umbrella. Note how narrow this
  // is: an extension either fills a column the World Model left unset or creates a new row.
  // Overwriting a committed value is caught above, which is exactly what ADR 0005's own
  // extension example is — the umbrella arrives as a new `possesses` row, not as a change to
  // a column that already held something.
  return { outcome: 'extension', status: 'committed', diagnostic: null };
}

/**
 * ADR 0005 §3 (read-time) and ADR 0016 §3 (author-time).
 *
 * A volitional column named in `exit_state` is not a proposal at all — the card baked the
 * outcome in, which "moves it out of proposal territory entirely" — so it runs the same
 * accept/contradict test as a P/E update. Everything else is a proposal.
 */
function resolveVolitional(
  update: StateUpdate,
  entityId: string,
  column: string,
  value: StateValue,
  scene: SceneCard,
  model: WorldModel,
  occasion: Occasion,
): VerdictDraft {
  const exit = assertedValue(scene.exit_state, entityId, column);
  const current = (model.value(entityId, column) ?? null) as StateValue;

  if (exit.asserted) {
    if (exit.value === value) {
      return current === value
        ? { outcome: 'unchanged', status: null, diagnostic: null }
        : { outcome: 'satisfies_invariant', status: 'committed', diagnostic: null };
    }
    return {
      outcome: 'rejected',
      status: null,
      diagnostic: diagnostic('exit_state_contradiction', {
        entity_id: entityId,
        column,
        scene_id: scene.id,
        scene_index: scene.order,
        message:
          `exit_state requires ${entityId}.${column} = ${JSON.stringify(exit.value)}, ` +
          `but the engine proposed ${JSON.stringify(value)}`,
      }),
    };
  }

  if (current === value) {
    return { outcome: 'unchanged', status: null, diagnostic: null };
  }

  if (occasion === 'author_time') {
    // Never auto-applied, never auto-dropped: it sits in the queue until the author decides,
    // and leaving it pending does not block compiling the next scene.
    return {
      outcome: 'proposal_pending',
      status: 'proposed',
      diagnostic: diagnostic('pending_proposal', {
        entity_id: entityId,
        column,
        scene_id: scene.id,
        scene_index: scene.order,
        message:
          `volitional proposal ${entityId}.${column} = ${JSON.stringify(value)} awaits the author`,
      }),
    };
  }

  // Read-time: apply, or don't. Violation is tested first — "applies ... if nothing in those
  // invariants is violated by it" — so a card that holds the current value in place wins.
  const holdsCurrent = current !== null && isEntailedByCard(current, scene, model);
  if (holdsCurrent) {
    return {
      outcome: 'proposal_dropped',
      status: 'proposed_dropped',
      diagnostic: diagnostic('dropped_proposal', {
        entity_id: entityId,
        column,
        scene_id: scene.id,
        scene_index: scene.order,
        reason: 'contradicts_invariant',
        message:
          `the card holds ${entityId}.${column} at ${JSON.stringify(current)}; the proposal ` +
          `${JSON.stringify(value)} would contradict it`,
      }),
    };
  }

  if (isEntailedByCard(value, scene, model)) {
    return {
      outcome: 'proposal_applied',
      status: 'proposed_applied',
      diagnostic: diagnostic('accepted_proposal', {
        entity_id: entityId,
        column,
        scene_id: scene.id,
        scene_index: scene.order,
        message: `volitional proposal ${entityId}.${column} = ${JSON.stringify(value)} applied`,
      }),
    };
  }

  // Silence defaults to inaction, never invention.
  return {
    outcome: 'proposal_dropped',
    status: 'proposed_dropped',
    diagnostic: diagnostic('dropped_proposal', {
      entity_id: entityId,
      column,
      scene_id: scene.id,
      scene_index: scene.order,
      reason: 'no_signal',
      message:
        `the card gives no signal either way on ${entityId}.${column}; the proposal ` +
        `${JSON.stringify(value)} was dropped and the prior value kept`,
    }),
  };
}

// --- Committing -----------------------------------------------------------------------------

/**
 * Append a validation result to the commit log and apply the entries that change state.
 *
 * `proposed` entries are recorded but not applied — they are the proposals queue, waiting on
 * the author. `proposed_dropped` entries are recorded and not applied: the ledger keeps what was
 * decided, and the World Model keeps its prior value.
 */
export function commitValidated(
  model: WorldModel,
  log: StateLog,
  result: ValidationResult,
): void {
  for (const entry of log.appendAll(result.entries)) {
    if (entry.status !== 'committed' && entry.status !== 'proposed_applied') continue;

    if (entry.column === ROW_COLUMN) {
      model.insertRow(
        entry.table as 'relationship' | 'character_knowledge',
        entry.new_value as WorldModelRow,
      );
      continue;
    }
    model.setColumn(entry.entity_id, entry.column, entry.new_value as StateValue);
  }
}
