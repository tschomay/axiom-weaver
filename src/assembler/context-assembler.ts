/**
 * The zoom-level context assembler (ADR 0008), assembling in the order ADR 0012 decision 2 fixes.
 *
 * Caching is a **prefix match, not a diff** (Gemini research §2), which turns "gather the
 * relevant things" into an *ordering* problem: everything stable goes first, everything volatile
 * goes last, and the boundary between them is where the cache stops paying. The four segments
 * below are that order, coarsest to most volatile, and they are the thing a debug view needs to
 * be able to show — an assembly that silently mis-orders itself costs a scene's cache and cannot
 * be seen in the output prose.
 *
 * Explicit `CachedContent` is used only for the header, because its fields are immutable and so
 * it cannot absorb the digest hierarchy's per-scene appends without being recreated every scene.
 * The hierarchy and both tails ride the implicit per-request prefix cache instead.
 */

import { isDecisionText } from '../arc/decision-text';
import type { LedgerDetail } from '../digest/details-ledger';
import type { SceneCard, StoryPackage } from '../schema/story-package';
import type { WorldModel } from '../world-model/world-model';
import type { ToldLedger, ToldLedgerRow } from '../digest/told-ledger';
import { entityOfMetFact, termOfFact } from '../digest/told-ledger';
import type { DigestHierarchy } from '../digest/hierarchy';
import { levelName, type LeveledDigest } from '../digest/scene-digest';
import { renderVoiceCard, renderSceneTone, type VoiceCard } from '../voice/voice-card';
import { renderImageryLedger, type ImageryLedger } from '../voice/imagery-ledger';
import { renderReanchoring, type BandDecision } from './reanchoring';
import { joinSceneRows, presentEntityIds, type JoinedRows } from './join';
import type { PlantObligation } from '../plants/obligation-walk';
import { tieredColumns, columnAuthority, ROW_COLUMN, TABLE_NAMES } from '../schema/tiers';
import { FactIndex, factsOf } from '../schema/facts';

/** How a segment is cached. The debug view renders this; nothing else branches on it. */
export type CacheMechanism = 'explicit' | 'implicit' | 'none';

export interface PayloadSegment {
  readonly name: string;
  readonly cache: CacheMechanism;
  readonly volatility: string;
  readonly text: string;
  readonly estimated_tokens: number;
}

/**
 * Rough token count: ~4 characters per token.
 *
 * The real number comes from `countTokens`, which needs the API. This approximation exists so the
 * volatile-tail budget can be enforced offline and so the debug view has numbers at all; it is
 * never presented as a billing figure.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** A group in ADR 0008 §6's eviction order, and whether it survived the budget. */
export interface TailGroup {
  readonly priority: number;
  readonly name: string;
  readonly text: string;
  readonly estimated_tokens: number;
  readonly included: boolean;
}

export interface AssemblyDiagnostic {
  readonly type: 'core_over_budget' | 'tail_group_dropped' | 'beat_only_character';
  readonly detail: string;
}

export interface AssembledPrompt {
  /** In payload order. Concatenating their texts *is* the prompt. */
  readonly segments: readonly PayloadSegment[];
  readonly header: PayloadSegment;
  readonly digest_hierarchy: PayloadSegment;
  readonly verbatim_tail: PayloadSegment;
  readonly volatile_tail: PayloadSegment;
  /** Every eviction group considered, in priority order, including the ones dropped. */
  readonly tail_groups: readonly TailGroup[];
  readonly diagnostics: readonly AssemblyDiagnostic[];
  readonly estimated_tokens: number;
}

export interface AssembleInput {
  readonly pkg: StoryPackage;
  readonly scene: SceneCard;
  readonly model: WorldModel;
  readonly voiceCard: VoiceCard;
  readonly hierarchy: DigestHierarchy;
  readonly ledger: ToldLedger;
  readonly imageryLedger: ImageryLedger;
  readonly reanchoring: readonly BandDecision[];
  /** This scene's own plant obligations (ADR 0004) — what it owes a *later* scene. */
  readonly plantObligations: readonly PlantObligation[];
  /** This scene's payoff-side instructions (ADR 0012 decision 3). */
  readonly payoffInstructions: readonly PlantObligation[];
  /** The final paragraph of the previously generated prose, or `null` for the first scene. */
  readonly previousParagraph: string | null;
  /** The contract prose that opens the header. */
  readonly writerContract: string;
  /** ADR 0008 §6's fixed budget for the volatile tail. */
  readonly volatileTailBudget?: number;
  /** Details earlier scenes established that bear on this one (#198), from `DetailsLedger`. */
  readonly establishedDetails?: readonly LedgerDetail[];
}

