'use client';

import { useCallback, useState } from 'react';
import type { RunReportView as RunReportPayload, RunSummaryView } from '@/edition/report-view';
import type { EditionDiscourseView } from '@/edition/discourse-view';
import { AuthorTokenField, useAuthorSession, type AuthorSession } from '../../../author-token';

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
            session={session}
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
  session,
  busy,
  disabled,
  onPromote,
}: {
  run: RunSummaryView;
  session: AuthorSession;
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
        <DiscoursePanel runId={run.run_id} session={session} />
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

/**
 * What the writer reported it told the reader, scene by scene, beside what the card asked for
 * (#183). Fetched on demand: it is a debugging view, opened for the one run that reads wrong.
 */
function DiscoursePanel({ runId, session }: { runId: string; session: AuthorSession }) {
  const [view, setView] = useState<EditionDiscourseView | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (view !== null) return;
    setError(null);
    try {
      const response = await fetch(`/api/tellings/${runId}/discourse`, {
        headers: session.headers(),
      });
      const body = (await response.json()) as EditionDiscourseView & { error?: string };
      if (!response.ok) setError(body.error ?? `Could not load the discourse (${response.status})`);
      else setView(body);
    } catch {
      setError('Network error — the discourse record could not be loaded.');
    }
  }, [open, runId, session, view]);

  return (
    <>
      {' · '}
      <button
        type="button"
        className="action"
        disabled={!session.canWrite}
        onClick={() => void toggle()}
      >
        {open ? 'hide discourse' : 'discourse'}
      </button>
      {open && error !== null && <p className="admin-error">{error}</p>}
      {open && view !== null && <DiscourseTable view={view} />}
    </>
  );
}

function FactList({
  facts,
  flagged,
  statements,
}: {
  facts: readonly string[];
  flagged?: readonly string[];
  statements: Readonly<Record<string, string>>;
}) {
  if (facts.length === 0) return <span className="meta">—</span>;
  return (
    <>
      {facts.map((fact) => (
        <span
          key={fact}
          className={flagged?.includes(fact) ? 'tag bad' : 'tag'}
          title={statements[fact]}
        >
          {fact}
        </span>
      ))}
    </>
  );
}

function DiscourseTable({ view }: { view: EditionDiscourseView }) {
  return (
    <div className="discourse">
      <h4>Scenes — card asked vs. writer reported</h4>
      <div className="table-scroll">
        <table className="rows">
          <tbody>
            <tr>
              <th>scene</th>
              <th>card: must learn / stay hidden / pays off</th>
              <th>digest: event summary</th>
              <th>digest: facts revealed</th>
            </tr>
            {view.scenes.map((scene) => (
              <tr key={scene.scene_id}>
                <td>
                  <span className="meta">{scene.scene_index}</span> <code>{scene.scene_id}</code>
                  {scene.degraded && <span className="tag bad">degraded</span>}
                </td>
                <td>
                  {scene.card === null ? (
                    <span className="meta">card not in the pinned package</span>
                  ) : (
                    <>
                      <div>
                        <span className="meta">learn </span>
                        <FactList
                          facts={scene.card.reader_must_learn}
                          flagged={scene.unreported}
                          statements={view.statements}
                        />
                      </div>
                      <div>
                        <span className="meta">hidden </span>
                        <FactList
                          facts={scene.card.must_stay_hidden}
                          flagged={scene.leaked}
                          statements={view.statements}
                        />
                      </div>
                      <div>
                        <span className="meta">pays off </span>
                        <FactList
                          facts={scene.card.pays_off.map((payoff) => payoff.fact_ref)}
                          statements={view.statements}
                        />
                      </div>
                    </>
                  )}
                </td>
                <td>
                  {scene.digest.event_summary}
                  <br />
                  <span className="meta">closing: {scene.digest.closing_situation}</span>
                </td>
                <td>
                  <FactList
                    facts={scene.digest.facts_revealed}
                    flagged={scene.leaked}
                    statements={view.statements}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="meta">
        Red on the card side: a fact the card required that the digest never reported, or a hidden
        fact the digest says it revealed. The digest is the writer&apos;s own account — a claim the
        prose makes but the digest omits is not visible here.
      </p>

      <h4>Rollups</h4>
      {view.digest_hierarchy.filter((entry) => entry.level > 0).length === 0 ? (
        <p className="meta">No window closed in this run.</p>
      ) : (
        view.digest_hierarchy
          .filter((entry) => entry.level > 0)
          .map((entry) => (
            <p key={`${entry.level}:${entry.scene_orders.join(',')}`}>
              <span className="tag">
                L{entry.level} · scenes {entry.scene_orders[0]}–{entry.scene_orders.at(-1)}
              </span>{' '}
              {entry.digest.event_summary}
            </p>
          ))
      )}

      <h4>Told-ledger at the close of the run</h4>
      <div className="table-scroll">
        <table className="rows">
          <tbody>
            <tr>
              <th>fact</th>
              <th>first learned</th>
              <th>last touched</th>
              <th>centrality</th>
            </tr>
            {view.told_ledger.map((row) => (
              <tr key={row.fact_ref}>
                <td>
                  <code>{row.fact_ref}</code>
                  {view.statements[row.fact_ref] !== undefined && (
                    <>
                      <br />
                      <span className="meta">{view.statements[row.fact_ref]}</span>
                    </>
                  )}
                </td>
                <td className="meta">{row.first_learned_scene}</td>
                <td className="meta">{row.last_touched_scene}</td>
                <td className="meta">{row.centrality}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
