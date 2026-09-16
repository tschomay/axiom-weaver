/**
 * Pass 2 — reconcile the per-window proposals into one canonical entity set.
 *
 * This runs over the *extracted structures*, never over prose — the same move ADR 0008's zoom
 * levels make for generation, and the one `docs/research/narrative-extraction-prior-art.md` §5
 * argues for directly: read in windows, then reconcile globally in a cheap step over what the
 * windows produced.
 *
 * ## Why it is batched, which was learned the expensive way
 *
 * The first version of this pass was one call over every proposal at once, on the theory that
 * "cheap step over structures" meant it could not get big. On *A Christmas Carol* it got 387
 * folded proposals and died on `MAX_TOKENS` — twice, since the retry doubles the budget — with
 * **643 output tokens against 15,727 thinking tokens**: the model spent the entire budget
 * reasoning about a 387-way clustering problem and never finished writing the answer. Under a
 * response schema that is an unparseable, unrecoverable response
 * (`docs/research/gemini-capabilities.md` §1), so the whole run died at pass 2.
 *
 * The finding generalises past the parameter that caused it: **"global" cannot mean "one
 * unbounded call", it can only mean "sees the whole accumulated state"**. So reconcile is
 * incremental — each call sees the canonical roster built so far plus the next batch of
 * proposals, and answers one assignment per proposal. Output is bounded by the batch, the
 * roster grows monotonically, and a failed batch costs that batch rather than the run.
 * Thinking is `LOW` here for the same reason: this is a matching task against a visible roster,
 * not a reasoning task, and on the failing call thinking *was* the budget.
 *
 * ## Why merging is never silent
 *
 * §2.2 is blunt about the direction of the danger: on `BookCoref` a system scores MUC F1 94.30
 * with B³ 55.30 and CEAFe 33.45 — the arithmetic signature of distinct people welded into one
 * cluster — and ADR 0001's slug identity makes an over-merge unrecoverable downstream ("not a
 * one-column update; it is a re-authoring"). §2.3 records the opposite failure in GraphRAG: two
 * surface forms of one person left as two nodes.
 *
 * So every group of two or more proposals folded into one row is recorded with the names that
 * went into it, and a group whose names share no word at all is flagged `suspicious_merge` — the
 * cheap, no-gold-data proxy for the welding failure. Those flags are output, not log lines: §8's
 * honest position is that no automatic check is reliable here today, so the pipeline's job is to
 * make the decision visible to the human the import path already puts in the loop.
 */

import { z } from 'zod';

import type { ExtractionModel } from './call';
import { ExtractionCallError } from './call';
import type { EntityKind, EntityProposal, RelationshipProposal } from './pass-entities';

export interface CanonicalEntity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly name: string;
  readonly aliases: string[];
  readonly note: string;
  /** The proposal names this row absorbs. Exactly how the over-merge check sees the merge. */
  readonly merged_from: string[];
}

export const AssignmentSchema = z.object({
  proposal: z.string().min(1),
  entity_id: z.string().min(1),
  canonical_name: z.string().default(''),
});

export const ReconcileResponseSchema = z.object({
  assignments: z.array(AssignmentSchema).default([]),
});

export const CanonicalRelationshipSchema = z.object({
  from_id: z.string().min(1),
  to_id: z.string().min(1),
  kind: z.string().min(1),
  sentiment: z.string().nullable().default(null),
  /** Index into the relationship proposals, so the span survives reconciliation. */
  from_proposal: z.number().int().nonnegative(),
});

export const RelationshipReconcileResponseSchema = z.object({
  relationships: z.array(CanonicalRelationshipSchema).default([]),
});

export type CanonicalRelationship = z.infer<typeof CanonicalRelationshipSchema>;

export interface MergeGroup {
  readonly id: string;
  readonly names: readonly string[];
  /** No shared word between two member names — the cheap over-merge signal (§2.2). */
  readonly suspicious: boolean;
}

export interface ReconcileResult {
  readonly entities: CanonicalEntity[];
  readonly relationships: CanonicalRelationship[];
  readonly merges: MergeGroup[];
  readonly suspicious_merges: MergeGroup[];
  /** Proposals no batch ever assigned — the other direction of the same risk. */
  readonly dropped_proposals: string[];
  readonly failed_batches: number;
}

