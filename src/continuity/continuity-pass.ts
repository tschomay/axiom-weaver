/**
 * The continuity pass over digests (ADR 0011).
 *
 * It reads the abstraction — the just-finished scene's digest against the immediately preceding
 * scene's digest and the told-ledger state at that scene's entry — decides a seam is broken, and
 * only then pulls the specific passage it needs to repair. Working on abstractions rather than
 * prose is what lets it scale to novel length.
 *
 * Three modes, not four (ADR 0011 §1). Dropped setup is excluded outright: the plant-obligation
 * walk (ADR 0004) owns it, and routing it through here too would be a duplicate, weaker check on
 * data that walk already owns.
 *
 * Every mode here is checkable *because* two earlier ADRs added a digest field for it: ADR 0009
 * §8's `reanchor_used` and ADR 0010 §2's domain tag on `imagery_signature`. Detection is exact
 * comparison over those fields — no fuzzy matching and no extra model call to decide whether a
 * seam exists. A model is only ever called to *repair* one.
 */

import type { SceneCard } from '../schema/story-package';
import type { SceneDigest, ImagerySignature, ReanchorBand } from '../digest/scene-digest';
import { ImagerySignatureSchema, ReanchorUsedSchema } from '../digest/scene-digest';
import type { GroundedClaimMismatch } from '../validator/state-update-authority';
import { ToldLedger, metFact } from '../digest/told-ledger';
import { bandMismatches, type BandDecision } from '../assembler/reanchoring';
import type { RecordedImagery } from '../voice/imagery-ledger';
import type { WriterStateUpdates } from '../writer/response-schema';
import { diagnostic, type Diagnostic } from '../validator/diagnostics';
import { FALLBACK_MODEL, type ModelClient } from '../writer/model-client';
import type { CallRecord } from '../writer/compile-scene';
import type { Occasion } from '../validator/state-update-authority';
import { z } from 'zod';

export const CONTINUITY_MODES = [
  /** A continuous thread restarted from cold — the hard reset (ADR 0002's rubric mode). */
  'cold_open',
  /** The scene pitched what the reader knows at the wrong level: over- or under-telling. */
  'told_ledger_miscalibration',
  /** A palette domain reused with the same phrasing rather than a new vehicle (ADR 0010). */
  'stale_imagery',
] as const;

export type ContinuityMode = (typeof CONTINUITY_MODES)[number];

/**
 * A finding's mode. `ContinuityMode` is what `detectSeams` itself produces — ADR 0011 §1's three,
 * unchanged. `prose_grounding_mismatch` never comes from `detectSeams`: it is constructed from the
 * state-update validator's `grounded_claims` check (ADR 0018) and folded in by `continuityPass`
 * alongside this pass's own findings. Reusing this pass's repair machinery is a second *caller* of
 * it, not a claim that the continuity pass now owns a fourth mode — ownership of *deciding*
 * something is wrong stays wherever ADR 0002 put it.
 */
export type FindingMode = ContinuityMode | 'prose_grounding_mismatch';

/** `CONTINUITY_MODES` plus the one finding shape this pass repairs but does not itself detect. */
export const FINDING_MODES = [...CONTINUITY_MODES, 'prose_grounding_mismatch'] as const;

export interface SeamFinding {
  readonly mode: FindingMode;
  readonly scene_id: string;
  readonly scene_index: number;
  /**
   * What the finding is about: an entity id, a `fact_ref`, the recycled phrase itself, or — for
   * `prose_grounding_mismatch` — `"<entity_id>.<column>"`, since more than one claim can name the
   * same entity and a repair must know which one it resolved.
   */
  readonly subject: string;
  readonly detail: string;
}

export interface PreviousScene {
  readonly scene_id: string;
  readonly digest: SceneDigest;
}

export interface SeamCheckInput {
  readonly scene: SceneCard;
  readonly digest: SceneDigest;
  /** The immediately preceding scene, or `null` for the first scene of a telling. */
  readonly previous: PreviousScene | null;
  /** Told-ledger state at *entry* to this scene — before its own digest was applied. */
  readonly ledgerAtEntry: ToldLedger;
  /** The bands the re-anchoring policy decided for this scene (ADR 0009). */
  readonly expectedBands: readonly BandDecision[];
  /** Imagery recorded by *earlier* scenes only; this scene's own signature is in `digest`. */
  readonly imageryHistory: readonly RecordedImagery[];
}