/**
 * A starting budget for the volatile tail, in estimated tokens. A constant, per ADR 0008 §6.
 *
 * 4000 since #197: at 2000, the core of a long story's scene (card, established account, rows)
 * left so little room that 11 of 16 scenes in panel batch 2026-09-29's `04` dropped the groups
 * telling the writer what the reader already knows — and the prose re-introduced people and
 * re-explained things in nine scenes. Each group is ~20–200 tokens; the tail sits after the
 * cache boundary, so the cost is uncached input at Flash prices, cents per telling.
 */
export const DEFAULT_VOLATILE_TAIL_BUDGET = 4000;

/** The marker every tail-eviction diagnostic carries, so a report can count them. */
export const TAIL_EVICTION_MARKER = 'volatile-tail budget of';

export function assemblePrompt(input: AssembleInput): AssembledPrompt {
  const rows = joinSceneRows(input.scene, input.model);
  const diagnostics: AssemblyDiagnostic[] = [];

  const header = segment(
    'explicit-cache header',
    'explicit',
    'never changes within a read',
    [
      input.writerContract,
      renderVoiceCard(input.voiceCard),
      renderWorldModelLegend(),
      renderPackageMetadata(input.pkg),
    ]
      .filter((block) => block !== '')
      .join('\n\n'),
  );

  const digestHierarchy = segment(
    'implicit-cache digest hierarchy',
    'implicit',
    'append-only; a band resets to empty exactly when it rolls up',
    renderHierarchy(input.hierarchy),
  );

  const verbatimTail = segment(
    'uncached verbatim tail',
    'none',
    'replaced every scene',
    renderVerbatimTail(input.previousParagraph),
  );

  const { text: volatileText, groups } = buildVolatileTail(input, rows, diagnostics);
  const volatileTail = segment(
    'uncached volatile tail',
    'none',
    'mutates every scene',
    volatileText,
  );

  const segments = [header, digestHierarchy, verbatimTail, volatileTail];
  return {
    segments,
    header,
    digest_hierarchy: digestHierarchy,
    verbatim_tail: verbatimTail,
    volatile_tail: volatileTail,
    tail_groups: groups,
    diagnostics,
    estimated_tokens: segments.reduce((total, part) => total + part.estimated_tokens, 0),
  };
}

/** The assembled prompt as one string, in payload order — what actually goes on the wire. */
export function promptText(assembled: AssembledPrompt): string {
  return assembled.segments
    .map((part) => part.text)
    .filter((text) => text !== '')
    .join('\n\n');
}

function segment(
  name: string,
  cache: CacheMechanism,
  volatility: string,
  text: string,
): PayloadSegment {
  return { name, cache, volatility, text, estimated_tokens: estimateTokens(text) };
}

/**
 * The volatile tail, built in ADR 0012 decision 2's internal order and trimmed in ADR 0008 §6's
 * eviction order.
 *
 * The mandatory core — Scene Card, plant obligations, present characters/location/objects — is
 * never dropped. If it alone exceeds the budget that is logged as a diagnostic saying the scene
 * needs a larger allowance, not taken as a signal to trim harder: trimming the core would remove
 * the things the scene cannot be written without.
 */
