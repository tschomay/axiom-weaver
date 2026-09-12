'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TellingsView } from '@/edition/tellings-view';
import type { QuotaOffer } from '@/writer/model-client';
import { QuotaPrompt } from '../../../quota-prompt';
import { AuthorTokenField, useAuthorSession } from '../../../author-token';

interface Progress {
  run_id: string;
  status: 'running' | 'complete' | 'failed';
  degraded: boolean;
  progress: { scenes_compiled: number; scene_count: number; text: string };
  /** Present when the run stopped on a spent daily quota — a failure with a way past it. */
  quota?: QuotaOffer | null;
  failure?: { detail: string } | null;
  /** How long since the run reported anything, and whether that is long enough to doubt it. */
  stalled_ms?: number | null;
  stopped_reporting?: boolean;
  /**
   * ADR 0014 §7: the run has been quiet past the offer threshold and a Baked edition exists.
   *
   * A different question from `stopped_reporting`, which asks whether anything is running at all.
   * This one assumes it is, and offers something to read while it finishes.
   */
  baked_fallback?: { run_id: string; stalled_ms: number } | null;
}

interface EditionScene {
  scene_id: string;
  scene_index: number;
  prose: string;
}

/** How often the progress poll asks. ADR 0014 §4: scene count, never a percentage. */
const POLL_MS = 2000;