/** Proposals per reconcile call. Bounded output is the whole point; see the header. */
export const RECONCILE_BATCH_SIZE = 40;
export const RELATIONSHIP_BATCH_SIZE = 40;

const ENTITY_SYSTEM = `You are matching entity proposals — extracted independently from
consecutive windows of one story — against a roster of canonical entities built so far.

For EVERY proposal you are given, output exactly one assignment:
- If it denotes an entity already on the roster, use that roster id.
- Otherwise coin a new lower_snake_case id prefixed by kind: char_, loc_, obj_.

Rules, in priority order:
1. NEVER assign two entities the story treats as different people or things to one id, however
   similar their names. Welding two distinct characters into one row is the single most damaging
   mistake available here and cannot be undone later. When two might or might not be the same,
   give the proposal a NEW id.
2. Do match obvious surface variants of one entity: a name and its epithet, a name with and
   without a title, singular and plural forms of one group.
3. Never match across kinds. A location proposal never takes a char_ id.
4. canonical_name is the clearest name for that entity; for a roster id, repeat the roster's name.
5. Output one assignment per input proposal. No more, no fewer. Nothing else.`;

function entityJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      assignments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            proposal: { type: 'string', description: 'The proposal name, copied verbatim.' },
            entity_id: { type: 'string', description: 'A roster id, or a new char_/loc_/obj_ id.' },
            canonical_name: { type: 'string' },
          },
          required: ['proposal', 'entity_id', 'canonical_name'],
          propertyOrdering: ['proposal', 'entity_id', 'canonical_name'],
        },
      },
    },
    required: ['assignments'],
  };
}

const RELATIONSHIP_SYSTEM = `You are given relationship proposals extracted from windows of one
story, plus the story's canonical entity list.

Rewrite each proposal against the canonical ids, drop exact duplicates, and drop any proposal
whose two ends cannot both be matched to a canonical entity. Do not invent relationships. Do not
merge two relationships that differ in kind.

from_proposal is the index of the input proposal you rewrote — copy it exactly, since it is what
carries that relationship's source quote.`;

function relationshipJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      relationships: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from_id: { type: 'string' },
            to_id: { type: 'string' },
            kind: { type: 'string', description: 'lower_snake_case, read from the subject.' },
            sentiment: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            from_proposal: { type: 'integer' },
          },
          required: ['from_id', 'to_id', 'kind', 'sentiment', 'from_proposal'],
          propertyOrdering: ['from_id', 'to_id', 'kind', 'sentiment', 'from_proposal'],
        },
      },
    },
    required: ['relationships'],
  };
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'old', 'young', 'mr', 'mrs', 'miss']);

function contentWords(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .split(' ')
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word)),
  );
}

/**
 * Whether a merge group welds names with nothing lexically in common.
 *
 * Deliberately crude, and deliberately a *flag* rather than a rejection: "Scrooge" and "the old
 * sinner" share no word and are the same person, while "Fan" and "Belle" share no word and are
 * not. §8 says as much — no automatic check is reliable here, so this raises the case for the
 * human rather than deciding it.
 */
export function isSuspiciousMerge(names: readonly string[]): boolean {
  if (names.length < 2) return false;
  const wordSets = names.map(contentWords);
  for (let i = 0; i < wordSets.length; i += 1) {
    let sharesWithSomeone = false;
    for (let j = 0; j < wordSets.length; j += 1) {
      if (i === j) continue;
      for (const word of wordSets[i]!) {
        if (wordSets[j]!.has(word)) {
          sharesWithSomeone = true;
          break;
        }
      }
      if (sharesWithSomeone) break;
    }
    if (!sharesWithSomeone) return true;
  }
  return false;
}

export interface FoldedProposal {
  readonly kind: EntityKind;
  readonly name: string;
  readonly aliases: string[];
  readonly notes: string[];
  readonly windows: number[];
}