/** The coldest two bands: both mean "place this for a reader who does not have it". */
const FIRST_PLACEMENT_BANDS = new Set(['introduce', 'reintroduce']);

/**
 * Detect broken seams. Pure, digest-only, no model call.
 *
 * The three checks partition cleanly by what they read: `cold_open` compares against the previous
 * scene's digest (ADR 0011 §2's adjacent pair), `told_ledger_miscalibration` against the
 * told-ledger, and `stale_imagery` against recorded imagery history.
 */
export function detectSeams(input: SeamCheckInput): SeamFinding[] {
  const findings: SeamFinding[] = [];
  const { scene, digest } = input;
  const at = { scene_id: scene.id, scene_index: scene.order };

  // --- Cold opens / hard resets -----------------------------------------------------------
  //
  // An entity the reader was with one scene ago, re-placed as though they were new. This is the
  // digest-visible signature of a scene that restarts instead of continuing, and it is why
  // ADR 0009 §8 put `reanchor_used` in the digest at all.
  const carriedOver = new Set(input.previous?.digest.entities_on_stage ?? []);
  const coldOpened = new Set<string>();
  for (const used of digest.reanchor_used) {
    if (!carriedOver.has(used.entity_id)) continue;
    if (!FIRST_PLACEMENT_BANDS.has(used.band)) continue;
    coldOpened.add(used.entity_id);
    findings.push({
      ...at,
      mode: 'cold_open',
      subject: used.entity_id,
      detail:
        `${scene.id} places "${used.entity_id}" with band "${used.band}", but the reader was ` +
        `with them in "${input.previous?.scene_id}" one scene earlier — the thread is continuous ` +
        `and the scene opens as if it were not`,
    });
  }

  // --- Told-ledger miscalibration ---------------------------------------------------------
  //
  // Two directions, both a mismatch between what the reader has been told and how the scene
  // pitched it. Entities already reported as cold opens are excluded so one broken seam produces
  // one finding.
  const reported = digest.reanchor_used.filter((used) => !coldOpened.has(used.entity_id));
  const miscalibrated = new Set<string>();
  for (const mismatch of bandMismatches(input.expectedBands, reported)) {
    miscalibrated.add(mismatch.entity_id);
    findings.push({
      ...at,
      mode: 'told_ledger_miscalibration',
      subject: mismatch.entity_id,
      detail:
        `${scene.id} used band "${mismatch.used}" for "${mismatch.entity_id}" where the ` +
        `told-ledger implies "${mismatch.expected}"` +
        (FIRST_PLACEMENT_BANDS.has(mismatch.used)
          ? ' — the reader is being told again what they already hold'
          : ' — the scene assumes more than the reader has been given'),
    });
  }

  for (const fact of digest.facts_revealed) {
    const row = input.ledgerAtEntry.row(fact);
    if (row === null || row.first_learned_scene >= scene.order) continue;
    findings.push({
      ...at,
      mode: 'told_ledger_miscalibration',
      subject: fact,
      detail:
        `${scene.id} reveals "${fact}", which the reader first learned in scene ` +
        `${row.first_learned_scene} and was last shown in scene ${row.last_touched_scene}`,
    });
  }

  // An entity assumed known that the reader has never met at all: the told-ledger has no `met:`
  // row for them. The band comparison above only covers entities the policy ranked, so this
  // catches the case where the writer assumed someone the policy never saw coming.
  const neverMet = new Set<string>();
  for (const used of digest.reanchor_used) {
    if (used.band !== 'assume') continue;
    // One broken seam, one finding: an entity the band comparison already caught does not need
    // catching twice, and a second finding would spend a second repair call on the same opening.
    if (miscalibrated.has(used.entity_id)) continue;
    if (input.ledgerAtEntry.row(metFact(used.entity_id)) !== null) continue;
    neverMet.add(used.entity_id);
    findings.push({
      ...at,
      mode: 'told_ledger_miscalibration',
      subject: used.entity_id,
      detail:
        `${scene.id} assumes the reader knows "${used.entity_id}", but the told-ledger holds no ` +
        `"${metFact(used.entity_id)}" row — the reader has never met them`,
    });
  }

  // ADR 0018 decision 3: `bandMismatches` (above) catches a self-report that disagrees with what
  // the *policy* expected; it reads no prose, so a self-report that disagrees with what was
  // actually *written* passes it untouched. `anchor_text`'s own cap (ADR 0018 decision 1) is short
  // enough that only a real re-establishing paragraph reliably needs truncating — so a light band
  // (`assume`/`reanchor`) reported alongside a capped `anchor_text` is inconsistent on its face,
  // independent of what the told-ledger expected. A heuristic on internal consistency, not
  // independent proof `anchor_text` matches the prose word-for-word (ADR 0018 decision 3).
  const LIGHT_BANDS = new Set<ReanchorBand>(['assume', 'reanchor']);
  for (const used of digest.reanchor_used) {
    if (coldOpened.has(used.entity_id) || miscalibrated.has(used.entity_id)) continue;
    if (neverMet.has(used.entity_id)) continue;
    if (!LIGHT_BANDS.has(used.band)) continue;
    if (used.anchor_text === null || !used.anchor_text.endsWith('…')) continue;
    findings.push({
      ...at,
      mode: 'told_ledger_miscalibration',
      subject: used.entity_id,
      detail:
        `${scene.id} claims band "${used.band}" for "${used.entity_id}", but its own anchor_text ` +
        `("${used.anchor_text}") needed truncating to fit a light re-anchor's cap — what was ` +
        `actually written reads as a heavier band than the one reported`,
    });
  }

  // --- Stale imagery ----------------------------------------------------------------------
  //
  // ADR 0010 §3: domain-tag equality, then exact phrasing equality inside the domain. Recurrence
  // inside a domain is a licensed motif; reusing the same wording is not.
  const priorByDomain = new Map<string, Set<string>>();
  for (const entry of input.imageryHistory) {
    for (const signature of entry.signature) {
      if (signature.domain === null) continue;
      const seen = priorByDomain.get(signature.domain) ?? new Set<string>();
      seen.add(normalizeImage(signature.image));
      priorByDomain.set(signature.domain, seen);
    }
  }
  for (const signature of digest.imagery_signature) {
    if (signature.domain === null) continue;
    if (!priorByDomain.get(signature.domain)?.has(normalizeImage(signature.image))) continue;
    findings.push({
      ...at,
      mode: 'stale_imagery',
      subject: signature.image,
      detail:
        `${scene.id} draws on "${signature.domain}" with the same phrasing an earlier scene ` +
        `already used ("${signature.image}") — vary the vehicle, not the domain`,
    });
  }

  return findings;
}