/**
 * Consecutive unusable answers before the watch gives up and says so.
 *
 * The failure this exists to prevent is the quiet one: a poll that stops on a blip leaves the
 * panel frozen on "compiling scene 2 of 3" for good, which is the most confident possible way to
 * be wrong. Blips are retried; a server that is really gone is reported.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

export function ReadView({ storyId, initial }: { storyId: string; initial: TellingsView }) {
  const [view, setView] = useState<TellingsView>(initial);
  const [standIn, setStandIn] = useState(false);
  const [running, setRunning] = useState<Progress | null>(null);
  const [reading, setReading] = useState<{
    run_id: string;
    scenes: EditionScene[];
    provenance: string | null;
  } | null>(null);
  const [writer, setWriter] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The run the server has stopped hearing from, if any. */
  const [stalled, setStalled] = useState<Progress | null>(null);
  // ADR 0015 §5: the library is author-gated. A reader sees it and reads from it; only the author
  // saves, names or removes an entry — which is why this is the same session every other write
  // surface uses rather than a second notion of who is allowed.
  const session = useAuthorSession();
  /** Bumped to reschedule a poll whose answer was unusable, so a blip cannot end the watch. */
  const [poll, setPoll] = useState(0);
  const failedPolls = useRef(0);
  const prose = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/stories/${storyId}/tellings`);
    if (response.ok) setView((await response.json()) as TellingsView);
  }, [storyId]);

  const recheck = useCallback(async (runId: string) => {
    const response = await fetch(`/api/tellings/${runId}`);
    if (!response.ok) return;
    const body = (await response.json()) as Progress;
    // Still nothing new? The verdict stands and the panel says so with a fresher number — and
    // the progress panel gives way to it, so nothing on the page claims a scene is being written.
    const stopped = body.status === 'running' && body.stopped_reporting === true;
    setStalled(stopped ? body : null);
    setRunning(stopped ? null : body);
    await refresh();
  }, [refresh]);

  const read = useCallback(async (runId: string) => {
    setError(null);
    const response = await fetch(`/api/tellings/${runId}?include=scenes`);
    const body = (await response.json()) as { scenes?: EditionScene[]; error?: string };
    if (!response.ok || body.scenes === undefined) {
      setError(body.error ?? `Could not read ${runId}`);
      return;
    }
    setReading({ run_id: runId, scenes: body.scenes, provenance: await provenanceOf(runId) });
  }, []);

  /**
   * Watch a run to its end.
   *
   * Progress is polled rather than streamed: ADR 0014 §4 delivers it over the Workflow's own
   * resumable stream once the loop runs on that platform, and this reads the same number from the
   * same place — the manifest's scene index, written by the step that finished the scene.
   *
   * Two things this must never do, because both leave a reader watching a run that is not
   * running. It must not stop polling because one answer did not arrive or did not parse — the
   * `poll` tick reschedules whatever came back, so a blip costs two seconds and not the watch.
   * And it must not keep saying "compiling" about a run the server has stopped hearing from: a
   * loop dies with the process that started it, and `stopped_reporting` is how that becomes
   * visible instead of permanent.
   */
  useEffect(() => {
    if (running === null || running.status !== 'running' || stalled !== null) return;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/tellings/${running.run_id}`);
          if (response.ok) {
            const body = (await response.json()) as Progress;
            failedPolls.current = 0;

            if (body.status === 'running' && body.stopped_reporting === true) {
              setStalled(body);
              await refresh();
              return;
            }

            setRunning(body);
            if (body.status === 'complete') {
              await read(body.run_id);
              await refresh();
            } else if (body.status === 'failed') {
              // The scenes it did compile are flushed and stand; what a quota failure costs is
              // the rest of the run. Offering the headroom model beats reporting a dead end.
              if (body.quota !== null && body.quota !== undefined) setQuota(body.quota);
              else
                setError(
                  body.failure?.detail ??
                    `The run stopped before it finished. Its report says how far it got — ${body.progress.text}.`,
                );
              await refresh();
            }
            return;
          }
        } catch {
          // Fall through to the retry below: an unreachable server is not a finished run.
        }

        failedPolls.current += 1;
        if (failedPolls.current >= MAX_CONSECUTIVE_POLL_FAILURES) {
          setError(
            `Lost track of ${running.run_id} — the server stopped answering. Whatever it compiled is still in the store; reload to see where it got to.`,
          );
          setRunning(null);
          return;
        }
        setPoll((tick) => tick + 1);
      })();
    }, POLL_MS);

    return () => clearTimeout(timer);
  }, [poll, read, refresh, running, stalled]);

  useEffect(() => {
    if (reading !== null) prose.current?.scrollIntoView({ behavior: 'smooth' });
  }, [reading]);

  const saveToLibrary = useCallback(
    async (runId: string, current: string | null) => {
      const name = window.prompt('Name this telling for the library', current ?? '');
      if (name === null || name.trim() === '') return;
      setError(null);
      const response = await fetch(`/api/tellings/${runId}/library`, {
        method: 'POST',
        headers: session.headers(),
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? `Could not save ${runId}`);
        return;
      }
      await refresh();
    },
    [refresh, session],
  );

  const removeFromLibrary = useCallback(
    async (runId: string) => {
      setError(null);
      const response = await fetch(`/api/tellings/${runId}/library`, {
        method: 'DELETE',
        headers: session.headers(),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? `Could not remove ${runId}`);
        return;
      }
      await refresh();
    },
    [refresh, session],
  );

  const generate = useCallback(
    async (model?: string) => {
    setBusy(true);
    setError(null);
    setQuota(null);
    setStalled(null);
    setReading(null);
    failedPolls.current = 0;
    try {
      const response = await fetch(`/api/stories/${storyId}/tellings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          writer: standIn ? 'stand_in' : 'live',
          ...(model === undefined ? {} : { model }),
        }),
      });
      const body = (await response.json()) as {
        run_id?: string;
        scene_count?: number;
        writer?: { model: string };
        error?: string;
      };
      if (!response.ok || body.run_id === undefined) {
        setError(body.error ?? `Could not start a telling (${response.status})`);
        return;
      }
      setWriter(body.writer?.model ?? null);
      setRunning({
        run_id: body.run_id,
        status: 'running',
        degraded: false,
        progress: {
          scenes_compiled: 0,
          scene_count: body.scene_count ?? view.scene_count,
          text: 'starting',
        },
      });
      await refresh();
    } catch {
      setError('Network error — nothing was started.');
    } finally {
      setBusy(false);
    }
    },
    [refresh, standIn, storyId, view.scene_count],
  );

  // Newest saved first: the library is a shortlist, and the thing most recently thought worth
  // keeping is the one most likely to be wanted.
  const library = view.runs.filter((run) => run.saved && run.name !== null);

  return (
    <>
      <h2>Read</h2>
      <p className="meta">
        One button for the whole compiler: a fresh run id, one writer call per scene in order, each
        scene flushed before the next begins. {view.scene_count} scenes ·{' '}
        {view.estimate.text}
        {view.estimate.from_default
          ? ' (a project-wide default — this story has no runs of its own to measure yet)'
          : " (measured from this story's own runs)"}
        .
      </p>

      <label className="writer-toggle meta">
        <input
          type="checkbox"
          checked={standIn}
          onChange={(event) => setStandIn(event.target.checked)}
        />
        compose from the Scene Cards instead of calling the writer model
        <span className="meta why">
          A whole telling is one writer request per scene. On a rate-limited key that is the day&apos;s
          allowance for a long story — so use the stand-in to prove the loop runs, and a live run to
          judge the prose.
        </span>
      </label>

      <p>
        <button
          type="button"
          className="action primary"
          disabled={busy || (running?.status === 'running' && stalled === null)}
          onClick={() => void generate()}
        >
          {running?.status === 'running' && stalled === null ? 'Compiling…' : 'Generate a telling'}
        </button>
      </p>

      {error !== null && <p className="admin-error">{error}</p>}

      {quota !== null && (
        <QuotaPrompt
          offer={quota}
          what="Start a fresh telling"
          busy={busy}
          onProceed={(model) => void generate(model)}
          onDismiss={() => setQuota(null)}
        />
      )}

      {stalled !== null && (
        <div className="panel quota-prompt">
          <h3>
            <code>{stalled.run_id}</code> has stopped reporting
          </h3>
          <p className="meta">
            It last said anything{' '}
            {stalled.stalled_ms === null || stalled.stalled_ms === undefined
              ? 'a while ago'
              : `${Math.round(stalled.stalled_ms / 1000)} seconds ago`}
            , at {stalled.progress.scenes_compiled} of {stalled.progress.scene_count} scenes. A
            telling runs inside the server process that started it, so a restarted dev server — or
            a serverless invocation that returns and takes the loop with it — ends the run without
            it ever reaching its own failure path. The scenes it flushed are in the store and
            stand; the rest never happened.
          </p>
          <p className="meta">
            A run is never resumed — ADR 0014 §3 mints a fresh id every time — so the way forward
            is a new telling. If a live run keeps dying early, the day&apos;s writer allowance is
            the usual reason, and <code>gemini-3.5-flash-lite</code> has its own much larger one.
          </p>
          <div className="actions">
            <button
              type="button"
              className="action"
              disabled={busy}
              onClick={() => void recheck(stalled.run_id)}
            >
              Check again
            </button>
            <button
              type="button"
              className="action primary"
              disabled={busy}
              onClick={() => void generate()}
            >
              Start a fresh telling
            </button>
            <button
              type="button"
              className="action"
              disabled={busy}
              onClick={() => void generate(view.headroom_model)}
            >
              …with {view.headroom_model}
            </button>
            <a className="meta" href={`/api/tellings/${stalled.run_id}/report`}>
              run report ↗
            </a>
          </div>
        </div>
      )}

      {running !== null && stalled === null && (
        <div className="panel">
          <h3>
            {running.run_id} <span className="tag">{running.status}</span>
            {running.degraded && <span className="tag bad">degraded</span>}
          </h3>
          <p className="meta">
            {running.progress.text}
            {writer === null ? '' : ` · ${writer}`}
          </p>
          <progress
            className="run-progress"
            value={running.progress.scenes_compiled}
            max={running.progress.scene_count}
          />
          {running.baked_fallback !== null && running.baked_fallback !== undefined && (
            // ADR 0014 §7. Taking the offer reads the Baked edition now; it does not stop or
            // replace the telling being made, which carries on unattended either way.
            <p className="meta">
              This is taking longer than usual —{' '}
              {Math.round(running.baked_fallback.stalled_ms / 1000)}s since the last scene landed.{' '}
              <button
                type="button"
                className="action"
                onClick={() => void read(running.baked_fallback!.run_id)}
              >
                Read the Baked edition meanwhile
              </button>{' '}
              This telling keeps compiling in the background.
            </p>
          )}
        </div>
      )}

      <AuthorTokenField session={session} />

      {/*
        The middle arm of ADR 0014 §3's three-way choice. Every completed run is kept and stays
        readable below; the library is the author's shortlist of the ones worth coming back to,
        under names a reader can tell apart (ADR 0015 §5). Removing an entry takes a telling off
        this list and never off the shelf — its run id keeps working.
      */}
      <h3>Library</h3>
      {library.length === 0 ? (
        <p className="meta">
          Nothing saved yet.{' '}
          {session.canWrite
            ? 'Save a finished telling below to keep it here under a name.'
            : 'The author saves tellings here worth returning to.'}
        </p>
      ) : (
        library.map((run) => (
          <div className="proposal" key={run.run_id}>
            <div className="body">
              <strong>{run.name}</strong>{' '}
              {view.baked?.run_id === run.run_id && <span className="tag good">Baked</span>}
              {run.degraded && <span className="tag bad">degraded</span>}
              <br />
              <span className="meta">
                <code>{run.run_id}</code> · package v{run.package_version}
              </span>
            </div>
            <div className="actions">
              <button type="button" className="action" onClick={() => void read(run.run_id)}>
                Read
              </button>
              {session.canWrite && (
                <>
                  <button
                    type="button"
                    className="action"
                    onClick={() => void saveToLibrary(run.run_id, run.name)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="action"
                    title="Takes it off this list. The telling itself is never deleted — its run id keeps working."
                    onClick={() => void removeFromLibrary(run.run_id)}
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          </div>
        ))
      )}

      <h3>Tellings</h3>
      {view.runs.length === 0 ? (
        <p className="meta">None yet. The button above makes one.</p>
      ) : (
        view.runs.map((run) => (
          <div className="proposal" key={run.run_id}>
            <div className="body">
              <code>{run.run_id}</code>{' '}
              <span className={run.status === 'complete' ? 'tag good' : 'tag warn'}>
                {run.status}
              </span>{' '}
              {run.degraded && <span className="tag bad">degraded</span>}
              {view.baked?.run_id === run.run_id && <span className="tag good">Baked</span>}
              <br />
              <span className="meta">
                package v{run.package_version} · started {run.started_at}
              </span>
            </div>
            <div className="actions">
              {run.status === 'running' && (
                // A run left over from a previous visit is nobody's watch: the page that started
                // it is gone. This picks it back up, and says so when it is not running at all.
                <button type="button" className="action" onClick={() => void recheck(run.run_id)}>
                  Check
                </button>
              )}
              <button
                type="button"
                className="action"
                disabled={run.status !== 'complete'}
                onClick={() => void read(run.run_id)}
                title={
                  run.status === 'complete'
                    ? undefined
                    : 'A telling is readable once it has finished — there is no half-edition.'
                }
              >
                Read
              </button>
              {session.canWrite && run.status === 'complete' && !run.saved && (
                <button
                  type="button"
                  className="action"
                  onClick={() => void saveToLibrary(run.run_id, null)}
                >
                  Save
                </button>
              )}
            </div>
          </div>
        ))
      )}

      {reading !== null && (
        <div className="panel" ref={prose}>
          <h3>{view.title}</h3>
          <p className="meta">
            {reading.run_id} · {reading.scenes.length} scenes
            {reading.provenance === null ? '' : ` · ${reading.provenance}`}. This telling exists
            only as itself: the same Story Package performed again produces a different one.
          </p>
          {reading.scenes.map((scene) => (
            <div key={scene.scene_id}>
              <p className="meta scene-marker">
                {scene.scene_index}. {scene.scene_id}
              </p>
              <div className="edition-prose">{scene.prose}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Who wrote a telling, read off its own run report.
 *
 * A stand-in run reports zero tokens on every call — that is the tell the stand-in writer was
 * built to leave, rather than inventing token counts that would put fiction into the same report
 * a live run writes real numbers into. Worth surfacing here because a stand-in telling reads as
 * placeholder text, and the reader should know that is the writer and not a failure.
 *
 * Only `writer`/`writer_retry` calls count as having written anything the reader sees. A
 * `digest_fallback` call (ADR 0012 §5) runs on `gemini-3.5-flash-lite` by design, but only to
 * reconstruct `scene_digest`/`state_updates` after a `MAX_TOKENS` cut landed *after* prose had
 * already completed and streamed — the prose itself came from the writer call and is untouched.
 * Counting it here would tell a reader the lite model wrote part of a scene it never touched a
 * word of. `continuity_repair` and `digest_rollup` are the same story: neither one is prose.
 */
async function provenanceOf(runId: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/tellings/${runId}/report`);
    if (!response.ok) return null;
    const report = (await response.json()) as {
      budget?: { output_tokens: number };
      scenes?: Array<{ calls: Array<{ model: string; purpose: string }> }>;
    };
    const models = [
      ...new Set(
        (report.scenes ?? [])
          .flatMap((scene) => scene.calls)
          .filter((call) => call.purpose === 'writer' || call.purpose === 'writer_retry')
          .map((call) => call.model),
      ),
    ];
    if ((report.budget?.output_tokens ?? 0) === 0) {
      return 'written by the stand-in — every call reported zero tokens, so no model was called';
    }
    return models.length === 0 ? null : `written by ${models.join(', ')}`;
  } catch {
    return null;
  }
}
