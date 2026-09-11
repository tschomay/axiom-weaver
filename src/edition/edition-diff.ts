/**
 * Diffing two Compiled editions (ADR 0015 §6).
 *
 * This is the one surface where the product's proposition stops being a claim. Everything else in
 * the compiler *produces* variance; this is where an author can see exactly what the engine chose
 * to vary between two tellings of the same invariants — ADR 0015 §6 calls it "a direct
 * instantiation of the variance contract (ADR 0006)".
 *
 * Three rules the ADR fixes, and each one rules something out:
 *
 * 1. **Matched `package_version` only.** A cross-version comparison answers a different question —
 *    what an author's *edit* did — and that one belongs to the Working Draft and its staleness
 *    (ADR 0015 §§1-3). Conflating them would put authored change and generation variance in the
 *    same column and make neither legible.
 * 2. **Scene Digest fields are the primary surface**, not prose. The digests are the abstraction
 *    the whole compiler already reasons over, and they are what makes "the same events, told
 *    differently" a checkable statement rather than an impression.
 * 3. **Never a line-level text diff of prose.** Two performances of one Scene Card share almost no
 *    words; a text diff would be red everywhere and say nothing. Both editions' prose is offered
 *    side by side to *read*, which is the only useful way to compare them.
 *
 * The field list is deliberately not the staleness list. `imagery_signature` and `event_summary`
 * are excluded from staleness precisely because they carry no downstream dependency (ADR 0015 §3)
 * — which is exactly what makes them the most interesting fields here: they are where variance
 * shows without anything else having to change.
 */

import type { SceneDigest } from '../digest/scene-digest';
import type { StateLogEntry } from '../world-model/state-log';
import type { StoryRepository } from '../persistence/story-repository';
import type { EditionManifest, EditionScene } from './edition';

/** The digest fields ADR 0015 §6 names as the comparison surface. */
export const DIFF_FIELDS = [
  'event_summary',
  'facts_revealed',
  'entities_on_stage',
  'closing_situation',
  'imagery_signature',
] as const;

export type DiffField = (typeof DIFF_FIELDS)[number];

export interface FieldComparison {
  readonly field: DiffField;
  /** Present in B and not in A. Empty for the two free-text fields. */
  readonly added: string[];
  /** Present in A and not in B. Empty for the two free-text fields. */
  readonly removed: string[];
  /** The two values, for a field that is prose rather than a set. */
  readonly a: string | null;
  readonly b: string | null;
}

export interface SceneComparison {
  readonly scene_id: string;
  readonly scene_index: number;
  readonly fields: FieldComparison[];
  /** Both performances, for reading side by side — never diffed line by line. */
  readonly prose: { a: string | null; b: string | null };
  /** True when every compared field matched: the engine varied only the words. */
  readonly identical: boolean;
}

/**
 * A volitional column the two runs resolved differently.
 *
 * ADR 0005 §4 grants exactly this freedom — "two runs can never diverge into a state either
 * author-declared invariant forbids" — and ADR 0005 §5 says the `info`/`warn` proposal log lines
 * exist so a diff can show "which proposals landed in which run". This is that surface; before it
 * existed, nothing read those lines.
 */
export interface ProposalDivergence {
  readonly entity_id: string;
  readonly column: string;
  readonly scene_index: number;
  readonly a: { status: string; value: string | null } | null;
  readonly b: { status: string; value: string | null } | null;
}

export interface EditionDiff {
  readonly story_id: string;
  readonly package_version: number;
  readonly a: DiffSide;
  readonly b: DiffSide;
  readonly scenes: SceneComparison[];
  readonly proposals: ProposalDivergence[];
  /** How many scenes differed on at least one compared field. */
  readonly scenes_varied: number;
}

export interface DiffSide {
  readonly run_id: string;
  readonly started_at: string;
  readonly degraded: boolean;
}

/** Why a pair cannot be compared. Refusing is the answer, not a best-effort comparison. */
export class EditionDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditionDiffError';
  }
}

export async function diffEditions(
  repository: StoryRepository,
  runIdA: string,
  runIdB: string,
): Promise<EditionDiff> {
  if (runIdA === runIdB) {
    throw new EditionDiffError('a telling cannot be set beside itself');
  }

  const [a, b] = await Promise.all([
    repository.getEditionManifest(runIdA),
    repository.getEditionManifest(runIdB),
  ]);
  if (a === null) throw new EditionDiffError(`No telling with run id "${runIdA}"`);
  if (b === null) throw new EditionDiffError(`No telling with run id "${runIdB}"`);

  if (a.story_id !== b.story_id) {
    throw new EditionDiffError(
      `"${runIdA}" is a telling of ${a.story_id} and "${runIdB}" of ${b.story_id} — two stories have no shared invariants to vary against`,
    );
  }
  // ADR 0015 §6: matched pair only. The cross-version question belongs to the Working Draft.
  if (a.package_version !== b.package_version) {
    throw new EditionDiffError(
      `"${runIdA}" pins package_version ${a.package_version} and "${runIdB}" pins ${b.package_version} — a cross-version comparison is what an author's edit did, which the Working Draft's staleness answers`,
    );
  }

  const [scenesA, scenesB, logA, logB] = await Promise.all([
    repository.getEditionScenes(runIdA),
    repository.getEditionScenes(runIdB),
    repository.getEditionStateLog(runIdA),
    repository.getEditionStateLog(runIdB),
  ]);

  const scenes = compareScenes(scenesA, scenesB);

  return {
    story_id: a.story_id,
    package_version: a.package_version,
    a: sideOf(a),
    b: sideOf(b),
    scenes,
    proposals: compareProposals(logA?.all() ?? [], logB?.all() ?? []),
    scenes_varied: scenes.filter((scene) => !scene.identical).length,
  };
}

