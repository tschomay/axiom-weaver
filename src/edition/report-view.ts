/**
 * Rendering a run report as something a person can read.
 *
 * ADR 0014 §8 fixes what the report *holds*; ticket 3's definition of done asks for it to be "a
 * real, readable artifact (even if only queryable via a script at this stage)". The author-facing
 * screen is ticket 4's (ADR 0016 §1) — this is the same data rendered for a terminal, and both
 * read the same document, so the screen inherits a shape that has already been read by somebody.
 */

import { aggregateByCard, type CardAggregate, type RunReport } from './run-report';

const RULE = '='.repeat(78);

export function renderRunReport(report: RunReport, options: { verbose?: boolean } = {}): string {
  const lines = [
    RULE,
    `RUN REPORT — ${report.run_id}`,
    RULE,
    `  story            ${report.story_id} (package_version ${report.package_version})`,
    `  occasion         ${report.occasion}`,
    `  status           ${report.status}${report.degraded ? '  ** DEGRADED **' : ''}`,
    `  scenes           ${report.scenes.length} of ${report.scene_count}` +
      (report.degraded_scene_count > 0
        ? `, ${report.degraded_scene_count} degraded to fallback`
        : ''),
    `  wall clock       ${(report.duration_ms / 1000).toFixed(1)}s`,
    `  promotable       ${report.status === 'complete' && !report.degraded ? 'yes' : 'no — a degraded or unfinished run is never promoted to Baked'}`,
    '',
    `  budget           ${report.budget.output_tokens} output + ${report.budget.thoughts_tokens} thinking tokens ` +
      `against an expected ${report.budget.expected_output_tokens}` +
      (report.budget.over_budget ? '  ** OVER BUDGET (logged, never enforced) **' : ''),
    `  prompt tokens    ${report.budget.prompt_tokens} (${report.budget.cached_tokens} cached)`,
    '',
  ];

  for (const scene of report.scenes) {
    const flags = [
      scene.degraded ? 'DEGRADED' : null,
      scene.repairs.length > 0
        ? `${scene.repairs.filter((repair) => repair.applied).length}/${scene.repairs.length} seams repaired`
        : null,
    ].filter((flag) => flag !== null);

    lines.push(
      `  scene ${String(scene.scene_index).padStart(2)} ${scene.scene_id}` +
        `  ${(scene.duration_ms / 1000).toFixed(1)}s  ${scene.calls.length} call(s)` +
        (flags.length > 0 ? `  [${flags.join(', ')}]` : ''),
    );

    for (const call of scene.calls) {
      if (!(options.verbose ?? false) && call.purpose === 'writer') continue;
      lines.push(
        `      call ${call.purpose} — ${call.model} — ${call.finish_reason} — ` +
          `prompt ${call.prompt_tokens} / output ${call.output_tokens} / thinking ${call.thoughts_tokens}`,
      );
    }

    for (const repair of scene.repairs) {
      lines.push(
        `      ${repair.applied ? 'repaired' : 'not repaired'} ${repair.mode} (${repair.subject})` +
          (repair.rejection === null ? '' : ` — ${repair.rejection}`),
      );
    }

    for (const diagnostic of scene.diagnostics) {
      if (!(options.verbose ?? false) && diagnostic.severity === 'info') continue;
      lines.push(`      [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  if (report.scenes.length === 0) lines.push('  (no scenes compiled)');

  return lines.join('\n');
}

/**
 * ADR 0014 §8's cross-run view: "Scene 13 has degraded on 4 of 20 reads" — the signal that names
 * which cards are underspecified.
 */
export function renderCardAggregates(reports: readonly RunReport[]): string {
  const aggregates = aggregateByCard(reports);
  const lines = [RULE, `ACROSS ${reports.length} RUN(S), BY SCENE CARD`, RULE];

  if (aggregates.length === 0) {
    lines.push('  (no runs recorded for this story yet)');
    return lines.join('\n');
  }

  for (const card of aggregates) {
    lines.push(`  scene ${String(card.scene_index).padStart(2)} ${card.scene_id}`);
    lines.push(`      ${describeDegraded(card)}`);
    if (card.repairs_applied + card.repairs_rejected > 0) {
      lines.push(
        `      continuity: ${card.repairs_applied} repaired, ${card.repairs_rejected} left standing`,
      );
    }
    for (const diagnostic of card.diagnostics) {
      lines.push(`      ${diagnostic.code} × ${diagnostic.count}`);
    }
  }

  return lines.join('\n');
}

function describeDegraded(card: CardAggregate): string {
  if (card.degraded_runs === 0) return `compiled cleanly on all ${card.runs} read(s)`;
  return `degraded on ${card.degraded_runs} of ${card.runs} read(s)`;
}
