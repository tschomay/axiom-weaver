/**
 * Pass 3b — merge the duplicate rows reconcile deliberately left apart.
 *
 * ## Why this pass exists at all
 *
 * `pass-reconcile.ts` rule 1 is "when in doubt, keep separate", and that is a considered trade, not
 * an oversight: §2.2 of `docs/research/narrative-extraction-prior-art.md` records that welding two
 * distinct people into one cluster is unrecoverable once it happens, because ADR 0001 makes an
 * entity's slug its identity and every downstream Scene Card, `pays_off` edge and told-ledger entry
 * inherits the mistake. Splitting is merely untidy; welding is a re-authoring.
 *
 * The trade worked, and it left the other failure standing. On *A Christmas Carol* the roster
 * carries `char_scrooge`, `char_ebenezer_scrooge`, `char_mr_scrooge`, `char_master_scrooge`,
 * `char_young_scrooge` and `char_scrooge_s_younger_self` for one man, and `char_marley`,
 * `char_jacob_marley` and `char_marley_s_ghost` for another. #118 measured the consequence
 * downstream: POV agreement on that fixture is a flat **0.00**, because the fixture's
 * `char_scrooge` aligns to whichever of the six the boundary pass happened to name.
 *
 * ## The guard, which is what makes merging safe enough to attempt
 *
 * Reconcile is conservative by *doubt*. This pass is conservative by *evidence*:
 *
 * > **Two rows that appear together in the same event are never the same entity.**
 *
 * A story cannot put a person in a scene with themselves. That is a hard constraint, it needs no
 * model, and it is exactly the discrimination a name-similarity heuristic cannot make. Measured on
 * the *Carol*'s own roster, it blocks five of the six look-alike pairs that must not merge —
 * `char_fezziwig` / `char_mrs_fezziwig` (they dance in the same scene), `char_belle` /
 * `char_belles_husband`, `char_fred` / `char_freds_wife`, `char_scrooge` /
 * `char_scrooge_s_nephew`, `char_bob_cratchit` / `char_belinda_cratchit` — while blocking none of
 * the eight true duplicates above.
 *
 * It is a *necessary* condition and not a sufficient one, and the sixth pair says why:
 * `char_old_joe` and `char_joe_miller` never share an event, because Joe Miller is a joke book
 * mentioned in passing rather than a person. Co-occurrence cannot see that; a model reading the
 * names and notes can. So the guard proposes, and the model disposes — never the other way round.
 *
 * ## Why it runs after the event pass rather than before
 *
 * The guard is defined over events, so there have to be events. Merging afterwards means rewriting
 * the ids the events already carry, which `applyMerges` does deterministically. The alternative —
 * merging on window co-occurrence before events exist — trades the story's own evidence for the
 * pipeline's chunking, and a window boundary is an artifact of `target_words`, not of the story.
 */

import { z } from 'zod';

import type { ExtractionModel } from './call';
import { ExtractionCallError } from './call';
import type { CanonicalEntity } from './pass-reconcile';
import type { ExtractedEvent } from './pass-events';

export const MergeProposalSchema = z.object({
  keep: z.string().min(1),
  absorb: z.array(z.string()).default([]),
  why: z.string().default(''),
});

export const CanonicalizeResponseSchema = z.object({
  merges: z.array(MergeProposalSchema).default([]),
});

export interface AppliedMerge {
  readonly kept: string;
  readonly absorbed: readonly string[];
  readonly why: string;
}

export interface CanonicalizeResult {
  readonly entities: CanonicalEntity[];
  readonly events: ExtractedEvent[];
  /**
   * absorbed id → surviving id, for every other place in the pipeline that carries an entity id.
   *
   * Events are rewritten here because this pass owns them. The World Model seed's relationships are
   * not: they are assembled later from `reconcile`'s output, and leaving them un-redirected is a
   * bug G0 caught immediately — a merged-away `loc_counting_house` left `rel_025.to_id` pointing at
   * a row that no longer existed, which made the whole package unpublishable and every score below
   * the level the rubric grades. Anything holding an id must be mapped through this.
   */
  readonly redirect: ReadonlyMap<string, string>;
  readonly applied: AppliedMerge[];
  /** Merges the model asked for that the co-occurrence guard refused. Output, not a log line. */
  readonly blocked: ReadonlyArray<{ keep: string; absorb: string; reason: string }>;
  readonly candidate_pairs: number;
  readonly failed: boolean;
}

/**
 * Pairs of ids that share an event, and therefore can never be one entity.
 *
 * Read off `participants` only. `location_id` and `state_updates` are deliberately excluded: an
 * event can move an object to a location and say nothing about whether the two denote one thing,
 * whereas two characters on stage together are unambiguously two.
 */
export function coOccurring(events: readonly ExtractedEvent[]): Set<string> {
  const pairs = new Set<string>();
  for (const event of events) {
    const present = [...new Set(event.participants)].sort();
    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) {
        pairs.add(`${present[i]}|${present[j]}`);
      }
    }
  }
  return pairs;
}