function normalizeImage(image: string): string {
  return image.trim().toLowerCase();
}

// --- Edit authority ---------------------------------------------------------------------------

/**
 * The only digest fields a repair may touch (ADR 0011 §4).
 *
 * This is what turns "may edit seams, may not change events" from a prompt-level instruction into
 * something code can check. `event_summary` is not on this list: ADR 0011 §4 names the repairable
 * fields exhaustively ("may only change the affected scene's prose text and, correspondingly,
 * `closing_situation` / `imagery_signature` / `reanchor_used`"), so everything else is carried
 * over verbatim.
 */
export const REPAIRABLE_DIGEST_FIELDS = [
  'closing_situation',
  'imagery_signature',
  'reanchor_used',
  /** ADR 0018 decision 4: a `prose_grounding_mismatch` repair may correct the claim it resolved,
   *  otherwise it goes stale against the prose it was extracted from. */
  'grounded_claims',
] as const;

export interface RepairSubject {
  readonly digest: SceneDigest;
  readonly state_updates: WriterStateUpdates;
}

/**
 * Diff every non-repairable field byte-for-byte against its pre-repair value.
 *
 * Returns the rejection reason, or `null` when the repair stayed inside its authority. The same
 * accept/reject-by-field shape ADR 0005 already uses for state-update authority — and the reason
 * this is a function rather than a comment: at author-time the pass has full authority to inspect
 * and repair freely, so the guard has to hold against a caller that hands over a wholesale
 * regenerated response, not only against this module's own narrow repair calls.
 */
