'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftSceneView, DraftView } from '@/draft/draft-view';
import type { DiffSummary } from '@/draft/working-draft';
import { AuthorTokenField, useAuthorSession } from '../../author-token';

interface CompileDiagnostic {
  code: string;
  severity: 'error' | 'warn' | 'info';
  entity_id: string | null;
  column: string | null;
  message: string;
}

interface CompileProposal {
  sequence: number;
  entity_id: string;
  table: string;
  column: string;
  tier: string | null;
  previous_value: unknown;
  new_value: unknown;
}

interface CompileResponse {
  scene_id: string;
  scene_index: number;
  package_version: number;
  writer: { live: boolean; requested: 'live' | 'stand_in'; model: string; calls: number };
  prose: string;
  diagnostics: CompileDiagnostic[];
  proposals: CompileProposal[];
  staleness: { diff: DiffSummary | null; newly_stale: string[] };
}

interface FieldChange {
  previous_value: unknown;
  new_value: unknown;
}

interface Resolution {
  status: string;
  applied: boolean;
  at_scene: FieldChange & { scene_index: number };
  current: FieldChange;
  superseded: boolean;
}

function show(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function WorkingDraftView({ storyId, initial }: { storyId: string; initial: DraftView }) {
  const session = useAuthorSession();
  const [draft, setDraft] = useState<DraftView>(initial);
  const [compiling, setCompiling] = useState<string | null>(null);
  const [compiled, setCompiled] = useState<CompileResponse | null>(null);
  const [resolutions, setResolutions] = useState<Record<number, Resolution>>({});
  const [openDiff, setOpenDiff] = useState<string | null>(null);
  const [standIn, setStandIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The compile view sits below a scene list that is as long as the story; a compile the author
  // has to go looking for is a compile they read late.
  const compileView = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (compiled !== null) compileView.current?.scrollIntoView({ behavior: 'smooth' });
  }, [compiled]);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/stories/${storyId}/draft`);
    if (response.ok) setDraft((await response.json()) as DraftView);
  }, [storyId]);

  const compile = useCallback(
    async (sceneId: string) => {
      setCompiling(sceneId);
      setError(null);
      setCompiled(null);
      setResolutions({});
      try {
        const response = await fetch(`/api/stories/${storyId}/draft/compile`, {
          method: 'POST',
          headers: session.headers(),
          body: JSON.stringify({ scene_id: sceneId, writer: standIn ? 'stand_in' : 'live' }),
        });
        const body = (await response.json()) as CompileResponse & { error?: string };
        if (!response.ok) setError(body.error ?? `Compile failed (${response.status})`);
        else setCompiled(body);
        await refresh();
      } catch {
        setError('Network error — the compile may or may not have finished. Reload to see.');
      } finally {
        setCompiling(null);
      }
    },
    [refresh, session, standIn, storyId],
  );

  const resolve = useCallback(
    async (sequence: number, decision: 'accept' | 'reject') => {
      setError(null);
      try {
        const response = await fetch(`/api/stories/${storyId}/proposals/${sequence}`, {
          method: 'POST',
          headers: session.headers(),
          body: JSON.stringify({ decision }),
        });
        const body = (await response.json()) as Partial<Resolution> & {
          entry?: { status: string };
          error?: string;
        };
        const atScene = body.at_scene;
        const currentValue = body.current;
        if (!response.ok || atScene === undefined || currentValue === undefined) {
          setError(body.error ?? `Could not resolve proposal ${sequence}`);
          return;
        }
        const resolution: Resolution = {
          status: body.entry?.status ?? 'resolved',
          applied: body.applied ?? false,
          at_scene: atScene,
          current: currentValue,
          superseded: body.superseded ?? false,
        };
        setResolutions((current) => ({ ...current, [sequence]: resolution }));
        await refresh();
      } catch {
        setError('Network error — the proposal is still pending.');
      }
    },
    [refresh, session, storyId],
  );

  return (
    <>
      <AuthorTokenField session={session} />
      {error !== null && <p className="admin-error">{error}</p>}

      <h2>Working Draft</h2>
      <p className="meta">
        {draft.scenes.filter((scene) => scene.compiled).length} of {draft.scenes.length} scenes
        compiled · package_version {draft.package_version}
        {draft.pending_proposals > 0
          ? ` · ${draft.pending_proposals} proposal(s) awaiting you`
          : ''}
      </p>

      <label className="writer-toggle meta">
        <input
          type="checkbox"
          checked={standIn}
          onChange={(event) => setStandIn(event.target.checked)}
        />
        compose from the Scene Card instead of calling the writer model
        <span className="meta why">
          Exercises validation, the continuity pass and staleness without spending one of a
          rate-limited key&apos;s daily requests — and writes prose you must not judge the story by.
        </span>
      </label>

      <div>
        {draft.scenes.map((scene) => (
          <SceneRow
            key={scene.scene_id}
            scene={scene}
            selected={compiled?.scene_id === scene.scene_id}
            busy={compiling === scene.scene_id}
            disabled={compiling !== null || !session.canWrite}
            diffOpen={openDiff === scene.scene_id}
            onToggleDiff={() =>
              setOpenDiff((current) => (current === scene.scene_id ? null : scene.scene_id))
            }
            onCompile={() => void compile(scene.scene_id)}
          />
        ))}
      </div>

      <p className="meta">
        Stale-but-standing is a legitimate state (ADR 0015 §1): nothing here auto-recompiles and
        nothing nags. A stale scene stays exactly as compiled until you choose to revisit it.
      </p>

      {compiled !== null && (
        <SceneCompileView
          panelRef={compileView}
          result={compiled}
          resolutions={resolutions}
          canWrite={session.canWrite}
          onResolve={resolve}
        />
      )}
    </>
  );
}

function SceneRow({
  scene,
  selected,
  busy,
  disabled,
  diffOpen,
  onToggleDiff,
  onCompile,
}: {
  scene: DraftSceneView;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  diffOpen: boolean;
  onToggleDiff: () => void;
  onCompile: () => void;
}) {
  return (
    <>
      <div className={selected ? 'scene-row selected' : 'scene-row'}>
        <span className="num">{scene.scene_index}</span>
        <span className="title">{scene.scene_id}</span>

        {scene.compiled ? (
          <span className="tag good">compiled · package v{scene.compiled_against_package_version}</span>
        ) : (
          <span className="tag">not compiled</span>
        )}

        {scene.stale && (
          <button type="button" className="badge-stale" onClick={onToggleDiff}>
            ⚠ stale — upstream changed
          </button>
        )}

        {scene.pending_proposals > 0 && (
          <span className="tag warn">{scene.pending_proposals} proposal(s)</span>
        )}

        <span className="actions">
          <button
            type="button"
            className="action"
            disabled={disabled || !scene.compilable}
            onClick={onCompile}
            title={
              scene.compilable
                ? undefined
                : 'Compile the scenes before this one first — a scene is compiled against their digests.'
            }
          >
            {busy ? 'Compiling…' : scene.compiled ? 'Recompile' : 'Compile'}
          </button>
        </span>
      </div>

      {scene.stale && diffOpen && scene.stale_reason !== null && (
        <DiffPopover diff={scene.stale_reason} />
      )}
    </>
  );
}

/**
 * The stale badge's popover: ADR 0015 §6's field-scoped diff, reused rather than reinvented
 * (ADR 0016 §1).
 */
function DiffPopover({ diff }: { diff: DiffSummary }) {
  return (
    <div className="diagnostic">
      <div className="head">
        {diff.source_scene_id} changed (scene {diff.source_scene_index})
      </div>
      <ul>
        {diff.fields.map((field) => (
          <li key={field.field}>
            <code>{field.field}</code>
            {field.field === 'closing_situation' ? (
              <>
                {' '}
                changed: <em>{field.from}</em> → <em>{field.to}</em>
              </>
            ) : (
              <>
                {field.added.length > 0 && <> added {field.added.join(', ')}</>}
                {field.added.length > 0 && field.removed.length > 0 && ';'}
                {field.removed.length > 0 && <> removed {field.removed.join(', ')}</>}
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="meta">{diff.summary}</p>
    </div>
  );
}

/**
 * The scene compile view (ADR 0016 §1, surface 1): diagnostics and the proposals queue, scoped to
 * the card just compiled. `info`-severity diagnostics never reach here — ADR 0016 §4 sends them to
 * the run report only, so the author does not learn to skim this panel.
 */
function SceneCompileView({
  panelRef,
  result,
  resolutions,
  canWrite,
  onResolve,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  result: CompileResponse;
  resolutions: Record<number, Resolution>;
  canWrite: boolean;
  onResolve: (sequence: number, decision: 'accept' | 'reject') => Promise<void>;
}) {
  const errors = result.diagnostics.filter((entry) => entry.severity === 'error');

  return (
    <div className="panel" ref={panelRef}>
      <h2>Scene compile view · {result.scene_id}</h2>
      <p className="meta">
        scene {result.scene_index} · package_version {result.package_version} ·{' '}
        {result.writer.live ? `live writer call — ${result.writer.model}` : result.writer.model} ·{' '}
        {result.writer.calls} model call(s)
        {!result.writer.live && result.writer.requested === 'live' && (
          <>
            {' '}
            <span className="tag warn">no key — judge the mechanism here, not the prose</span>
          </>
        )}
      </p>

      <h3>Diagnostics</h3>
      {result.diagnostics.length === 0 ? (
        <p className="meta">
          Nothing at <code>error</code> or <code>warn</code> on this card. `info` diagnostics are
          run-report only (ADR 0016 §4) and are never shown here.
        </p>
      ) : (
        result.diagnostics.map((entry, index) => (
          <div
            key={`${entry.code}-${index}`}
            className={entry.severity === 'error' ? 'diagnostic error' : 'diagnostic'}
          >
            <div className="head">
              {entry.code}{' '}
              <span className={entry.severity === 'error' ? 'tag bad' : 'tag warn'}>
                {entry.severity}
              </span>{' '}
              {entry.entity_id !== null && (
                <code>
                  {entry.entity_id}
                  {entry.column === null ? '' : `.${entry.column}`}
                </code>
              )}
            </div>
            {entry.message}
          </div>
        ))
      )}
      {errors.length > 0 && (
        <p className="meta">
          Each error names the exact field to edit on the Scene Card — nothing here was applied to
          the World Model.
        </p>
      )}

      <h3>Proposals queue</h3>
      {result.proposals.length === 0 ? (
        <p className="meta">No volitional proposal is waiting on this card.</p>
      ) : (
        <p className="meta">
          Volitional updates the engine drafted for this scene. Nothing commits until you act, and
          leaving one pending does not block compiling the next scene (ADR 0016 §3).
        </p>
      )}
      {result.proposals.map((proposal) => {
        const resolution = resolutions[proposal.sequence];
        return (
          <div className="proposal" key={proposal.sequence}>
            <div className="body">
              <code>
                {proposal.entity_id}.{proposal.column}
              </code>{' '}
              <span className="tag warn">volitional</span>
              <br />
              <span className="meta">
                {show(proposal.previous_value)} → {show(proposal.new_value)} · {proposal.table}
                {proposal.tier === null ? '' : ` · tier ${proposal.tier}`}
              </span>
              {resolution !== undefined && (
                <>
                  <br />
                  <span className={resolution.applied ? 'tag good' : 'tag'}>
                    {resolution.status}
                  </span>{' '}
                  <span className="meta">
                    World Model as of scene {resolution.at_scene.scene_index}:{' '}
                    {show(resolution.at_scene.previous_value)} →{' '}
                    <strong>{show(resolution.at_scene.new_value)}</strong>
                    {resolution.superseded && (
                      <>
                        {' '}
                        · a later scene has since set this field to{' '}
                        {show(resolution.current.new_value)}, so the current value is unchanged
                      </>
                    )}
                  </span>
                </>
              )}
            </div>
            {resolution === undefined && (
              <div className="actions">
                <button
                  type="button"
                  className="action primary"
                  disabled={!canWrite}
                  onClick={() => void onResolve(proposal.sequence, 'accept')}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="action"
                  disabled={!canWrite}
                  onClick={() => void onResolve(proposal.sequence, 'reject')}
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        );
      })}

      <h3>Staleness</h3>
      {result.staleness.diff === null ? (
        <p className="meta">
          Nothing downstream-visible changed, so no later scene was flagged.
        </p>
      ) : (
        <>
          <p className="meta">
            {result.staleness.newly_stale.length} later scene(s) newly flagged stale.
          </p>
          <DiffPopover diff={result.staleness.diff} />
        </>
      )}

      <h3>Prose</h3>
      <div className="prose-preview">{result.prose}</div>
    </div>
  );
}