function buildVolatileTail(
  input: AssembleInput,
  rows: JoinedRows,
  diagnostics: AssemblyDiagnostic[],
): { text: string; groups: TailGroup[] } {
  const budget = input.volatileTailBudget ?? DEFAULT_VOLATILE_TAIL_BUDGET;
  // ADR 0022: a slug's statement travels with it. An empty table renders nothing extra, so a
  // package without one assembles byte-for-byte as it did.
  const facts = new FactIndex(factsOf(input.pkg));

  // Core, in ADR 0012 decision 2's order: Scene Card, payoff instructions, re-anchoring, imagery
  // ledger, tone, then the filtered rows the scene cannot be staged without. The established
  // account sits right after the card: a recap without it is how cause and effect get swapped.
  const coreBlocks = [
    renderSceneCard(input.scene, facts, hiddenFactKnowers(input, rows)),
    renderEstablishedAccount(input, facts),
    renderEstablishedDetails(input.establishedDetails ?? [], input.model),
    renderPlantObligations(input.plantObligations, facts),
    renderPayoffInstructions(input.payoffInstructions, facts),
    renderReanchoring(input.reanchoring),
    renderImageryLedger(input.imageryLedger),
    renderSceneTone(input.scene.tone),
    renderTenseReminder(input.voiceCard),
    renderCoreRows(rows),
  ].filter((block) => block !== '');
  const coreText = coreBlocks.join('\n\n');
  const coreTokens = estimateTokens(coreText);

  if (coreTokens > budget) {
    diagnostics.push({
      type: 'core_over_budget',
      detail: `scene "${input.scene.id}" needs a larger volatile-tail allowance: its mandatory core alone is ~${coreTokens} tokens against a ${budget}-token budget`,
    });
  }

  // Eviction order (#197): what tells the writer "the reader already knows this" outlives who
  // relates to whom. Losing a told-ledger row or the "met:" slice costs a re-introduction the
  // reader sees; losing a relationship edge costs, at worst, a line of staging.
  const candidates: Array<Omit<TailGroup, 'included'>> = [
    {
      priority: 1,
      name: "told-ledger rows for this scene's own facts",
      text: renderToldLedgerRows(
        "TOLD-LEDGER — this scene's own facts (what the reader already knows about them):",
        input.ledger.sliceForScene(input.scene),
        facts,
      ),
      estimated_tokens: 0,
    },
    {
      priority: 2,
      name: 'broader told-ledger recency slice (met: facts)',
      text: renderToldLedgerRows(
        'TOLD-LEDGER SLICE (has the reader met these, and how recently):',
        input.ledger.metSlice(presentEntityIds(rows)),
      ),
      estimated_tokens: 0,
    },
    {
      priority: 3,
      name: "character_knowledge tied to this scene's facts",
      text: renderKnowledge(
        "WHO KNOWS WHAT — this scene's own facts:",
        rows.knowledge_scene_facts,
        input.model,
        facts,
      ),
      estimated_tokens: 0,
    },
    {
      // Forgetting a term was glossed costs a repeated lecture — the same failure as a lost
      // told-ledger row, so it sits with them rather than below the relationships.
      priority: 4,
      name: 'terms already glossed (term: facts)',
      text: renderGlossedTerms(input.ledger.termSlice()),
      estimated_tokens: 0,
    },
    {
      priority: 5,
      name: 'relationships between two present entities',
      text: renderRelationships(
        'RELATIONSHIPS (both parties on stage):',
        rows.relationships_both_present,
        input.model,
      ),
      estimated_tokens: 0,
    },
    {
      priority: 6,
      name: 'other character_knowledge for present characters',
      text: renderKnowledge(
        'WHO KNOWS WHAT — broader epistemic context:',
        rows.knowledge_other,
        input.model,
        facts,
      ),
      estimated_tokens: 0,
    },
    {
      priority: 7,
      name: 'relationships touching one present entity',
      text: renderRelationships(
        'RELATIONSHIPS (one party on stage):',
        rows.relationships_one_present,
        input.model,
      ),
      estimated_tokens: 0,
    },
  ];

  const groups: TailGroup[] = [];
  const kept: string[] = [];
  let spent = coreTokens;
  // Once the budget is exhausted every *remaining* group is dropped. The order is a priority
  // ranking, not a best-fit packing: a cheap low-priority group must never ride along in place of
  // a costlier higher-priority one that just failed to fit.
  let exhausted = false;

  for (const candidate of candidates) {
    const tokens = estimateTokens(candidate.text);
    if (candidate.text === '') {
      groups.push({ ...candidate, estimated_tokens: 0, included: true });
      continue;
    }
    if (!exhausted && spent + tokens <= budget) {
      spent += tokens;
      kept.push(candidate.text);
      groups.push({ ...candidate, estimated_tokens: tokens, included: true });
      continue;
    }
    exhausted = true;
    groups.push({ ...candidate, estimated_tokens: tokens, included: false });
    diagnostics.push({
      type: 'tail_group_dropped',
      detail: `dropped "${candidate.name}" (~${tokens} tokens) from scene "${input.scene.id}" — ${TAIL_EVICTION_MARKER} ${budget} exhausted`,
    });
  }

  return { text: [coreText, ...kept].join('\n\n'), groups };
}