export function checkRepairAuthority(before: RepairSubject, after: RepairSubject): string | null {
  const repairable = new Set<string>(REPAIRABLE_DIGEST_FIELDS);
  for (const field of Object.keys(before.digest) as Array<keyof SceneDigest>) {
    if (repairable.has(field)) continue;
    if (stable(before.digest[field]) !== stable(after.digest[field])) {
      return `a repair may not change scene_digest.${field}`;
    }
  }
  if (stable(before.state_updates) !== stable(after.state_updates)) {
    return 'a repair may not change state_updates';
  }
  return null;
}

function stable(value: unknown): string {
  return JSON.stringify(value ?? null);
}

// --- The repair calls -------------------------------------------------------------------------

/**
 * Two repair-call shapes, per mode (ADR 0011 §5).
 *
 * Cold opens and told-ledger miscalibration rewrite only the opening beat/transition. Stale
 * imagery locates and swaps just the offending phrase. A single uniform "always regenerate the
 * opening paragraph" mechanism was considered and rejected in the ADR: stale imagery isn't
 * reliably confined to a scene's opening, so one shape would miss it.
 */
export type RepairShape = 'opening_rewrite' | 'imagery_swap';

/**
 * `prose_grounding_mismatch` reuses the `imagery_swap` shape (locate and swap just the offending
 * phrase) rather than `opening_rewrite`: like stale imagery, it names one specific span, not
 * necessarily the scene's opening (ADR 0018 decision 4).
 */
export function shapeFor(mode: FindingMode): RepairShape {
  return mode === 'stale_imagery' || mode === 'prose_grounding_mismatch'
    ? 'imagery_swap'
    : 'opening_rewrite';
}

/**
 * What a repair call may hand back.
 *
 * `closing_situation` is deliberately **not** here, though ADR 0011 §4 permits a repair to touch
 * it. §5 confines an opening rewrite to the opening beat and says it "never regenerates the scene
 * body" — so a rewrite of how a scene *picks up* cannot legitimately move where it *ends*, and
 * asking for the field only created a way to get it wrong. It did: the repair prompt shows the
 * model the **previous** scene's closing situation (that is the seam it is repairing against) and
 * never the scene's own, so the model dutifully echoed the previous one back and the field-level
 * authority check waved it through, because `closing_situation` was on the repairable list. A
 * whole scene's ending was overwritten with the one before it. The field is now carried over
 * verbatim, which is both correct and one less thing billed on every repair call.
 */
export const RepairResponseSchema = z.object({
  /** The replacement text: a new opening paragraph, or the phrase that replaces a stale image. */
  replacement: z.string().min(1),
  /** Imagery swap only: the exact phrase to replace, which must appear verbatim in the prose. */
  original_phrase: z.string().min(1).nullable().default(null),
  imagery_signature: z.array(ImagerySignatureSchema).nullable().default(null),
  reanchor_used: z.array(ReanchorUsedSchema).nullable().default(null),
});

export type RepairResponse = z.infer<typeof RepairResponseSchema>;

export function repairResponseJsonSchema(shape: RepairShape): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    replacement: {
      type: 'string',
      description:
        shape === 'opening_rewrite'
          ? 'The rewritten opening paragraph, in the same voice, carrying the same events.'
          : 'The replacement image — a new vehicle inside the same domain.',
    },
  };
  const required = ['replacement'];

  if (shape === 'imagery_swap') {
    properties['original_phrase'] = {
      type: 'string',
      description: 'The exact words to replace, copied verbatim from the prose.',
    };
    required.push('original_phrase');
  }

  return {
    type: 'object',
    properties,
    required,
    propertyOrdering: shape === 'imagery_swap' ? ['original_phrase', 'replacement'] : required,
  };
}

/**
 * The prompt for a targeted repair. Fed only what the repair needs — never the whole scene.
 *
 * `findings` is a group, not a single seam, because every `opening_rewrite` finding on a scene
 * targets the same words. Repairing them one at a time meant one model call each, each rewriting
 * what the last one produced while being handed a `detail` describing an opening that no longer
 * existed — so only the final rewrite survived, and the earlier seams were reported repaired
 * without being. One call, every seam stated, one replacement.
 */
