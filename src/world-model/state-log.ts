/**
 * The state-update commit log (ADR 0016 §2).
 *
 * An append-only ledger of every committed World Model change and every resolved volitional
 * proposal, per scene. It is not a new authority — ADR 0005 still decides what is accepted or
 * dropped; this only *keeps* what ADR 0005 decided, instead of keeping only the final value.
 *
 * "World Model as of scene N" is the seed replayed forward through every `committed` /
 * `proposed_applied` entry with `scene_index <= N`. That reconstruction is what ADR 0016's
 * World & Discourse inspector scrubber reads from.
 *
 * The log is also the proposals queue's backing store: a proposal is a log entry not yet
 * resolved — status `proposed`.
 */

import { z } from 'zod';
import { ROW_COLUMN, TABLE_NAMES, type Tier } from '../schema/tiers';
import {
  CharacterKnowledgeSchema,
  RelationshipSchema,
  StateValueSchema,
} from '../schema/story-package';
import { WorldModel } from './world-model';
import type { WorldModelRow } from './world-model';

export const STATE_LOG_STATUSES = [
  /** An auto-accepted P/E update (ADR 0005 §2). */
  'committed',
  /** A volitional proposal awaiting the author's decision (ADR 0016 §3). */
  'proposed',
  /** A volitional proposal resolved as applied. */
  'proposed_applied',
  /** A volitional proposal resolved as dropped — the World Model keeps its prior value. */
  'proposed_dropped',
] as const;

export type StateLogStatus = (typeof STATE_LOG_STATUSES)[number];

const LoggedValueSchema = z.union([
  StateValueSchema,
  RelationshipSchema,
  CharacterKnowledgeSchema,
]);

export const StateLogEntrySchema = z.object({
  /**
   * The Scene Card's `order`. ADR 0016 names this `scene_index`; it is the value the "as of
   * scene N" replay compares against.
   */
  scene_index: z.number().int().nonnegative(),
  /** The Scene Card the entry came from, kept so a log line can be traced back to its card. */
  scene_id: z.string().min(1).nullable().default(null),
  entity_id: z.string().min(1),
  /** The table holding `entity_id` — replay needs it, ids alone do not name a table. */
  table: z.enum(TABLE_NAMES),
  /** A column name, or `_row` for a row insert whose subject is the row's own existence. */
  column: z.string().min(1),
  tier: z.enum(['P', 'E', 'V']).nullable(),
  previous_value: LoggedValueSchema.nullable(),
  new_value: LoggedValueSchema.nullable(),
  status: z.enum(STATE_LOG_STATUSES),
  /** Sequence within a scene, so entries touching one column stay ordered on replay. */
  sequence: z.number().int().nonnegative().default(0),
  recorded_at: z.string().optional(),
});

export const StateLogSchema = z.object({
  schema_version: z.string().default('1.0'),
  story_id: z.string().min(1),
  /** Present on an edition's log; absent on the Working Draft's. */
  run_id: z.string().min(1).nullable().default(null),
  entries: z.array(StateLogEntrySchema).default([]),
});

export type StateLogEntry = z.infer<typeof StateLogEntrySchema>;
export type StateLogDocument = z.infer<typeof StateLogSchema>;

export type NewStateLogEntry = Omit<StateLogEntry, 'sequence' | 'recorded_at' | 'scene_id'> & {
  scene_id?: string | null;
};

/** Statuses that change the World Model when the log is replayed forward. */
export function isAppliedStatus(status: StateLogStatus): boolean {
  return status === 'committed' || status === 'proposed_applied';
}

/**
 * An append-only state-update commit log.
 *
 * Persisted at `story/{storyId}/draft/state-log.json` (Working Draft) or
 * `edition/{runId}/state-log.json` (Compiled edition, immutable once the run completes) —
 * ADR 0015 §4's convention, ADR 0016 §2's shape.
 */
export class StateLog {
  readonly storyId: string;
  readonly runId: string | null;
  private readonly entries: StateLogEntry[];
  private nextSequence: number;

  constructor(storyId: string, runId: string | null = null, entries: StateLogEntry[] = []) {
    this.storyId = storyId;
    this.runId = runId;
    this.entries = [...entries];
    this.nextSequence = this.entries.reduce((max, e) => Math.max(max, e.sequence + 1), 0);
  }

