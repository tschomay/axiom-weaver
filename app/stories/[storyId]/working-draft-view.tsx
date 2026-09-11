'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftSceneView, DraftView } from '@/draft/draft-view';
import type { DiffSummary } from '@/draft/working-draft';
import type { QuotaOffer } from '@/writer/model-client';
import { AuthorTokenField, useAuthorSession } from '../../author-token';
import { QuotaPrompt } from '../../quota-prompt';

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

/** One line of the compile-the-rest summary: what each card produced, kept after it scrolls by. */
interface BulkOutcome {
  scene_id: string;
  scene_index: number;
  diagnostics: number;
  errors: number;
  proposals: number;
  newly_stale: number;
  failed: string | null;
}

interface DraftScene {
  scene_id: string;
  scene_index: number;
  prose: string;
  compiled_against_package_version: number;
  stale: boolean;
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
  const [bulk, setBulk] = useState<{ outcomes: BulkOutcome[]; remaining: number } | null>(null);
  const [quota, setQuota] = useState<{
    offer: QuotaOffer;
    /** Described rather than captured: a closure kept in state goes stale on the next refresh. */
    retry: { kind: 'scene'; scene_id: string } | { kind: 'rest' };
  } | null>(null);
  const [draftProse, setDraftProse] = useState<DraftScene[] | null>(null);
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

  /** One compile, as the API answers it. Callers own what the screen does with the answer. */
  const compileOne = useCallback(
    async (
      sceneId: string,
      model?: string,
    ): Promise<CompileResponse | { error: string; quota?: QuotaOffer }> => {
      try {
        const response = await fetch(`/api/stories/${storyId}/draft/compile`, {
          method: 'POST',
          headers: session.headers(),
          body: JSON.stringify({
            scene_id: sceneId,
            writer: standIn ? 'stand_in' : 'live',
            ...(model === undefined ? {} : { model }),
          }),
        });
        const body = (await response.json()) as CompileResponse & {
          error?: string;
          quota?: QuotaOffer;
        };
        if (!response.ok) {
          return {
            error: body.error ?? `Compile failed (${response.status})`,
            ...(body.quota === undefined ? {} : { quota: body.quota }),
          };
        }
        return body;
      } catch {
        return { error: 'Network error — the compile may or may not have finished. Reload to see.' };
      }
    },
    [session, standIn, storyId],
  );

  const compile = useCallback(
    async (sceneId: string, model?: string) => {
      setCompiling(sceneId);
      setError(null);
      setCompiled(null);
      setBulk(null);
      setQuota(null);
      setResolutions({});
      const result = await compileOne(sceneId, model);
      if ('error' in result) {
        // A spent daily quota is not a dead end, so it is offered rather than only reported.
        if (result.quota !== undefined) {
          setQuota({ offer: result.quota, retry: { kind: 'scene', scene_id: sceneId } });
        } else {
          setError(result.error);
        }
      } else {
        setCompiled(result);
      }
      await refresh();
      setCompiling(null);
    },
    [compileOne, refresh],
  );

  /**
   * Compile every card the draft has not built yet, in order.
   *
   * Sequential and never parallel: a scene is compiled against the digests of the scenes before
   * it, so scene 4 cannot start until scene 3 has landed. The per-card diagnostics are the point
   * of author-time compiling, so each card's counts are kept in a summary rather than replaced by
   * the next card's — and the last card compiled stays open in the scene compile view.
   *
   * It stops at the first failure instead of pressing on: everything after a failed scene would be
   * compiled against a history that does not exist.
   */
  const compileRest = useCallback(
    async (model?: string) => {
    const pending = draft.scenes.filter((scene) => !scene.compiled);
    if (pending.length === 0) return;

    setError(null);
    setCompiled(null);
    setQuota(null);
    setResolutions({});
    const outcomes: BulkOutcome[] = [];
    setBulk({ outcomes, remaining: pending.length });

    for (const [index, scene] of pending.entries()) {
      setCompiling(scene.scene_id);
      const result = await compileOne(scene.scene_id, model);

      if ('error' in result) {
        outcomes.push({
          scene_id: scene.scene_id,
          scene_index: scene.scene_index,
          diagnostics: 0,
          errors: 0,
          proposals: 0,
          newly_stale: 0,
          failed: result.error,
        });
        setBulk({ outcomes: [...outcomes], remaining: 0 });
        // Picking the offer up resumes from here: the cards already built stay built, and the
        // retry recomputes what is left from the refreshed draft rather than this stale list.
        if (result.quota !== undefined) setQuota({ offer: result.quota, retry: { kind: 'rest' } });
        else setError(`Stopped at ${scene.scene_id}: ${result.error}`);
        break;
      }

      outcomes.push({
        scene_id: scene.scene_id,
        scene_index: scene.scene_index,
        diagnostics: result.diagnostics.length,
        errors: result.diagnostics.filter((entry) => entry.severity === 'error').length,
        proposals: result.proposals.length,
        newly_stale: result.staleness.newly_stale.length,
        failed: null,
      });
      setBulk({ outcomes: [...outcomes], remaining: pending.length - index - 1 });
      setCompiled(result);
    }

      await refresh();
      setCompiling(null);
    },
    [compileOne, draft.scenes, refresh],
  );