export function repairPrompt(input: {
  findings: readonly SeamFinding[];
  fragment: string;
  previousClosing: string | null;
  toldLedgerLines: readonly string[];
}): string {
  const finding = input.findings[0]!;
  if (finding.mode === 'stale_imagery') {
    return [
      'You are repairing one recycled image in a finished scene. Change nothing else.',
      '',
      `The image "${finding.subject}" repeats phrasing an earlier scene already used.`,
      finding.detail,
      '',
      'Find those exact words in the passage below and give a different vehicle for the same',
      'domain — the domain is a licensed motif to keep, the wording is what has gone stale, so',
      'stay inside the domain and change how it is said.',
      '',
      'PASSAGE:',
      input.fragment,
      '',
      'Return the exact words to replace (copied verbatim from the passage) and their replacement.',
      'Do not restate events, do not add or remove anything the passage does not already say.',
    ].join('\n');
  }

  if (finding.mode === 'prose_grounding_mismatch') {
    return [
      'You are repairing one factual contradiction in a finished scene. Change nothing else.',
      '',
      finding.detail,
      '',
      'Find the clause in the passage below that makes this claim and rewrite just that clause',
      'so it agrees with the World Model instead — change only what is needed to stop the',
      'contradiction, keep the same sentence shape and voice wherever possible.',
      '',
      'PASSAGE:',
      input.fragment,
      '',
      'Return the exact words to replace (copied verbatim from the passage) and their replacement.',
      'Do not restate events, do not add or remove anything the passage does not already say.',
    ].join('\n');
  }

  const seams = input.findings.map((entry) => `  - ${entry.detail}`).join('\n');
  return [
    'You are repairing the opening of a finished scene. Rewrite only the opening paragraph.',
    'The events of the scene are settled and may not change — only how the scene picks up.',
    '',
    input.findings.length === 1 ? `SEAM: ${finding.detail}` : `SEAMS (all in this one opening):\n${seams}`,
    '',
    input.previousClosing === null
      ? 'This is the first scene of the telling; there is nothing before it.'
      : `THE PREVIOUS SCENE LEFT THINGS HERE: ${input.previousClosing}`,
    '',
    input.toldLedgerLines.length === 0
      ? 'THE READER HAS BEEN TOLD: nothing yet.'
      : `THE READER HAS BEEN TOLD:\n${input.toldLedgerLines.map((line) => `  - ${line}`).join('\n')}`,
    '',
    'CURRENT OPENING PARAGRAPH:',
    input.fragment,
    '',
    'Return a replacement for that paragraph in the same voice and the same tense, carrying the',
    'same events. Do not summarise the previous scene; continue from it.',
  ].join('\n');
}

// --- The pass ---------------------------------------------------------------------------------

export interface RepairOutcome {
  readonly finding: SeamFinding;
  readonly applied: boolean;
  /** Why the repair was discarded, or `null` when it was applied. */
  readonly rejection: string | null;
  readonly attempts: number;
}

export interface ContinuityPassResult {
  readonly prose: string;
  readonly digest: SceneDigest;
  readonly findings: readonly SeamFinding[];
  readonly repairs: readonly RepairOutcome[];
  readonly diagnostics: readonly Diagnostic[];
  readonly calls: readonly CallRecord[];
}

export interface ContinuityPassInput extends SeamCheckInput {
  readonly prose: string;
  readonly state_updates: WriterStateUpdates;
  readonly client: ModelClient;
  readonly occasion: Occasion;
  /**
   * ADR 0018: mismatches from the state-update validator's `checkGroundedClaims`, computed by the
   * caller against the World Model as it stood at scene entry (before this scene's own
   * `state_updates` commit) and folded in here so this pass's repair machinery is the one place
   * that spends a repair call — not a second, parallel one.
   */
  readonly groundedClaimMismatches?: readonly GroundedClaimMismatch[];
}

