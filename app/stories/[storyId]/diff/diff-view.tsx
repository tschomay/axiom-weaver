'use client';

import { useCallback, useState } from 'react';
import type { EditionDiff } from '@/edition/edition-diff';
import type { RunIndex } from '@/edition/edition';

type Run = RunIndex['runs'][number];

/**
 * Pick two tellings; see what the engine varied.
 *
 * The pair has to share a `package_version` (ADR 0015 §6) — the API refuses otherwise, and the
 * picker greys out the runs that cannot be compared against the current selection rather than
 * letting someone choose a pair and then be told no.
 */
export function DiffView({
  storyId,
  title,
  runs,
}: {
  storyId: string;
  title: string;
  runs: Run[];
}) {
  const [a, setA] = useState<string | null>(runs[0]?.run_id ?? null);
  const [b, setB] = useState<string | null>(runs[1]?.run_id ?? null);
  const [diff, setDiff] = useState<EditionDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<number | null>(null);

  const versionOf = (runId: string | null) =>
    runs.find((run) => run.run_id === runId)?.package_version ?? null;

  const compare = useCallback(async () => {
    if (a === null || b === null) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/stories/${storyId}/diff?a=${a}&b=${b}`);
      const body = (await response.json()) as EditionDiff & { error?: string };
      if (!response.ok) {
        setError(body.error ?? `Could not compare (${response.status})`);
        setDiff(null);
        return;
      }
      setDiff(body);
      setReading(null);
    } catch {
      setError('Network error — nothing was compared.');
    } finally {
      setBusy(false);
    }
  }, [a, b, storyId]);

  if (runs.length < 2) {
    return (
      <>
        <h2>Compare tellings</h2>
        <p className="meta">
          {runs.length === 0
            ? 'No finished tellings yet.'
            : 'Only one finished telling so far.'}{' '}
          Two of them, compiled from the same package version, is what this screen needs — generate
          another from <a href={`/stories/${storyId}/read`}>Read</a>.
        </p>
      </>
    );
  }

  return (
    <>
      <h2>Compare tellings</h2>
      <p className="meta">
        The same Scene Cards, performed twice. What differs here is what the variance contract
        leaves free; what matches is what it holds. Prose is shown side by side to read — never
        diffed line by line, since two performances of one card share almost no words.
      </p>

      <div className="diff-picker">
        <Picker label="A" runs={runs} value={a} onChange={setA} lockedTo={versionOf(b)} />
        <Picker label="B" runs={runs} value={b} onChange={setB} lockedTo={versionOf(a)} />
        <button
          type="button"
          className="action primary"
          disabled={busy || a === null || b === null || a === b}
          onClick={() => void compare()}
        >
          {busy ? 'Comparing…' : 'Compare'}
        </button>
      </div>

      {error !== null && <p className="admin-error">{error}</p>}

      {diff !== null && (
        <>
          <p className="meta">
            {title} · package v{diff.package_version} · {diff.scenes_varied} of{' '}
            {diff.scenes.length} scenes came out differently on at least one digest field.
          </p>

          {diff.proposals.length > 0 && (
            <div className="panel">
              <h3>Where the two runs made different choices</h3>
              <p className="meta">
                Volitional columns only. Physical and epistemic state is deterministic across runs
                by construction (ADR 0005 §2), so a difference there would be a bug, not variance.
              </p>
              {diff.proposals.map((proposal) => (
                <p key={`${proposal.scene_index}-${proposal.entity_id}-${proposal.column}`}>
                  <code>
                    {proposal.entity_id}.{proposal.column}
                  </code>{' '}
                  <span className="meta">at scene {proposal.scene_index}</span>
                  <br />
                  <span className="meta">
                    A: {describe(proposal.a)} · B: {describe(proposal.b)}
                  </span>
                </p>
              ))}
            </div>
          )}

          {diff.scenes.map((scene) => (
            <div className="proposal" key={scene.scene_index}>
              <div className="body">
                <code>
                  {scene.scene_index}. {scene.scene_id}
                </code>{' '}
                {scene.identical ? (
                  <span className="tag good">same digest</span>
                ) : (
                  <span className="tag warn">{scene.fields.length} field(s) differ</span>
                )}
                {scene.fields.map((field) => (
                  <div key={field.field} className="meta">
                    <strong>{field.field}</strong>
                    {field.a !== null || field.b !== null ? (
                      <>
                        <br />A: {field.a}
                        <br />B: {field.b}
                      </>
                    ) : (
                      <>
                        {field.removed.length > 0 && <> · only in A: {field.removed.join('; ')}</>}
                        {field.added.length > 0 && <> · only in B: {field.added.join('; ')}</>}
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="action"
                  onClick={() =>
                    setReading(reading === scene.scene_index ? null : scene.scene_index)
                  }
                >
                  {reading === scene.scene_index ? 'Hide prose' : 'Read both'}
                </button>
              </div>
            </div>
          ))}

          {reading !== null && (
            <div className="panel">
              {diff.scenes
                .filter((scene) => scene.scene_index === reading)
                .map((scene) => (
                  <div className="diff-prose" key={scene.scene_index}>
                    <div>
                      <p className="meta scene-marker">A · {diff.a.run_id}</p>
                      <div className="edition-prose">{scene.prose.a ?? '(not in this run)'}</div>
                    </div>
                    <div>
                      <p className="meta scene-marker">B · {diff.b.run_id}</p>
                      <div className="edition-prose">{scene.prose.b ?? '(not in this run)'}</div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function Picker({
  label,
  runs,
  value,
  onChange,
  lockedTo,
}: {
  label: string;
  runs: Run[];
  value: string | null;
  onChange: (runId: string) => void;
  lockedTo: number | null;
}) {
  return (
    <label className="meta">
      {label}{' '}
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        {runs.map((run) => (
          <option
            key={run.run_id}
            value={run.run_id}
            // A pair has to share a package version. Saying so here beats saying it after.
            disabled={lockedTo !== null && run.package_version !== lockedTo}
          >
            {run.run_id} (v{run.package_version}
            {run.degraded ? ', degraded' : ''})
          </option>
        ))}
      </select>
    </label>
  );
}

function describe(side: { status: string; value: string | null } | null): string {
  if (side === null) return 'never proposed';
  return `${side.status.replace(/_/g, ' ')}${side.value === null ? '' : ` → ${side.value}`}`;
}
