'use client';

import { useCallback, useState } from 'react';
import type { RunReportView as RunReportPayload, RunSummaryView } from '@/edition/report-view';
import { AuthorTokenField, useAuthorSession } from '../../../author-token';

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function usd(amount: number): string {
  return `$${amount.toFixed(amount < 1 ? 4 : 2)}`;
}

export function RunReportView({
  storyId,
  initial,
}: {
  storyId: string;
  initial: RunReportPayload;
}) {
  const session = useAuthorSession();
  const [view, setView] = useState<RunReportPayload>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/stories/${storyId}/run-report`);
    if (response.ok) setView((await response.json()) as RunReportPayload);
  }, [storyId]);

  const promote = useCallback(
    async (runId: string) => {
      setBusy(runId);
      setError(null);
      setMessage(null);
      try {
        const response = await fetch(`/api/tellings/${runId}/promote`, {
          method: 'POST',
          headers: session.headers(),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) setError(body.error ?? `Promotion failed (${response.status})`);
        else setMessage(`${runId} is now the Baked edition.`);
        await refresh();
      } catch {
        setError('Network error — nothing was promoted.');
      } finally {
        setBusy(null);
      }
    },
    [refresh, session],
  );

  return (
    <>
      <AuthorTokenField session={session} />
      {error !== null && <p className="admin-error">{error}</p>}
      {message !== null && <p className="meta">{message}</p>}

      <h2>Run report</h2>
      <p className="meta">
        {view.runs.length} run(s) recorded ·{' '}
        {view.baked === null
          ? 'no Baked edition yet'
          : `Baked: ${view.baked.run_id} (package v${view.baked.package_version})`}
      </p>

      <h3>Across runs, by Scene Card</h3>
      {view.by_card.length === 0 ? (
        <p className="meta">
          Nothing to aggregate yet. Generate a telling — <code>npm run telling</code>, or{' '}
          <code>POST /api/stories/{storyId}/tellings</code> — and its report lands here.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="rows">
            <tbody>
              <tr>
                <th>scene card</th>
                <th>degraded</th>
                <th>diagnostics</th>
                <th>continuity</th>
                <th>avg</th>
              </tr>
              {view.by_card.map((card) => (
                <tr key={card.scene_id}>
                  <td>
                    <span className="meta">{card.scene_index}</span> <code>{card.scene_id}</code>
                  </td>
                  <td>
                    <span className={card.degraded_runs > 0 ? 'tag bad' : 'tag good'}>
                      {card.degraded_runs} / {card.runs}
                    </span>
                  </td>
                  <td>
                    {card.diagnostics.length === 0 ? (
                      <span className="meta">—</span>
                    ) : (
                      card.diagnostics.map((entry) => (
                        <span className="tag" key={entry.code}>
                          {entry.code} × {entry.count}
                        </span>
                      ))
                    )}
                  </td>
                  <td className="meta">
                    {card.repairs_applied} repaired, {card.repairs_rejected} standing
                  </td>
                  <td className="meta">{seconds(card.average_duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="meta">
        A card that degrades on a share of reads is telling you it is underspecified (ADR 0014 §8)
        — a smaller <code>required_beats</code> list or a larger <code>length_budget</code>, not a
        compiler fix. <code>info</code> diagnostics appear here and only here (ADR 0016 §4).
      </p>

      <h3>Runs</h3>
      {view.runs.length === 0 ? (
        <p className="meta">No run reports stored for this story.</p>
      ) : (
        view.runs.map((run) => (
          <RunRow
            key={run.run_id}
            run={run}
            busy={busy === run.run_id}
            disabled={busy !== null || !session.canWrite}
            onPromote={() => void promote(run.run_id)}
          />
        ))
      )}
    </>
  );
}

function RunRow({
  run,
  busy,
  disabled,
  onPromote,
}: {
  run: RunSummaryView;
  busy: boolean;
  disabled: boolean;
  onPromote: () => void;
}) {
  return (
    <div className="proposal">
      <div className="body">
        <code>{run.run_id}</code>{' '}
        <span className={run.status === 'complete' ? 'tag good' : 'tag warn'}>{run.status}</span>{' '}
        {run.degraded && <span className="tag bad">degraded</span>}{' '}
        {run.is_baked && <span className="tag good">Baked</span>}
        <br />
        <span className="meta">
          package v{run.package_version} · {run.occasion} · {run.scenes_compiled} of{' '}
          {run.scene_count} scenes
          {run.degraded_scene_count > 0 ? `, ${run.degraded_scene_count} to fallback` : ''} ·{' '}
          {seconds(run.duration_ms)} · {run.budget.output_tokens + run.budget.thoughts_tokens}{' '}
          output+thinking tokens against an expected {run.budget.expected_output_tokens}
          {run.budget.over_budget ? ' (over budget — logged, never enforced)' : ''} ·{' '}
          {usd(run.cost.total_usd)}
          {run.cost.complete ? '' : ' (partial)'}
        </span>
        <br />
        <a className="meta" href={`/api/tellings/${run.run_id}/report`}>
          full report ↗
        </a>
      </div>
      <div className="actions">
        <button
          type="button"
          className="action primary"
          disabled={disabled || !run.promotable || run.is_baked}
          onClick={onPromote}
          title={
            run.promotable
              ? undefined
              : 'A degraded or unfinished run is never promoted to Baked (ADR 0014 §9).'
          }
        >
          {busy ? 'Promoting…' : run.is_baked ? 'Baked' : 'Promote to Baked'}
        </button>
      </div>
    </div>
  );
}