/** Turn validator-detected mismatches into findings this pass's repair machinery can process. */
function groundingFindings(
  mismatches: readonly GroundedClaimMismatch[],
  at: { scene_id: string; scene_index: number },
): SeamFinding[] {
  return mismatches.map((mismatch) => ({
    ...at,
    mode: 'prose_grounding_mismatch',
    subject: `${mismatch.entity_id}.${mismatch.column}`,
    detail:
      `${at.scene_id} asserts ${mismatch.entity_id}.${mismatch.column} = ` +
      `${JSON.stringify(mismatch.asserted_value)} in its prose, but the World Model holds ` +
      `${JSON.stringify(mismatch.committed_value)} — this appears in no entry_state, exit_state, ` +
      `or required beat`,
  }));
}

/**
 * ADR 0011 §2: author-time the pass has full authority and no retry limits; read-time it runs
 * once per scene, and §6 fixes one repair attempt per caught seam with no re-checking of its own
 * output — a repair's downstream effect is handled by marking later scenes stale (ADR 0015),
 * not by a bounded-iteration loop built here.
 *
 * "No retry limits" is expressed as: a *discarded* author-time repair may be attempted once more,
 * since a discard means the repair broke field authority rather than that the seam was
 * unrepairable. Read-time gets exactly one attempt either way.
 */
const ATTEMPTS_PER_SEAM: Record<Occasion, number> = { author_time: 2, read_time: 1 };

const REPAIR_MAX_OUTPUT_TOKENS = 1024;

/**
 * Run the pass over one scene, repairing what it catches.
 *
 * The repair target is the persisted edition, never a live reader (ADR 0011 §3): read-time
 * generation is batch, so a caught-and-repaired seam is fixed before the compiled edition is ever
 * shown to anyone. This function returns the repaired prose and digest for the caller to persist;
 * it never mutates anything itself.
 */
export async function continuityPass(input: ContinuityPassInput): Promise<ContinuityPassResult> {
  const findings = [
    ...detectSeams(input),
    ...groundingFindings(input.groundedClaimMismatches ?? [], {
      scene_id: input.scene.id,
      scene_index: input.scene.order,
    }),
  ];
  const repairs: RepairOutcome[] = [];
  const diagnostics: Diagnostic[] = [];
  const calls: CallRecord[] = [];

  let prose = input.prose;
  let digest = input.digest;

  const note = (
    code: 'continuity_seam_repaired' | 'continuity_repair_rejected',
    finding: SeamFinding,
    message: string,
  ) =>
    diagnostics.push(
      diagnostic(code, {
        // Neither `stale_imagery`'s recycled phrase nor `prose_grounding_mismatch`'s compound
        // `"<entity_id>.<column>"` is a raw entity id.
        entity_id:
          finding.mode === 'stale_imagery' || finding.mode === 'prose_grounding_mismatch'
            ? null
            : finding.subject,
        column: null,
        scene_id: finding.scene_id,
        scene_index: finding.scene_index,
        message,
      }),
    );

  for (const group of groupBySharedRepair(findings)) {
    const budget = ATTEMPTS_PER_SEAM[input.occasion];
    let rejection: string | null = null;
    let applied = false;
    let attempts = 0;

    while (attempts < budget && !applied) {
      attempts += 1;
      const attempt = await attemptRepair({ ...input, prose, digest, findings: group });
      if (attempt.call !== null) calls.push(attempt.call);
      if (attempt.repaired === null) {
        rejection = attempt.rejection;
        continue;
      }
      prose = attempt.repaired.prose;
      digest = attempt.repaired.digest;
      applied = true;
      rejection = null;
    }

    // One attempt, but every seam it addressed gets its own outcome — the run report aggregates
    // per finding, and a group that failed failed for all of them.
    for (const finding of group) {
      repairs.push({ finding, applied, rejection, attempts });
      if (applied) {
        note(
          'continuity_seam_repaired',
          finding,
          `${finding.mode} repaired in ${finding.scene_id}: ${finding.detail}`,
        );
      } else {
        note(
          'continuity_repair_rejected',
          finding,
          `${finding.mode} in ${finding.scene_id} was caught but not repaired (${rejection ?? 'no repair produced'}); the seam stands and is logged`,
        );
      }
    }
  }

  return { prose, digest, findings, repairs, diagnostics, calls };
}

/**
 * Group findings that would repair the same words into one call.
 *
 * Every `opening_rewrite` finding on a scene rewrites the same opening paragraph, so N of them
 * means N calls that each clobber the last — ADR 0011 §7 bounds repairs per scene, and letting
 * the count scale with findings that all touch one paragraph is exactly what that bound is for.
 * `imagery_swap` stays one call per finding: each names a distinct phrase in a distinct place,
 * which is why ADR 0011 §5 kept two shapes rather than one.
 */