// --- Renderers ---------------------------------------------------------------------------

function renderPackageMetadata(pkg: StoryPackage): string {
  const title = pkg.metadata.title;
  return `STORY: "${title}" (package version ${pkg.package_version}).`;
}

/**
 * The World Model column/tier legend — columns and their tier, never row data.
 *
 * ADR 0012 decision 2 puts this in the cached header precisely because it is schema, not state:
 * it is identical on every call of a read, so it costs the cache nothing to carry.
 */
function renderWorldModelLegend(): string {
  const lines = [
    'WORLD MODEL SCHEMA (columns you may propose values for; tier in parens — you do not need to',
    'reason about tier, just propose what the scene implies):',
  ];
  for (const table of TABLE_NAMES) {
    const columns = tieredColumns(table)
      .map((column) => {
        const { tier } = columnAuthority(table, column);
        const label = column === ROW_COLUMN ? 'existence of a row' : column;
        return `${label} (${tier})`;
      })
      .join(', ');
    lines.push(`- ${table}: ${columns === '' ? '(no writable columns)' : columns}`);
  }
  return lines.join('\n');
}

function renderHierarchy(hierarchy: DigestHierarchy): string {
  const open = hierarchy.inPayloadOrder();
  if (open.length === 0) return '';
  return open.map(renderLeveledDigest).join('\n\n');
}

function renderLeveledDigest(entry: LeveledDigest): string {
  const orders = entry.scene_orders;
  const first = orders[0];
  const last = orders[orders.length - 1];
  const window =
    orders.length === 1 ? `scene ${first}` : `scenes ${first}-${last}`;
  const digest = entry.digest;

  const lines = [`${levelName(entry.level).toUpperCase()} DIGEST (${window}):`];
  lines.push(`  ${digest.event_summary}`);
  if (digest.entities_on_stage.length > 0) {
    lines.push(`  entities: ${digest.entities_on_stage.join(', ')}`);
  }
  lines.push(
    `  facts_revealed: [${digest.facts_revealed.join(', ')}]  plants_opened: [${digest.plants_opened.join(', ')}]  payoffs_closed: [${digest.payoffs_closed.join(', ')}]`,
  );
  if (digest.imagery_signature.length > 0) {
    const imagery = digest.imagery_signature
      .map((entry) => `${entry.domain ?? 'ad hoc'}: "${entry.image}"`)
      .join(', ');
    lines.push(`  imagery: [${imagery}]`);
  }
  lines.push(`  closing_situation: ${digest.closing_situation}`);
  return lines.join('\n');
}

/**
 * The verbatim tail: the final paragraph of the previous scene's *actual prose*.
 *
 * Not a fixed word count, and deliberately not the digest's `closing_situation`, which is a
 * summary — the writer needs the last thing the reader actually read in order to open without a
 * seam. A hard length backstop trims only if one paragraph is unreasonably long.
 */
const VERBATIM_TAIL_MAX_CHARS = 1200;

/**
 * ADR 0003's 2026-09-29 amendment: what the reader has already been told, specifically. In the
 * core, so it is never evicted — dropping it is exactly how a brass urn became a tin one.
 */
function renderEstablishedDetails(details: readonly LedgerDetail[], model: WorldModel): string {
  if (details.length === 0) return '';
  const lines = ['ESTABLISHED DETAILS (the reader has been told these — do not change them):'];
  for (const detail of details) {
    const name = model.nameOf(detail.entity_id);
    const who = name === null || name === undefined ? detail.entity_id : `${name} (${detail.entity_id})`;
    lines.push(`  - ${who} — ${detail.attribute.replace(/_/g, ' ')}: ${detail.value} (scene ${detail.scene_order})`);
  }
  return lines.join('\n');
}

