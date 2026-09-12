/**
 * Rendering a run report as something a person can read.
 *
 * ADR 0014 §8 fixes what the report *holds*; ticket 3's definition of done asks for it to be "a
 * real, readable artifact (even if only queryable via a script at this stage)". The author-facing
 * screen is ADR 0016 §1's fourth surface — this is the same data rendered for a terminal, and both
 * read the same document, so the screen inherits a shape that has already been read by somebody.
 *
 * Two renderings live here, then: `renderRunReport` / `renderCardAggregates` for a terminal, and
 * `buildRunReportView` for the screen. The screen's payload is deliberately the *same* projection
 * — per-Scene-Card aggregation across runs, plus what each run's promotability is — rather than a
 * second opinion about what a run report says.
 */

import {
  aggregateByCard,
  costForScenes,
  isPromotable,
  type CardAggregate,
  type RunCost,
  type RunReport,
} from './run-report';
import type { StoryPackage } from '../schema/story-package';
import type { StoryRepository } from '../persistence/story-repository';
import type { BakedPointer } from './edition';

const RULE = '='.repeat(78);

/** `$0.0231`, `$1.20` — enough precision to be legible on a single scene, never fake precision. */
function formatUsd(amount: number): string {
  return `$${amount.toFixed(amount < 1 ? 4 : 2)}`;
}

export function renderRunReport(report: RunReport, options: { verbose?: boolean } = {}): string {
  const cost = costForScenes(report.scenes);
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
    `  cost             ${formatUsd(cost.total_usd)}` +
      (cost.complete ? '' : '  (partial — some calls used a model with no listed price)'),
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

// --- The author-facing screen (ADR 0016 §1, surface 4) ----------------------------------------

export interface RunSummaryView {
  readonly run_id: string;
  readonly package_version: number;
  readonly occasion: RunReport['occasion'];
  readonly status: RunReport['status'];
  readonly degraded: boolean;
  readonly degraded_scene_count: number;
  readonly scene_count: number;
  readonly scenes_compiled: number;
  readonly duration_ms: number;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly budget: RunReport['budget'];
  /** What the run's calls actually cost, from today's `MODEL_PRICING` — never a stored figure. */
  readonly cost: RunCost;
  /** ADR 0014 §9: only a completed, non-degraded run may ever be promoted to Baked. */
  readonly promotable: boolean;
  readonly is_baked: boolean;
}

export interface RunReportView {
  readonly story_id: string;
  readonly title: string;
  readonly baked: BakedPointer | null;
  readonly runs: RunSummaryView[];
  readonly by_card: CardAggregate[];
}

export async function buildRunReportView(
  repository: StoryRepository,
  pkg: StoryPackage,
): Promise<RunReportView> {
  const reports = await repository.getRunReports(pkg.story_id);
  const baked = await repository.getBakedPointer(pkg.story_id);

  return {
    story_id: pkg.story_id,
    title: pkg.metadata.title,
    baked,
    runs: reports.map((report) => ({
      run_id: report.run_id,
      package_version: report.package_version,
      occasion: report.occasion,
      status: report.status,
      degraded: report.degraded,
      degraded_scene_count: report.degraded_scene_count,
      scene_count: report.scene_count,
      scenes_compiled: report.scenes.length,
      duration_ms: report.duration_ms,
      started_at: report.started_at,
      completed_at: report.completed_at,
      budget: report.budget,
      cost: costForScenes(report.scenes),
      promotable: isPromotable(report),
      is_baked: baked?.run_id === report.run_id,
    })),
    by_card: aggregateByCard(reports),
  };
}