  static fromJSON(document: unknown): StateLog {
    const parsed = StateLogSchema.parse(document);
    return new StateLog(parsed.story_id, parsed.run_id, parsed.entries);
  }

  toJSON(): StateLogDocument {
    return {
      schema_version: '1.0',
      story_id: this.storyId,
      run_id: this.runId,
      entries: this.all(),
    };
  }

  /** Append one entry. Returns the stored entry, including its assigned sequence. */
  append(entry: NewStateLogEntry, now: () => Date = () => new Date()): StateLogEntry {
    const stored: StateLogEntry = {
      ...entry,
      scene_id: entry.scene_id ?? null,
      sequence: this.nextSequence++,
      recorded_at: now().toISOString(),
    };
    this.entries.push(stored);
    return stored;
  }

  appendAll(entries: NewStateLogEntry[], now?: () => Date): StateLogEntry[] {
    return entries.map((entry) => this.append(entry, now));
  }

  /** Every entry, in append order. */
  all(): StateLogEntry[] {
    return [...this.entries];
  }

  get length(): number {
    return this.entries.length;
  }

  /** Entries recorded for one scene. */
  forScene(sceneIndex: number): StateLogEntry[] {
    return this.entries.filter((entry) => entry.scene_index === sceneIndex);
  }

  /**
   * The proposals queue: volitional proposals recorded but not yet resolved.
   *
   * ADR 0016 §3 — at author-time a proposal is never auto-applied or auto-dropped; it sits here
   * until the author accepts or rejects it, and leaving it pending does not block compiling the
   * next scene.
   */
  pendingProposals(): StateLogEntry[] {
    return this.entries.filter((entry) => entry.status === 'proposed');
  }

  /**
   * Resolve a pending proposal. Accepting rewrites its status to `proposed_applied`, rejecting
   * to `proposed_dropped` — the entry is not deleted, so the ledger keeps what was decided.
   *
   * This is the one in-place status transition the ledger allows; it is what "a proposal is a
   * log entry not yet resolved" means. Nothing else about a recorded entry ever changes.
   */
  resolveProposal(sequence: number, decision: 'accept' | 'reject'): StateLogEntry {
    const entry = this.entries.find((candidate) => candidate.sequence === sequence);
    if (entry === undefined) {
      throw new Error(`No state-log entry with sequence ${sequence}`);
    }
    if (entry.status !== 'proposed') {
      throw new Error(
        `State-log entry ${sequence} is ${entry.status}, not a pending proposal`,
      );
    }
    entry.status = decision === 'accept' ? 'proposed_applied' : 'proposed_dropped';
    return entry;
  }

  /** The highest `scene_index` the log has recorded anything for. */
  lastSceneIndex(): number {
    return this.entries.reduce((max, entry) => Math.max(max, entry.scene_index), 0);
  }
}

/** Replay order: by scene, then by the sequence in which entries were appended. */
export function replayOrder(entries: StateLogEntry[]): StateLogEntry[] {
  return [...entries].sort(
    (a, b) => a.scene_index - b.scene_index || a.sequence - b.sequence,
  );
}

/**
 * Reconstruct "World Model as of scene N" — the seed replayed forward through every
 * `committed` / `proposed_applied` entry with `scene_index <= sceneIndex` (ADR 0016 §2).
 *
 * Pass `Infinity` for the current state; pass `0` for the seed itself.
 */
export function worldModelAsOf(seed: WorldModel, log: StateLog, sceneIndex: number): WorldModel {
  const model = seed.copy();

  for (const entry of replayOrder(log.all())) {
    if (entry.scene_index > sceneIndex) break;
    if (!isAppliedStatus(entry.status)) continue;

    if (entry.column === ROW_COLUMN) {
      if (entry.new_value === null) {
        model.deleteRow(entry.entity_id);
      } else {
        model.insertRow(
          entry.table as 'relationship' | 'character_knowledge',
          entry.new_value as WorldModelRow,
        );
      }
      continue;
    }

    model.setColumn(
      entry.entity_id,
      entry.column,
      entry.new_value as Exclude<StateLogEntry['new_value'], WorldModelRow>,
    );
  }

  return model;
}

/** The tier of a logged entry, for callers reading a log without re-deriving it. */
export function entryTier(entry: StateLogEntry): Tier | null {
  return entry.tier;
}