/**
 * The Voice Card's tense, repeated in the per-scene tail (#201). The header states it once, far
 * above; a scene that has just read a past-tense verbatim tail or a past-tense digest drifts to
 * match them unless the scene's own instructions say otherwise.
 */
function renderTenseReminder(voiceCard: VoiceCard): string {
  const tense = voiceCard.tense.trim();
  if (tense === '') return '';
  return `TENSE: narrate this scene in the ${tense} tense, like every scene of this telling (the Voice Card). Dialogue may use any tense; narration may not switch.`;
}

function renderVerbatimTail(paragraph: string | null): string {
  if (paragraph === null || paragraph.trim() === '') return '';
  const trimmed = paragraph.trim();
  const text =
    trimmed.length > VERBATIM_TAIL_MAX_CHARS
      ? `...${trimmed.slice(trimmed.length - VERBATIM_TAIL_MAX_CHARS)}`
      : trimmed;
  return [
    'PREVIOUS SCENE ENDED (the last words the reader actually read — continue from it without a seam; never restate or paraphrase its final sentence):',
    text,
  ].join('\n');
}

/** `slug` alone, or `slug: statement` when the facts table has one (ADR 0022 decision 2). */
function factLine(factRef: string, facts: FactIndex): string {
  const statement = facts.statement(factRef);
  return statement === null ? factRef : `${factRef}: ${statement}`;
}

/** A fact list: the old one-line form when no fact in it has a statement, one per line otherwise. */
function pushFactList(lines: string[], label: string, refs: readonly string[], facts: FactIndex): void {
  if (refs.every((ref) => facts.statement(ref) === null)) {
    lines.push(`${label}: ${refs.join(', ')}`);
    return;
  }
  lines.push(`${label}:`);
  for (const ref of refs) lines.push(`  - ${factLine(ref, facts)}`);
}

/**
 * Present characters who already know a fact this scene must keep hidden (#196), as
 * `[name, fact_ref]` pairs.
 *
 * Without this the writer is told "Ruth knows: …" in the tail and "MUST STAY HIDDEN" on the card,
 * and has no way to honour both — panel batch 2026-09-29 resolved it by making Ruth ignorant, then
 * had her confess she had known all along. It is rendered on the card itself, so it is core and
 * never evicted with the tail's knowledge groups.
 */
function hiddenFactKnowers(input: AssembleInput, rows: JoinedRows): Array<[string, string]> {
  const hidden = new Set(input.scene.must_stay_hidden);
  const pairs: Array<[string, string]> = [];
  for (const row of [...rows.knowledge_scene_facts, ...rows.knowledge_other]) {
    if (!hidden.has(row.fact_ref)) continue;
    const name = input.model.nameOf(row.character_id) ?? row.character_id;
    if (!pairs.some(([who, fact]) => who === name && fact === row.fact_ref)) {
      pairs.push([name, row.fact_ref]);
    }
  }
  return pairs;
}

