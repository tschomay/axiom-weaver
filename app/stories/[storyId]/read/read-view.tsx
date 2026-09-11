'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TellingsView } from '@/edition/tellings-view';

interface Progress {
  run_id: string;
  status: 'running' | 'complete' | 'failed';
  degraded: boolean;
  progress: { scenes_compiled: number; scene_count: number; text: string };
}

interface EditionScene {
  scene_id: string;
  scene_index: number;
  prose: string;
}

/** How often the progress poll asks. ADR 0014 §4: scene count, never a percentage. */
const POLL_MS = 2000;

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prose = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/stories/${storyId}/tellings`);
    if (response.ok) setView((await response.json()) as TellingsView);
  }, [storyId]);

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

  // Progress is polled rather than streamed: ADR 0014 §4 delivers it over the Workflow's own
  // resumable stream once the loop runs on that platform, and this reads the same number from the
  // same place — the manifest's scene index, written by the step that finished the scene.
  useEffect(() => {
    if (running === null || running.status !== 'running') return;
    const timer = setTimeout(() => {
      void fetch(`/api/tellings/${running.run_id}`)
        .then((response) => response.json() as Promise<Progress>)
        .then(async (body) => {
          setRunning(body);
          if (body.status === 'complete') {
            await read(body.run_id);
            await refresh();
          } else if (body.status === 'failed') {
            setError(
              `The run stopped before it finished. Its report says how far it got — ${body.progress.text}.`,
            );
            await refresh();
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [read, refresh, running]);

  useEffect(() => {
    if (reading !== null) prose.current?.scrollIntoView({ behavior: 'smooth' });
  }, [reading]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setReading(null);
    try {
      const response = await fetch(`/api/stories/${storyId}/tellings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writer: standIn ? 'stand_in' : 'live' }),
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
  }, [refresh, standIn, storyId, view.scene_count]);

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
          disabled={busy || running?.status === 'running'}
          onClick={() => void generate()}
        >
          {running?.status === 'running' ? 'Compiling…' : 'Generate a telling'}
        </button>
      </p>

      {error !== null && <p className="admin-error">{error}</p>}

      {running !== null && (
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
        </div>
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
 */
async function provenanceOf(runId: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/tellings/${runId}/report`);
    if (!response.ok) return null;
    const report = (await response.json()) as {
      budget?: { output_tokens: number };
      scenes?: Array<{ calls: Array<{ model: string }> }>;
    };
    const models = [
      ...new Set((report.scenes ?? []).flatMap((scene) => scene.calls.map((call) => call.model))),
    ];
    if ((report.budget?.output_tokens ?? 0) === 0) {
      return 'written by the stand-in — every call reported zero tokens, so no model was called';
    }
    return models.length === 0 ? null : `written by ${models.join(', ')}`;
  } catch {
    return null;
  }
}
