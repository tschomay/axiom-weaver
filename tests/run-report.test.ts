import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENE_SECONDS,
  DEGRADED_RUN_FRACTION,
  aggregateByCard,
  averageSceneDurationMs,
  costForCalls,
  costForScenes,
  estimateCompile,
  isPromotable,
  isRunDegraded,
  reportDiagnostic,
  sumBudget,
  type CallRecordDocument,
  type RunReport,
  type RunReportScene,
} from '@/edition/run-report';
import { renderCardAggregates, renderRunReport } from '@/edition/report-view';
import { diagnostic } from '@/validator/diagnostics';
import { WRITER_MODEL } from '@/writer/model-client';

function scene(overrides: Partial<RunReportScene> = {}): RunReportScene {
  return {
    scene_id: 'scene_13_the_fitting',
    scene_index: 13,
    degraded: false,
    duration_ms: 8_000,
    calls: [],
    diagnostics: [],
    repairs: [],
    ...overrides,
  };
}

function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    schema_version: '1.0',
    run_id: 'run-1',
    story_id: 'cinderella',
    package_version: 1,
    occasion: 'read_time',
    status: 'complete',
    degraded: false,
    degraded_scene_count: 0,
    scene_count: 1,
    budget: sumBudget([], 1000),
    started_at: '2026-09-10T00:00:00.000Z',
    completed_at: '2026-09-10T00:02:00.000Z',
    duration_ms: 120_000,
    scenes: [scene()],
    ...overrides,
  };
}

describe('the degraded threshold (ADR 0014 §7)', () => {
  it('marks a run only past roughly 20% of its scenes', () => {
    expect(DEGRADED_RUN_FRACTION).toBe(0.2);
    expect(isRunDegraded(14, 2)).toBe(false);
    expect(isRunDegraded(14, 3)).toBe(true);
    expect(isRunDegraded(5, 1)).toBe(false);
    expect(isRunDegraded(0, 0)).toBe(false);
  });

  it('never lets a degraded or unfinished run be promoted (§9)', () => {
    expect(isPromotable({ status: 'complete', degraded: false })).toBe(true);
    expect(isPromotable({ status: 'complete', degraded: true })).toBe(false);
    expect(isPromotable({ status: 'running', degraded: false })).toBe(false);
    expect(isPromotable({ status: 'failed', degraded: false })).toBe(false);
  });
});

describe('the soft budget (ADR 0014 §6)', () => {
  it('counts thinking tokens against the same budget prose is billed against', () => {
    const budget = sumBudget(
      [
        scene({
          calls: [
            {
              model: 'gemini-3.7-flash',
              purpose: 'writer',
              finish_reason: 'STOP',
              prompt_tokens: 4_000,
              output_tokens: 600,
              cached_tokens: 3_000,
              thoughts_tokens: 500,
            },
          ],
        }),
      ],
      1_000,
    );

    expect(budget.output_tokens).toBe(600);
    expect(budget.thoughts_tokens).toBe(500);
    expect(budget.over_budget).toBe(true);
    // Prompt tokens are reported, never budgeted.
    expect(budget.prompt_tokens).toBe(4_000);
  });
});

describe('severity decides which surface (ADR 0016 §4)', () => {
  const entry = (code: Parameters<typeof diagnostic>[0]) =>
    diagnostic(code, {
      entity_id: null,
      column: null,
      scene_id: 'scene_13_the_fitting',
      scene_index: 13,
      message: 'x',
    });

  it('sends a read-time warning to the run report only — no author is watching live', () => {
    expect(reportDiagnostic(entry('beat_unsatisfied'), 'read_time').surfaces).toEqual([
      'run_report',
    ]);
    expect(reportDiagnostic(entry('beat_unsatisfied'), 'author_time').surfaces).toEqual([
      'scene_compile_view',
    ]);
  });

  it('keeps `info` out of live display in both occasions', () => {
    expect(reportDiagnostic(entry('continuity_seam_repaired'), 'author_time').surfaces).toEqual([
      'run_report',
    ]);
    expect(reportDiagnostic(entry('accepted_proposal'), 'read_time').surfaces).toEqual([
      'run_report',
    ]);
  });

  it('names the contradicted field for an error at author-time, and still logs it', () => {
    const reported = reportDiagnostic(
      diagnostic('exit_state_contradiction', {
        entity_id: 'char_cinderella',
        column: 'location_id',
        scene_id: 'scene_10_second_ball_the_flight',
        scene_index: 10,
        message: 'contradicts exit_state',
      }),
      'author_time',
    );

    expect(reported.surfaces).toEqual(['scene_compile_view', 'run_report']);
    expect(reported.entity_id).toBe('char_cinderella');
    expect(reported.column).toBe('location_id');
  });
});