function renderSceneCard(
  scene: SceneCard,
  facts: FactIndex,
  hiddenKnowers: ReadonlyArray<[string, string]> = [],
): string {
  const lines = [
    `SCENE CARD — ${scene.id} (order ${scene.order})`,
    `POV: ${scene.pov}. Location: ${scene.location_id}. Present: ${scene.characters_present.join(', ')}.`,
    `Dramatic function: ${scene.dramatic_function}`,
  ];
  if (scene.required_beats.length > 0) {
    lines.push('Required beats:');
    for (const beat of scene.required_beats) lines.push(`  - ${beat}`);
    // #199: the decision is the scene. Opening after it is how a turn happens off the page.
    if (scene.required_beats.some((beat) => isDecisionText(beat))) {
      lines.push(
        'A beat here is a decision: dramatise the moment of decision on the page — the pressure, the weighing, then the choice. Do not open the scene after it has been made.',
      );
    }
  }
  if (scene.reader_must_learn.length > 0) {
    pushFactList(lines, 'The reader must learn', scene.reader_must_learn, facts);
  }
  if (scene.must_stay_hidden.length > 0) {
    pushFactList(
      lines,
      'MUST STAY HIDDEN (absolute — prose reaches the reader before anything else is checkable)',
      scene.must_stay_hidden,
      facts,
    );
    for (const [who, fact] of hiddenKnowers) {
      lines.push(
        `  ${who} already knows ${fact}. The narration must not state it, and ${who} must not discover it here — ${who} may act on it only in ways the reader cannot yet decode.`,
      );
    }
  }
  if ((scene.recounts ?? []).length > 0) {
    pushFactList(
      lines,
      'This scene retells (the reader already knows these — keep the established account\'s order)',
      scene.recounts ?? [],
      facts,
    );
  }
  if (scene.invariants.length > 0) {
    lines.push('Invariants:');
    for (const invariant of scene.invariants) lines.push(`  - ${invariant}`);
  }
  lines.push(`Exit state to reach by the scene's end: ${renderState(scene)}`);
  if (scene.length_budget !== undefined) {
    lines.push(
      `Length: aim for approximately ${scene.length_budget} words. A little over is fine if the beats need room; well under is a sign a beat got cut.`,
    );
  }
  return lines.join('\n');
}

function renderState(scene: SceneCard): string {
  const parts: string[] = [];
  for (const [entityId, columns] of Object.entries(scene.exit_state)) {
    if (entityId.startsWith('_') || Array.isArray(columns)) continue;
    for (const [column, value] of Object.entries(columns)) {
      parts.push(`${entityId}.${column} = ${JSON.stringify(value)}`);
    }
  }
  return parts.length === 0 ? '(unchanged)' : parts.join('; ');
}

/**
 * ADR 0022 decision 3: every fact causally linked to the ones this scene names, causes before
 * effects, each labelled with where the reader stands.
 *
 * Seeds are the scene's own facts — must learn, must stay hidden, pays off, plants owed. The
 * label is what lets the writer know the whole account without telling it: only the facts marked
 * for this scene reach the page.
 */
function renderEstablishedAccount(input: AssembleInput, facts: FactIndex): string {
  if (facts.size === 0) return '';
  const { scene } = input;
  const recounts = new Set(scene.recounts ?? []);
  const seeds = [
    ...recounts,
    ...scene.reader_must_learn,
    ...scene.must_stay_hidden,
    ...scene.pays_off.map((payoff) => payoff.fact_ref),
    ...input.plantObligations.map((obligation) => obligation.fact_ref),
  ];
  const account = facts.account(seeds);
  if (account.length === 0) return '';

  const hidden = new Set(scene.must_stay_hidden);
  const learn = new Set(scene.reader_must_learn);
  const resolve = new Set(scene.pays_off.map((payoff) => payoff.fact_ref));
  const status = (ref: string): string => {
    if (hidden.has(ref)) return 'MUST STAY HIDDEN';
    if (learn.has(ref)) return 'reveal here';
    if (resolve.has(ref)) return 'resolve here';
    if (recounts.has(ref)) return 'retold here — the reader already knows it';
    if (input.ledger.row(ref) !== null) return 'reader already knows';
    return 'not yet told — do not state it';
  };

  const lines = [
    'ESTABLISHED ACCOUNT (how these facts connect, causes before effects — any retelling, recap or',
    'accusation in this scene keeps this order and this direction; never swap a cause and its effect):',
  ];
  for (const fact of account) {
    const causes = fact.caused_by.filter((cause) => facts.get(cause) !== null);
    lines.push(
      `  - [${status(fact.fact_ref)}] ${fact.fact_ref}: ${fact.statement}` +
        (causes.length === 0 ? '' : ` (because of: ${causes.join(', ')})`),
    );
  }
  return lines.join('\n');
}

/** An instruction line, with the fact's statement under it when there is one. */
function pushInstruction(lines: string[], entry: PlantObligation, facts: FactIndex): void {
  lines.push(`  - ${entry.instruction}`);
  const statement = facts.statement(entry.fact_ref);
  if (statement !== null) lines.push(`    The fact: ${statement}`);
}