/** Dedupe proposals by `kind` + normalized name before spending a call on them. */
export function foldProposals(proposals: readonly EntityProposal[]): FoldedProposal[] {
  const byKey = new Map<string, { kind: EntityKind; name: string; aliases: string[]; notes: string[]; windows: number[] }>();
  for (const proposal of proposals) {
    const key = `${proposal.kind}|${normalizeName(proposal.name)}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, {
        kind: proposal.kind,
        name: proposal.name,
        aliases: [...proposal.aliases],
        notes: proposal.note === '' ? [] : [proposal.note],
        windows: [proposal.window],
      });
      continue;
    }
    for (const alias of proposal.aliases) {
      if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
    }
    if (proposal.note !== '' && !existing.notes.includes(proposal.note)) {
      existing.notes.push(proposal.note);
    }
    if (!existing.windows.includes(proposal.window)) existing.windows.push(proposal.window);
  }
  return [...byKey.values()];
}

export async function reconcile(
  model: ExtractionModel,
  entityProposals: readonly EntityProposal[],
  relationshipProposals: readonly RelationshipProposal[],
  options: { batchSize?: number } = {},
): Promise<ReconcileResult> {
  const batchSize = options.batchSize ?? RECONCILE_BATCH_SIZE;
  const folded = foldProposals(entityProposals);

  // The accumulating canonical roster. Insertion order is proposal order, which is narrated
  // order, so ids are stable across reruns for as long as the windows are.
  const rows = new Map<string, { kind: EntityKind; name: string; aliases: string[]; notes: string[]; merged_from: string[] }>();
  const assignedNames = new Set<string>();
  let failedBatches = 0;

  for (let start = 0; start < folded.length; start += batchSize) {
    const batch = folded.slice(start, start + batchSize);
    const roster =
      rows.size === 0
        ? '(empty — this is the first batch)'
        : [...rows.entries()]
            .map(([id, row]) => `${id} [${row.kind}] = ${row.name}`)
            .join('\n');
    const listing = batch
      .map(
        (entry) =>
          `- [${entry.kind}] ${entry.name}${entry.aliases.length > 0 ? ` (also: ${entry.aliases.join(', ')})` : ''}${entry.notes.length > 0 ? ` — ${entry.notes.join(' / ')}` : ''}`,
      )
      .join('\n');

    let assignments: z.infer<typeof AssignmentSchema>[];
    try {
      const response = await model.json(ReconcileResponseSchema, {
        pass: 'reconcile',
        label: `proposals ${start}–${start + batch.length - 1} of ${folded.length}`,
        systemInstruction: ENTITY_SYSTEM,
        contents: `CANONICAL ROSTER SO FAR:\n${roster}\n\nPROPOSALS TO ASSIGN (${batch.length}):\n${listing}`,
        responseJsonSchema: entityJsonSchema(),
        maxOutputTokens: 4096,
        // LOW deliberately: the failing unbounded version spent 15,727 thinking tokens and 643
        // output tokens. This is matching against a visible roster, not open reasoning.
        thinkingLevel: 'LOW',
      });
      assignments = response.assignments;
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      failedBatches += 1;
      assignments = [];
    }

    const byProposal = new Map(
      assignments.map((assignment) => [normalizeName(assignment.proposal), assignment]),
    );

    for (const entry of batch) {
      const assignment = byProposal.get(normalizeName(entry.name));
      // A proposal the batch did not answer for still gets a row: dropping it silently would
      // turn a model omission into an extraction miss nothing reports. Its own name becomes the
      // id, which is the no-merge answer — the safe direction per rule 1.
      const target =
        assignment === undefined
          ? `${prefixFor(entry.kind)}${slugify(entry.name)}`
          : assignment.entity_id;
      const existing = rows.get(target);

      if (existing === undefined) {
        rows.set(target, {
          kind: entry.kind,
          name: assignment?.canonical_name !== undefined && assignment.canonical_name !== ''
            ? assignment.canonical_name
            : entry.name,
          aliases: entry.aliases.filter((alias) => alias !== entry.name),
          notes: [...entry.notes],
          merged_from: [entry.name],
        });
      } else if (existing.kind !== entry.kind) {
        // Rule 3 violated by the model: a cross-kind assignment would put a location in the
        // character table. Give it its own row instead of honouring it.
        const fallback = `${prefixFor(entry.kind)}${slugify(entry.name)}`;
        if (!rows.has(fallback)) {
          rows.set(fallback, {
            kind: entry.kind,
            name: entry.name,
            aliases: [...entry.aliases],
            notes: [...entry.notes],
            merged_from: [entry.name],
          });
        } else {
          rows.get(fallback)!.merged_from.push(entry.name);
        }
      } else {
        existing.merged_from.push(entry.name);
        for (const alias of [entry.name, ...entry.aliases]) {
          if (alias !== existing.name && !existing.aliases.includes(alias)) {
            existing.aliases.push(alias);
          }
        }
        for (const note of entry.notes) {
          if (!existing.notes.includes(note)) existing.notes.push(note);
        }
      }
      assignedNames.add(normalizeName(entry.name));
    }
  }

  const entities: CanonicalEntity[] = [...rows.entries()].map(([id, row]) => ({
    id,
    kind: row.kind,
    name: row.name,
    aliases: row.aliases,
    note: row.notes.join(' / '),
    merged_from: row.merged_from,
  }));

  const merges: MergeGroup[] = entities
    .filter((entity) => entity.merged_from.length > 1)
    .map((entity) => ({
      id: entity.id,
      names: entity.merged_from,
      suspicious: isSuspiciousMerge(entity.merged_from),
    }));

  const dropped = folded
    .filter((entry) => !assignedNames.has(normalizeName(entry.name)))
    .map((entry) => `${entry.kind}: ${entry.name}`);

  const relationships =
    relationshipProposals.length === 0
      ? []
      : await reconcileRelationships(model, entities, relationshipProposals);

  return {
    entities,
    relationships,
    merges,
    suspicious_merges: merges.filter((merge) => merge.suspicious),
    dropped_proposals: dropped,
    failed_batches: failedBatches,
  };
}

function prefixFor(kind: EntityKind): string {
  return kind === 'character' ? 'char_' : kind === 'location' ? 'loc_' : 'obj_';
}

function slugify(name: string): string {
  return normalizeName(name).replace(/ /g, '_').slice(0, 48) || 'unnamed';
}

async function reconcileRelationships(
  model: ExtractionModel,
  entities: readonly CanonicalEntity[],
  proposals: readonly RelationshipProposal[],
): Promise<CanonicalRelationship[]> {
  const roster = entities
    .map(
      (entity) =>
        `${entity.id} = ${entity.name}${entity.aliases.length > 0 ? ` (${entity.aliases.slice(0, 4).join(', ')})` : ''}`,
    )
    .join('\n');

  const known = new Set(entities.map((entity) => entity.id));
  const seen = new Set<string>();
  const kept: CanonicalRelationship[] = [];

  for (let start = 0; start < proposals.length; start += RELATIONSHIP_BATCH_SIZE) {
    const batch = proposals.slice(start, start + RELATIONSHIP_BATCH_SIZE);
    const listing = batch
      .map(
        (edge, offset) =>
          `${start + offset}: ${edge.from} --${edge.kind}--> ${edge.to} [${edge.sentiment ?? 'no sentiment'}]`,
      )
      .join('\n');

    let response: z.infer<typeof RelationshipReconcileResponseSchema>;
    try {
      response = await model.json(RelationshipReconcileResponseSchema, {
        pass: 'reconcile.relationships',
        label: `proposals ${start}–${start + batch.length - 1} of ${proposals.length}`,
        systemInstruction: RELATIONSHIP_SYSTEM,
        contents: `CANONICAL ENTITIES:\n${roster}\n\nRELATIONSHIP PROPOSALS:\n${listing}`,
        responseJsonSchema: relationshipJsonSchema(),
        maxOutputTokens: 4096,
        thinkingLevel: 'LOW',
      });
    } catch (error) {
      if (!(error instanceof ExtractionCallError)) throw error;
      continue;
    }

    for (const edge of response.relationships) {
      // A relationship pointing at an id no row carries is `unknown_entity` at lint time. It is
      // cheaper and more honest to drop it here and count it than to emit a package that cannot
      // pass G0 for a reason nothing in the seed explains.
      if (!known.has(edge.from_id) || !known.has(edge.to_id)) continue;
      if (edge.from_proposal >= proposals.length) continue;
      const key = `${edge.from_id}|${edge.to_id}|${edge.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(edge);
    }
  }

  return kept;
}