  const readDraft = useCallback(async () => {
    if (draftProse !== null) {
      setDraftProse(null);
      return;
    }
    const response = await fetch(`/api/stories/${storyId}/draft/scenes`);
    if (!response.ok) {
      setError('Could not read the draft.');
      return;
    }
    const body = (await response.json()) as { scenes: DraftScene[] };
    setDraftProse(body.scenes);
  }, [draftProse, storyId]);

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

  const uncompiled = draft.scenes.filter((scene) => !scene.compiled).length;

  return (
    <>
      <AuthorTokenField session={session} />
      {error !== null && <p className="admin-error">{error}</p>}
      {quota !== null && (
        <QuotaPrompt
          offer={quota.offer}
          what={quota.retry.kind === 'rest' ? 'Compile the rest' : 'Compile'}
          busy={compiling !== null}
          onProceed={(model) => {
            const retry = quota.retry;
            setQuota(null);
            if (retry.kind === 'rest') void compileRest(model);
            else void compile(retry.scene_id, model);
          }}
          onDismiss={() => setQuota(null)}
        />
      )}

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

      <p className="bulk-actions">
        <button
          type="button"
          className="action primary"
          disabled={compiling !== null || !session.canWrite || uncompiled === 0}
          onClick={() => void compileRest()}
          title={
            uncompiled === 0
              ? 'Every card in the package is already in the draft.'
              : undefined
          }
        >
          {bulk !== null && bulk.remaining > 0
            ? `Compiling… ${bulk.remaining} to go`
            : `Compile the rest (${uncompiled})`}
        </button>
        <button
          type="button"
          className="action"
          disabled={compiling !== null || draft.scenes.every((scene) => !scene.compiled)}
          onClick={() => void readDraft()}
        >
          {draftProse === null ? 'Read the draft' : 'Hide the draft'}
        </button>
      </p>

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

      {bulk !== null && bulk.outcomes.length > 0 && (
        <div className="panel">
          <h3>
            Compiled {bulk.outcomes.filter((outcome) => outcome.failed === null).length} card(s)
            {bulk.remaining > 0 ? ` · ${bulk.remaining} still to go` : ''}
          </h3>
          <p className="meta">
            Each card&apos;s own diagnostics, kept so a run of compiles does not bury them. The last
            card is open in full below.
          </p>
          <div className="table-scroll">
            <table className="rows">
              <tbody>
                <tr>
                  <th>scene</th>
                  <th>diagnostics</th>
                  <th>proposals</th>
                  <th>newly stale</th>
                </tr>
                {bulk.outcomes.map((outcome) => (
                  <tr key={outcome.scene_id}>
                    <td>
                      <span className="meta">{outcome.scene_index}</span>{' '}
                      <code>{outcome.scene_id}</code>
                    </td>
                    <td>
                      {outcome.failed !== null ? (
                        <span className="tag bad">failed</span>
                      ) : outcome.diagnostics === 0 ? (
                        <span className="meta">clean</span>
                      ) : (
                        <span className={outcome.errors > 0 ? 'tag bad' : 'tag warn'}>
                          {outcome.diagnostics}
                          {outcome.errors > 0 ? ` (${outcome.errors} error)` : ''}
                        </span>
                      )}
                    </td>
                    <td className="meta">{outcome.proposals === 0 ? '—' : outcome.proposals}</td>
                    <td className="meta">{outcome.newly_stale === 0 ? '—' : outcome.newly_stale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {draftProse !== null && (
        <div className="panel">
          <h3>The Working Draft, end to end</h3>
          <p className="meta">
            {draftProse.length} of {draft.scenes.length} scenes. A draft is not an edition: it is
            overwritten scene by scene as you recompile, it can stop halfway, and a stale scene
            stands until you choose to revisit it.
          </p>
          {draftProse.map((scene) => (
            <div key={scene.scene_id}>
              <p className="meta scene-marker">
                {scene.scene_index}. {scene.scene_id} · package v
                {scene.compiled_against_package_version}
                {scene.stale ? ' · stale' : ''}
              </p>
              <div className="edition-prose">{scene.prose}</div>
            </div>
          ))}
        </div>
      )}

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
  const standInRepairs = result.diagnostics.some(
    (entry) => entry.code === 'continuity_repair_rejected',
  );

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
      {!result.writer.live && standInRepairs && (
        <p className="meta">
          The continuity pass runs on every compile and calls the model to repair the seams it
          catches. The stand-in cannot answer a repair call, so every seam it caught is reported
          here as standing — those lines are about the stand-in, not about your Scene Cards.
          Compile with the writer model to see which of them a repair would have closed.
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