export function sharesEvent(pairs: ReadonlySet<string>, a: string, b: string): boolean {
  const [x, y] = [a, b].sort();
  return pairs.has(`${x}|${y}`);
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'old', 'young', 'little', 'mr', 'mrs', 'miss', 'master',
  'his', 'her', 'their', 'former', 'self', 's',
]);

function contentWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word)),
  );
}

/**
 * Which pairs are worth asking about: same kind, share a content word, and never share an event.
 *
 * Sharing a content word is a cheap recall filter, not the decision — it is what lets "Marley" and
 * "Jacob Marley" reach the model while keeping the prompt to a size that fits. It is also the one
 * place this pass can under-reach: "Scrooge" and "the old sinner" share no word and would never be
 * offered. That is the same limit `isSuspiciousMerge` already documents, and it errs toward leaving
 * rows apart, which is the recoverable direction.
 */
export function mergeCandidates(
  entities: readonly CanonicalEntity[],
  pairs: ReadonlySet<string>,
): Array<{ a: CanonicalEntity; b: CanonicalEntity }> {
  const out: Array<{ a: CanonicalEntity; b: CanonicalEntity }> = [];
  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const a = entities[i]!;
      const b = entities[j]!;
      if (a.kind !== b.kind) continue;
      if (sharesEvent(pairs, a.id, b.id)) continue;
      const wordsA = contentWords(`${a.name} ${a.aliases.join(' ')}`);
      const wordsB = contentWords(`${b.name} ${b.aliases.join(' ')}`);
      let shared = false;
      for (const word of wordsA) {
        if (wordsB.has(word)) {
          shared = true;
          break;
        }
      }
      if (shared) out.push({ a, b });
    }
  }
  return out;
}

const SYSTEM = `You are given groups of entity rows extracted from ONE story. Rows in a group have
similar names and never appear together in the same event, so each group MIGHT be several rows for
one entity — or might not.

For each set of rows that denote THE SAME entity, output one merge: the id to keep, and the ids it
absorbs.

Rules:
1. Merge only rows you are confident denote the same person, place or thing in this story. A story
   calling one man "Marley", "Jacob Marley" and "Marley's Ghost" is one entity. So is a man called
   "Scrooge", "Ebenezer Scrooge" and "Mr. Scrooge".
2. A person at a different age is still that person: "young Scrooge" and "Scrooge" are one entity.
3. DO NOT merge relatives, spouses, servants or namesakes. "Fezziwig" and "Mrs. Fezziwig" are two
   people. So are "Belle" and "Belle's husband".
4. DO NOT merge a person with a thing that shares their name. "Old Joe" is a man; "Joe Miller" is a
   joke book.
5. DO NOT merge a singular with a group: "Cratchit" and "the Cratchit children" are different rows.
6. keep = the clearest, fullest name's id. absorb = every other id in that set.
7. A row you are not confident about simply does not appear in your answer. Leaving two rows apart
   is a small cost; welding two people together cannot be undone.`;

function jsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      merges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            keep: { type: 'string', description: 'The id to keep.' },
            absorb: { type: 'array', items: { type: 'string' }, description: 'Ids it absorbs.' },
            why: { type: 'string', description: 'One clause naming the evidence.' },
          },
          required: ['keep', 'absorb', 'why'],
          propertyOrdering: ['keep', 'absorb', 'why'],
        },
      },
    },
    required: ['merges'],
  };
}

/** Rewrite every id an absorbed row owns, across the roster and the events that name it. */
export function applyMerges(
  entities: readonly CanonicalEntity[],
  events: readonly ExtractedEvent[],
  merges: readonly AppliedMerge[],
): { entities: CanonicalEntity[]; events: ExtractedEvent[] } {
  const redirect = new Map<string, string>();
  for (const merge of merges) {
    for (const absorbed of merge.absorbed) redirect.set(absorbed, merge.kept);
  }
  const resolve = (id: string): string => redirect.get(id) ?? id;

  const kept: CanonicalEntity[] = [];
  for (const entity of entities) {
    if (redirect.has(entity.id)) continue;
    const absorbedNames = merges
      .filter((merge) => merge.kept === entity.id)
      .flatMap((merge) =>
        merge.absorbed.map((id) => entities.find((row) => row.id === id)?.name ?? id),
      );
    kept.push(
      absorbedNames.length === 0
        ? entity
        : {
            ...entity,
            aliases: [...new Set([...entity.aliases, ...absorbedNames])],
            merged_from: [...new Set([...entity.merged_from, ...absorbedNames])],
          },
    );
  }

  const rewritten = events.map((event) => ({
    ...event,
    participants: [...new Set(event.participants.map(resolve))],
    location_id: event.location_id === null ? null : resolve(event.location_id),
    state_updates: event.state_updates.map((update) => ({
      ...update,
      entity_id: resolve(update.entity_id),
      value:
        update.column === 'location_id' && typeof update.value === 'string'
          ? resolve(update.value)
          : update.value,
    })),
  }));

  return { entities: kept, events: rewritten };
}