describe('aggregating across runs by Scene Card (ADR 0014 §8)', () => {
  it('answers "scene 13 degraded on N of M reads"', () => {
    const reports = [
      report({ run_id: 'run-1', scenes: [scene({ degraded: true })] }),
      report({ run_id: 'run-2', scenes: [scene()] }),
      report({ run_id: 'run-3', scenes: [scene({ degraded: true })] }),
      report({ run_id: 'run-4', scenes: [scene()] }),
    ];

    const [card] = aggregateByCard(reports);
    expect(card).toMatchObject({
      scene_id: 'scene_13_the_fitting',
      runs: 4,
      degraded_runs: 2,
      average_duration_ms: 8_000,
    });
    expect(renderCardAggregates(reports)).toContain('degraded on 2 of 4 read(s)');
  });

  it('counts diagnostics and repairs per card, most frequent first', () => {
    const withDiagnostics = (codes: string[]) =>
      report({
        scenes: [
          scene({
            diagnostics: codes.map((code) => ({
              code: code as 'missing_fact',
              severity: 'warn' as const,
              surfaces: ['run_report' as const],
              entity_id: null,
              column: null,
              message: code,
            })),
            repairs: [
              {
                mode: 'cold_open',
                subject: 'char_cinderella',
                applied: true,
                attempts: 1,
                detail: 'a hard reset',
                rejection: null,
              },
            ],
          }),
        ],
      });

    const [card] = aggregateByCard([
      withDiagnostics(['missing_fact', 'beat_unsatisfied']),
      withDiagnostics(['missing_fact']),
    ]);

    expect(card?.diagnostics).toEqual([
      { code: 'missing_fact', count: 2 },
      { code: 'beat_unsatisfied', count: 1 },
    ]);
    expect(card?.repairs_applied).toBe(2);
    expect(card?.repairs_rejected).toBe(0);
  });

  it('says so plainly when a story has no runs yet', () => {
    expect(renderCardAggregates([])).toContain('no runs recorded');
  });
});

describe('the pre-generation estimate (ADR 0014 §5)', () => {
  it('falls back to the project-wide default before a story has run data', () => {
    const estimate = estimateCompile(14, []);
    expect(estimate.from_default).toBe(true);
    expect(estimate.text).toMatch(/^about \d+(\.\d)?–\d+(\.\d)? minutes$/);
    expect(estimate.low_seconds).toBeLessThan(14 * DEFAULT_SCENE_SECONDS);
    expect(estimate.high_seconds).toBeGreaterThan(14 * DEFAULT_SCENE_SECONDS);
  });

  it('uses the story’s own measured per-scene time once it has some', () => {
    const measured = [report({ scenes: [scene({ duration_ms: 30_000 })] })];
    expect(averageSceneDurationMs(measured)).toBe(30_000);

    const estimate = estimateCompile(10, measured);
    expect(estimate.from_default).toBe(false);
    expect(estimate.low_seconds).toBeGreaterThan(14 * DEFAULT_SCENE_SECONDS);
  });

  it('shows wall-clock only — never a cost', () => {
    const estimate = estimateCompile(14, []);
    expect(JSON.stringify(estimate)).not.toMatch(/token|\$|cost/i);
  });
});

describe('the cost tracker (after a run, never before one)', () => {
  const call = (overrides: Partial<CallRecordDocument> = {}): CallRecordDocument => ({
    model: WRITER_MODEL,
    purpose: 'writer',
    finish_reason: 'STOP',
    prompt_tokens: 4_000,
    output_tokens: 600,
    cached_tokens: 3_000,
    thoughts_tokens: 400,
    ...overrides,
  });

  it('prices uncached input, cached input, and output+thinking separately', () => {
    const cost = costForCalls([call()]);
    // (4000 - 3000) uncached @ $0.75/M + 3000 cached @ $0.075/M + 1000 output+thinking @ $3.75/M
    expect(cost.total_usd).toBeCloseTo(0.004725, 6);
    expect(cost.complete).toBe(true);
  });

  it('sums across every call in every scene', () => {
    const cost = costForScenes([
      scene({ calls: [call(), call()] }),
      scene({ scene_id: 'other', calls: [call()] }),
    ]);
    expect(cost.total_usd).toBeCloseTo(0.004725 * 3, 6);
  });

  it('flags a total as partial rather than silently under-counting an unpriced model', () => {
    const cost = costForCalls([call(), call({ model: 'gemini-9-ultra' })]);
    // Only the priced call counts, but the total is honest about being incomplete.
    expect(cost.total_usd).toBeCloseTo(0.004725, 6);
    expect(cost.complete).toBe(false);
  });

  it('is zero and complete for no calls at all', () => {
    expect(costForCalls([])).toEqual({ total_usd: 0, complete: true });
  });

  it('shows up in the rendered run report', () => {
    const rendered = renderRunReport(report({ scenes: [scene({ calls: [call()] })] }));
    expect(rendered).toMatch(/cost\s+\$0\.0047/);
  });

  it('marks the rendered report partial when a call has no listed price', () => {
    const rendered = renderRunReport(
      report({ scenes: [scene({ calls: [call({ model: 'gemini-9-ultra' })] })] }),
    );
    expect(rendered).toContain('partial — some calls used a model with no listed price');
  });
});

describe('rendering a run report', () => {
  it('is readable, names the degraded scenes, and says whether the run can be promoted', () => {
    const rendered = renderRunReport(
      report({
        degraded: true,
        degraded_scene_count: 1,
        scenes: [scene({ degraded: true })],
      }),
    );

    expect(rendered).toContain('DEGRADED');
    expect(rendered).toContain('a degraded or unfinished run is never promoted to Baked');
    expect(rendered).toContain('scene_13_the_fitting');
  });
});
