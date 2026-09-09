/**
 * Validator diagnostics (ADR 0005 §5, ADR 0016 §4).
 *
 * Three severities, and none of them aborts a read-time run — the map's standing constraint that
 * "nothing may block on an author who is not there". Severity also decides *where* a diagnostic
 * renders (ADR 0016 §4), which is why each carries its surface.
 */

export type Severity = 'error' | 'warn' | 'info';

export const DIAGNOSTIC_CODES = [
  /** Pre-generation: the card's `entry_state` no longer describes the world (ADR 0005 §1). */
  'entry_state_mismatch',
  /** A P/E update whose column is named in `exit_state` with a different value (§2). */
  'exit_state_contradiction',
  /** An update to an entity outside the scene's footprint — the mugging-on-the-way case (§2). */
  'unauthorized_entity_update',
  /** The amnesia guard: a change away from a committed value nothing asked for (§2). */
  'unentailed_reversion',
  /**
   * A write to a column that carries no tier — `bag`, an id, a foreign key — or to a column
   * that does not exist on the table. ADR 0001 decision 2: "Bag columns carry no tier and are
   * never engine-writable." Not one of ADR 0005 §5's four named errors; it is the mechanical
   * consequence of ADR 0001's tier table having no entry to authorize the write.
   */
  'untiered_column_update',
  /** A volitional proposal dropped, either as contradicting an invariant or on silence (§5). */
  'dropped_proposal',
  /** A volitional proposal accepted and committed (§5, `info`). */
  'accepted_proposal',
  /** A volitional proposal recorded for the author to resolve (ADR 0016 §3). */
  'pending_proposal',
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

/**
 * Where a diagnostic renders, per ADR 0016 §4's severity-to-surface mapping.
 *
 * `info` is "run report only, never surfaced live" — the one category issue #21 flagged as
 * risking becoming noise, cut from live display rather than shown quietly.
 */
export type Surface = 'scene_compile_view' | 'run_report';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  /** The exact field the author needs to edit, where there is one. */
  readonly entity_id: string | null;
  readonly column: string | null;
  readonly scene_id: string;
  readonly scene_index: number;
  readonly message: string;
  /** Populated for a dropped proposal: why it was dropped. */
  readonly reason?: 'contradicts_invariant' | 'no_signal';
}

const SEVERITY_BY_CODE: Record<DiagnosticCode, Severity> = {
  entry_state_mismatch: 'error',
  exit_state_contradiction: 'error',
  unauthorized_entity_update: 'error',
  unentailed_reversion: 'error',
  untiered_column_update: 'error',
  dropped_proposal: 'warn',
  accepted_proposal: 'info',
  pending_proposal: 'warn',
};

export function severityOf(code: DiagnosticCode): Severity {
  return SEVERITY_BY_CODE[code];
}

/**
 * Which surface a diagnostic renders on, given when it fired.
 *
 * ADR 0016 §4: errors go to the scene compile view (and the run report); `warn` goes to the
 * scene compile view at author-time but to the run report only at read-time, where no author is
 * watching live; `info` is run-report only, always.
 */
export function surfacesFor(severity: Severity, occasion: 'author_time' | 'read_time'): Surface[] {
  if (severity === 'error') {
    return occasion === 'author_time'
      ? ['scene_compile_view', 'run_report']
      : ['run_report'];
  }
  if (severity === 'warn') {
    return occasion === 'author_time' ? ['scene_compile_view'] : ['run_report'];
  }
  return ['run_report'];
}

export function diagnostic(
  code: DiagnosticCode,
  fields: Omit<Diagnostic, 'code' | 'severity'>,
): Diagnostic {
  return { code, severity: severityOf(code), ...fields };
}