export async function canonicalize(
  model: ExtractionModel,
  entities: readonly CanonicalEntity[],
  events: readonly ExtractedEvent[],
): Promise<CanonicalizeResult> {
  const pairs = coOccurring(events);
  const candidates = mergeCandidates(entities, pairs);
  if (candidates.length === 0) {
    return {
      entities: [...entities],
      events: [...events],
      redirect: new Map(),
      applied: [],
      blocked: [],
      candidate_pairs: 0,
      failed: false,
    };
  }

  // Only the rows actually in a candidate pair reach the prompt; the rest cannot merge with
  // anything and would only be noise.
  const involved = new Map<string, CanonicalEntity>();
  for (const { a, b } of candidates) {
    involved.set(a.id, a);
    involved.set(b.id, b);
  }
  const listing = [...involved.values()]
    .map(
      (entity) =>
        `${entity.id} [${entity.kind}] = ${entity.name}` +
        `${entity.aliases.length > 0 ? ` (also: ${entity.aliases.join(', ')})` : ''}` +
        `${entity.note === '' ? '' : ` — ${entity.note}`}`,
    )
    .join('\n');

  let proposed: z.infer<typeof MergeProposalSchema>[];
  try {
    const response = await model.json(CanonicalizeResponseSchema, {
      pass: 'canonicalize',
      label: `${involved.size} rows in ${candidates.length} candidate pairs`,
      systemInstruction: SYSTEM,
      contents: `ROWS THAT MIGHT BE DUPLICATES:\n${listing}`,
      responseJsonSchema: jsonSchema(),
      maxOutputTokens: 4096,
      thinkingLevel: 'LOW',
    });
    proposed = response.merges;
  } catch (error) {
    if (!(error instanceof ExtractionCallError)) throw error;
    // A failed canonicalize costs the merges, not the run: the roster reconcile produced is still
    // valid, just as split as it was before.
    return {
      entities: [...entities],
      events: [...events],
      redirect: new Map(),
      applied: [],
      blocked: [],
      candidate_pairs: candidates.length,
      failed: true,
    };
  }

  const known = new Set(entities.map((entity) => entity.id));
  const kindOf = new Map(entities.map((entity) => [entity.id, entity.kind]));
  const claimed = new Set<string>();
  const applied: AppliedMerge[] = [];
  const blocked: Array<{ keep: string; absorb: string; reason: string }> = [];

  for (const merge of proposed) {
    if (!known.has(merge.keep) || claimed.has(merge.keep)) continue;
    const absorbed: string[] = [];
    for (const id of merge.absorb) {
      if (id === merge.keep || !known.has(id) || claimed.has(id)) continue;
      // The guard has the last word, always — the model is not permitted to overrule it.
      if (sharesEvent(pairs, merge.keep, id)) {
        blocked.push({ keep: merge.keep, absorb: id, reason: 'share an event' });
        continue;
      }
      if (kindOf.get(id) !== kindOf.get(merge.keep)) {
        blocked.push({ keep: merge.keep, absorb: id, reason: 'different entity table' });
        continue;
      }
      absorbed.push(id);
      claimed.add(id);
    }
    if (absorbed.length === 0) continue;
    claimed.add(merge.keep);
    applied.push({ kept: merge.keep, absorbed, why: merge.why });
  }

  const result = applyMerges(entities, events, applied);
  const redirect = new Map<string, string>();
  for (const merge of applied) {
    for (const absorbed of merge.absorbed) redirect.set(absorbed, merge.kept);
  }
  return {
    entities: result.entities,
    events: result.events,
    redirect,
    applied,
    blocked,
    candidate_pairs: candidates.length,
    failed: false,
  };
}

/**
 * Map a relationship's ends through a merge, dropping any edge that collapses onto itself.
 *
 * An edge from a row to itself says nothing — "Scrooge knows Scrooge" is what "Scrooge" and
 * "Mr. Scrooge" becoming one row turns their acquaintance into — so it is dropped rather than
 * emitted as a self-loop the linter would have to reason about.
 */
export function redirectRelationships<T extends { from_id: string; to_id: string }>(
  relationships: readonly T[],
  redirect: ReadonlyMap<string, string>,
): T[] {
  if (redirect.size === 0) return [...relationships];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const edge of relationships) {
    const from = redirect.get(edge.from_id) ?? edge.from_id;
    const to = redirect.get(edge.to_id) ?? edge.to_id;
    if (from === to) continue;
    const key = `${from}|${to}|${(edge as unknown as { kind?: string }).kind ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...edge, from_id: from, to_id: to });
  }
  return out;
}