function sideOf(manifest: EditionManifest): DiffSide {
  return {
    run_id: manifest.run_id,
    started_at: manifest.started_at,
    degraded: manifest.degraded,
  };
}

/**
 * Line the two editions up by `scene_index`, which is the Scene Card's own `order`.
 *
 * Matching on the card, not on position in the list: a run that failed partway has fewer scene
 * documents, and comparing its scene 3 against the other's scene 4 would invent variance that is
 * really just a missing scene. A scene only one side has is reported with the other side `null`.
 */
export function compareScenes(
  a: readonly EditionScene[],
  b: readonly EditionScene[],
): SceneComparison[] {
  const byIndexA = new Map(a.map((scene) => [scene.scene_index, scene]));
  const byIndexB = new Map(b.map((scene) => [scene.scene_index, scene]));
  const indexes = [...new Set([...byIndexA.keys(), ...byIndexB.keys()])].sort(
    (left, right) => left - right,
  );

  return indexes.map((index) => {
    const sceneA = byIndexA.get(index) ?? null;
    const sceneB = byIndexB.get(index) ?? null;
    const fields =
      sceneA === null || sceneB === null
        ? []
        : compareDigests(sceneA.digest, sceneB.digest).filter(
            (field) => field.added.length > 0 || field.removed.length > 0 || field.a !== field.b,
          );

    return {
      scene_id: sceneA?.scene_id ?? sceneB?.scene_id ?? `scene ${index}`,
      scene_index: index,
      fields,
      prose: { a: sceneA?.prose ?? null, b: sceneB?.prose ?? null },
      identical: sceneA !== null && sceneB !== null && fields.length === 0,
    };
  });
}

/** Field-by-field over ADR 0015 §6's list. Sets are compared as sets; prose as two values. */
export function compareDigests(a: SceneDigest, b: SceneDigest): FieldComparison[] {
  return DIFF_FIELDS.map((field) => {
    if (field === 'event_summary' || field === 'closing_situation') {
      return { field, added: [], removed: [], a: a[field], b: b[field] };
    }
    const left = valuesOf(a, field);
    const right = valuesOf(b, field);
    return {
      field,
      added: right.filter((value) => !left.includes(value)),
      removed: left.filter((value) => !right.includes(value)),
      a: null,
      b: null,
    };
  });
}

function valuesOf(digest: SceneDigest, field: DiffField): string[] {
  if (field === 'imagery_signature') {
    // Rendered with its domain, because the domain is the thing that is *supposed* to recur
    // (ADR 0010 §4) — a reader of this diff wants to see the same domain with different wording,
    // which is the design working, and telling that apart from a domain that changed.
    return digest.imagery_signature.map((entry) => `${entry.domain ?? 'ad hoc'}: ${entry.image}`);
  }
  if (field === 'facts_revealed') return [...digest.facts_revealed];
  return [...digest.entities_on_stage];
}

/**
 * Where the two runs resolved a volitional proposal differently (ADR 0005 §4/§5).
 *
 * Only V-tier entries are compared. Physical and epistemic columns are deterministic across runs
 * by construction — every accepted P/E update is either required by `exit_state` or a
 * non-narrative extension (ADR 0005 §2) — so a difference there would be a bug to fix, not
 * variance to show, and putting it in this view would teach an author to expect it.
 */
export function compareProposals(
  a: readonly StateLogEntry[],
  b: readonly StateLogEntry[],
): ProposalDivergence[] {
  const key = (entry: StateLogEntry) =>
    `${entry.scene_index} ${entry.entity_id} ${entry.column}`;
  const volitional = (entries: readonly StateLogEntry[]) =>
    new Map(entries.filter((entry) => entry.tier === 'V').map((entry) => [key(entry), entry]));

  const left = volitional(a);
  const right = volitional(b);
  const divergences: ProposalDivergence[] = [];

  for (const id of [...new Set([...left.keys(), ...right.keys()])]) {
    const entryA = left.get(id) ?? null;
    const entryB = right.get(id) ?? null;
    const sameStatus = entryA?.status === entryB?.status;
    const sameValue = String(entryA?.new_value ?? '') === String(entryB?.new_value ?? '');
    if (entryA !== null && entryB !== null && sameStatus && sameValue) continue;

    const sample = entryA ?? entryB!;
    divergences.push({
      entity_id: sample.entity_id,
      column: sample.column,
      scene_index: sample.scene_index,
      a: entryA === null ? null : { status: entryA.status, value: asText(entryA.new_value) },
      b: entryB === null ? null : { status: entryB.status, value: asText(entryB.new_value) },
    });
  }

  return divergences.sort((left, right) => left.scene_index - right.scene_index);
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}