export function groupBySharedRepair(findings: readonly SeamFinding[]): SeamFinding[][] {
  const opening = findings.filter((finding) => shapeFor(finding.mode) === 'opening_rewrite');
  const swaps = findings
    .filter((finding) => shapeFor(finding.mode) === 'imagery_swap')
    .map((finding) => [finding]);
  return opening.length === 0 ? swaps : [opening, ...swaps];
}

interface RepairAttempt {
  readonly repaired: { prose: string; digest: SceneDigest } | null;
  readonly rejection: string | null;
  readonly call: CallRecord | null;
}

async function attemptRepair(
  input: ContinuityPassInput & {
    prose: string;
    digest: SceneDigest;
    findings: readonly SeamFinding[];
  },
): Promise<RepairAttempt> {
  const finding = input.findings[0]!;
  const shape = shapeFor(finding.mode);
  const fragment = shape === 'opening_rewrite' ? openingParagraph(input.prose) : input.prose;

  if (fragment.trim() === '') {
    return { repaired: null, rejection: 'the scene has no prose to repair', call: null };
  }

  let response;
  try {
    response = await input.client.generate({
      model: FALLBACK_MODEL,
      systemInstruction: '',
      contents: repairPrompt({
        findings: input.findings,
        fragment,
        previousClosing: input.previous?.digest.closing_situation ?? null,
        toldLedgerLines: toldLedgerLines(input.ledgerAtEntry, input.scene),
      }),
      responseJsonSchema: repairResponseJsonSchema(shape),
      maxOutputTokens: REPAIR_MAX_OUTPUT_TOKENS,
      thinkingLevel: 'LOW',
    });
  } catch (error) {
    // A repair call is never load-bearing: the scene already exists and is committed. A failed
    // one leaves the seam standing and logged, exactly as a discarded repair does.
    return {
      repaired: null,
      rejection: `the repair call failed (${error instanceof Error ? error.message : String(error)})`,
      call: null,
    };
  }

  const call: CallRecord = {
    model: response.model,
    purpose: 'continuity_repair',
    finish_reason: response.finish_reason,
    prompt_tokens: response.usage.prompt_tokens,
    output_tokens: response.usage.output_tokens,
    cached_tokens: response.usage.cached_tokens,
    thoughts_tokens: response.usage.thoughts_tokens,
  };

  const parsed = parseRepair(response.text);
  if (parsed === null) {
    return { repaired: null, rejection: 'the repair response did not parse', call };
  }

  const applied = applyRepair({
    prose: input.prose,
    digest: input.digest,
    finding,
    repair: parsed,
  });
  if (typeof applied === 'string') {
    return { repaired: null, rejection: applied, call };
  }

  const violation = checkRepairAuthority(
    { digest: input.digest, state_updates: input.state_updates },
    { digest: applied.digest, state_updates: input.state_updates },
  );
  if (violation !== null) {
    return { repaired: null, rejection: violation, call };
  }

  return { repaired: applied, rejection: null, call };
}

/**
 * Apply one parsed repair to prose and digest, or return the reason it cannot be applied.
 *
 * The substitution is done here rather than by the model: a repair call returns a *fragment*, so
 * it is structurally incapable of rewriting the scene's events even before the field-level check
 * runs.
 */