function renderPlantObligations(obligations: readonly PlantObligation[], facts: FactIndex): string {
  if (obligations.length === 0) return '';
  const lines = [
    'THIS SCENE PLANTS (each line opens with the fact_ref to report, verbatim, in plants_opened):',
  ];
  for (const obligation of obligations) pushInstruction(lines, obligation, facts);
  return lines.join('\n');
}

function renderPayoffInstructions(payoffs: readonly PlantObligation[], facts: FactIndex): string {
  if (payoffs.length === 0) return '';
  const lines = [
    'THIS SCENE RESOLVES (each line opens with the fact_ref to report, verbatim, in payoffs_closed):',
  ];
  for (const payoff of payoffs) pushInstruction(lines, payoff, facts);
  return lines.join('\n');
}

function renderCoreRows(rows: JoinedRows): string {
  const lines = [
    "WORLD MODEL ROWS (filtered to this scene's footprint — present characters, their location,",
    'and objects there or held):',
  ];
  for (const character of rows.characters) {
    lines.push(
      `  ${character.id} "${character.name}": {location_id: ${character.location_id}, status: ${character.status}, goal: ${JSON.stringify(character.goal)}}${renderBag(character.bag)}`,
    );
  }
  if (rows.location !== null) {
    lines.push(`  ${rows.location.id} "${rows.location.name}"${renderBag(rows.location.bag)}`);
  }
  for (const object of rows.objects) {
    lines.push(
      `  ${object.id} "${object.name}": {location_id: ${object.location_id}, status: ${object.status}}${renderBag(object.bag)}`,
    );
  }
  return lines.join('\n');
}

function renderBag(bag: Record<string, unknown>): string {
  const entries = Object.entries(bag);
  if (entries.length === 0) return '';
  return ` ${JSON.stringify(bag)}`;
}

function renderRelationships(
  heading: string,
  edges: readonly { id: string; from_id: string; to_id: string; kind: string; sentiment: string | null }[],
  model: WorldModel,
): string {
  if (edges.length === 0) return '';
  const lines = [heading];
  for (const edge of edges) {
    const from = model.nameOf(edge.from_id) ?? edge.from_id;
    const to = model.nameOf(edge.to_id) ?? edge.to_id;
    const sentiment = edge.sentiment === null ? '' : ` (${edge.sentiment})`;
    lines.push(`  ${from} ${edge.kind} ${to}${sentiment}`);
  }
  return lines.join('\n');
}

function renderKnowledge(
  heading: string,
  rows: readonly { character_id: string; fact_ref: string }[],
  model: WorldModel,
  facts: FactIndex,
): string {
  if (rows.length === 0) return '';
  const lines = [heading];
  for (const row of rows) {
    const who = model.nameOf(row.character_id) ?? row.character_id;
    lines.push(`  ${who} knows: ${factLine(row.fact_ref, facts)}`);
  }
  return lines.join('\n');
}

function renderGlossedTerms(rows: readonly ToldLedgerRow[]): string {
  if (rows.length === 0) return '';
  const terms = rows.map(
    (row) => `${(termOfFact(row.fact_ref) ?? row.fact_ref).replace(/_/g, ' ')} (scene ${row.first_learned_scene})`,
  );
  return [
    'TERMS ALREADY GLOSSED (the reader has had these explained — use them plainly, never explain again):',
    `  ${terms.join('; ')}`,
  ].join('\n');
}

function renderToldLedgerRows(
  heading: string,
  rows: readonly ToldLedgerRow[],
  facts?: FactIndex,
): string {
  if (rows.length === 0) return '';
  const lines = [heading];
  for (const row of rows) {
    const subject = entityOfMetFact(row.fact_ref) ?? row.fact_ref;
    const statement = facts?.statement(row.fact_ref) ?? null;
    lines.push(
      `  ${subject}: first told at scene ${row.first_learned_scene}, last touched at scene ${row.last_touched_scene} (${row.centrality})` +
        (statement === null ? '' : ` — ${statement}`),
    );
  }
  return lines.join('\n');
}