export function applyRepair(input: {
  prose: string;
  digest: SceneDigest;
  finding: SeamFinding;
  repair: RepairResponse;
}): { prose: string; digest: SceneDigest } | string {
  const { repair, finding } = input;

  if (shapeFor(finding.mode) === 'imagery_swap') {
    const target = repair.original_phrase;
    if (target === null || target.trim() === '') {
      return 'the repair named no phrase to replace';
    }
    const span = locatePhrase(input.prose, target);
    if (span === null) {
      return `the repair named a phrase that is not in the prose ("${target}")`;
    }
    const repairedProse =
      input.prose.slice(0, span.start) + repair.replacement + input.prose.slice(span.end);

    if (finding.mode === 'prose_grounding_mismatch') {
      // No new call re-derives the correct value, so there is nothing to write in its place —
      // dropping the resolved claim (keyed by the same "<entity_id>.<column>" subject the finding
      // was built from) is what keeps it from going stale against the prose it no longer matches
      // (ADR 0018 decision 4).
      return {
        prose: repairedProse,
        digest: {
          ...input.digest,
          grounded_claims: input.digest.grounded_claims.filter(
            (claim) => `${claim.entity_id}.${claim.column}` !== finding.subject,
          ),
        },
      };
    }

    return {
      prose: repairedProse,
      digest: {
        ...input.digest,
        imagery_signature:
          repair.imagery_signature ??
          swapSignature(input.digest.imagery_signature, finding.subject, repair.replacement),
        ...(repair.reanchor_used === null ? {} : { reanchor_used: repair.reanchor_used }),
      },
    };
  }

  const opening = openingParagraph(input.prose);
  if (opening === '') return 'the scene has no opening paragraph to replace';

  return {
    prose: `${repair.replacement}${input.prose.slice(opening.length)}`,
    digest: {
      ...input.digest,
      // `closing_situation` is carried over: an opening rewrite never reaches the scene's end.
      ...(repair.imagery_signature === null
        ? {}
        : { imagery_signature: repair.imagery_signature }),
      ...(repair.reanchor_used === null ? {} : { reanchor_used: repair.reanchor_used }),
    },
  };
}

/**
 * Find the words a repair named, in the prose it named them from.
 *
 * Exact first, which is what the prompt asks for and what almost always comes back. Failing that,
 * a whitespace-insensitive and case-insensitive search over the same text.
 *
 * The strictness here was never the safety property — that comes from the compiler doing the
 * substitution itself, so a repair is structurally incapable of rewriting the scene (ADR 0011 §4).
 * Requiring a model to reproduce a span byte-for-byte is a harsher demand than that needs, and a
 * correctly-caught stale-imagery seam was being discarded over a capital letter, with the call
 * already spent and `continuity_repair_rejected` reading like a field-authority violation.
 */
export function locatePhrase(
  prose: string,
  phrase: string,
): { start: number; end: number } | null {
  const exact = prose.indexOf(phrase);
  if (exact !== -1) return { start: exact, end: exact + phrase.length };

  // Build a pattern that matches the phrase's words in order across any run of whitespace.
  const words = phrase.trim().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return null;
  const pattern = new RegExp(words.map(escapeRegExp).join('\\s+'), 'i');
  const match = pattern.exec(prose);
  return match === null ? null : { start: match.index, end: match.index + match[0].length };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace the stale phrasing in the signature, keeping its domain — the motif is licensed. */
function swapSignature(
  signature: readonly ImagerySignature[],
  staleImage: string,
  replacement: string,
): ImagerySignature[] {
  return signature.map((entry) =>
    entry.image === staleImage ? { image: replacement, domain: entry.domain } : entry,
  );
}

/**
 * The scene's opening beat: everything up to the first paragraph break.
 *
 * A scene with no paragraph break at all falls back to its first sentence rather than its whole
 * text. Returning the whole scene here would let an opening rewrite replace the scene body, which
 * ADR 0011 §5 forbids outright — and it is reachable, because a writer call can return prose whose
 * breaks arrived escaped (issue #64). `normalizeProse` fixes that case upstream; this is the
 * backstop for a genuinely unbroken scene.
 */
export function openingParagraph(prose: string): string {
  const index = prose.indexOf('\n\n');
  if (index !== -1) return prose.slice(0, index);
  const sentence = /[.!?]["'\u201d\u2019]?\s/.exec(prose);
  return sentence === null ? prose : prose.slice(0, sentence.index + sentence[0].length - 1);
}

function parseRepair(text: string): RepairResponse | null {
  try {
    const result = RepairResponseSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** The told-ledger slice a repair call is fed: the scene's own facts, and how recently told. */
function toldLedgerLines(ledger: ToldLedger, scene: SceneCard): string[] {
  return ledger
    .sliceForScene(scene)
    .map(
      (row) =>
        `${row.fact_ref} (first told in scene ${row.first_learned_scene}, last touched ${row.last_touched_scene})`,
    );
}
