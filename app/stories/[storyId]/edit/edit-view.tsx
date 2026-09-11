'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LintResult, PackageProblem } from '@/authoring/lint';
import type { DraftStoryPackage, Manuscript } from '@/schema/manuscript';
import {
  EDITOR_SECTIONS,
  SECTION_LABELS,
  isEditorSection,
  sectionCounts,
  sectionForPath,
  type EditorSection,
} from '@/authoring/editor-model';
import { AuthorTokenField, useAuthorSession } from '../../../author-token';
import { StorySection } from './story-section';
import { VoiceSection } from './voice-section';
import { WorldSection } from './world-section';
import { ScenesSection } from './scenes-section';
import { PublishSection } from './publish-section';
import { TransferPanel } from './transfer-panel';

export interface ManuscriptPayload extends Manuscript {
  lint: LintResult;
  next_package_version: number;
}

/** How long a keystroke waits before it becomes a write. */
const AUTOSAVE_MS = 900;
/** The lint panel is a read, and cheap — it may run ahead of the save that persists the edit. */
const LINT_MS = 450;

type SaveState =
  | { kind: 'clean' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }
  | { kind: 'conflict' };

/**
 * The authoring screen (ADR 0017 §6/§7).
 *
 * Three things it owns that no section does:
 *
 * 1. **Autosave with a precondition.** Every save carries the `updated_at` it was read at. A
 *    mismatch is a 409, and a 409 stops autosaving rather than retrying — a retry is exactly the
 *    clobber the precondition exists to prevent (§8). Saves are queued rather than overlapped,
 *    and only the newest queued edit is sent: an intermediate keystroke that lost its race would
 *    fail the precondition anyway.
 * 2. **Where the author is**, kept in the URL. On a phone the section list and the section are
 *    two screens, so the platform back gesture has to be the way out of one; on a desktop they
 *    sit side by side and the same URL still names what is open. The server reads it too, so a
 *    link to a section opens on that section rather than flashing through the first one.
 * 3. **The lint panel**, run continuously against the in-memory package rather than against the
 *    last thing that reached the store, so a problem disappears when the author fixes it and not
 *    a second later when the save lands.
 */
export function EditView({
  storyId,
  initial,
  published,
  retainedVersions,
  initialSection,
  initialScene,
}: {
  storyId: string;
  initial: ManuscriptPayload;
  published: boolean;
  /** Retained `package_version`s, so the escape hatch can export any one of them. */
  retainedVersions: readonly number[];
  /** `null` means the URL named no section: the drill-down list, on a narrow viewport. */
  initialSection: EditorSection | null;
  /** The Scene Card the URL names, if any — the third level of the drill-down. */
  initialScene: string | null;
}) {
  const router = useRouter();
  const session = useAuthorSession();

  const [pkg, setPkg] = useState<DraftStoryPackage>(initial.package);
  const [basedOn, setBasedOn] = useState(initial.based_on_version);
  const [nextVersion, setNextVersion] = useState(initial.next_package_version);
  const [lint, setLint] = useState<LintResult>(initial.lint);
  const [save, setSave] = useState<SaveState>({ kind: 'clean' });
  const [section, setSection] = useState<EditorSection>(initialSection ?? 'story');
  const [atList, setAtList] = useState(initialSection === null);
  const [openScene, setOpenScene] = useState<string | null>(initialScene);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // The precondition token lives in a ref, not in state: the save queue may send several writes
  // without a render between them, and each has to carry what the *previous* one left behind.
  const updatedAt = useRef(initial.updated_at);
  const queued = useRef<DraftStoryPackage | null>(null);
  const draining = useRef(false);
  /** The last write's outcome, so a caller that awaited one can report it. */
  const outcome = useRef<string | null>(null);

  const edit = useCallback((next: DraftStoryPackage) => {
    setPkg(next);
    setDirty(true);
  }, []);

  // --- Where the author is ----------------------------------------------------------------

  useEffect(() => {
    const onPop = () => {
      const search = new URLSearchParams(window.location.search);
      const param = search.get('section');
      setAtList(param === null);
      if (isEditorSection(param)) setSection(param);
      setOpenScene(search.get('scene'));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openSection = useCallback((next: EditorSection) => {
    setSection(next);
    setAtList(false);
    setOpenScene(null);
    window.history.pushState(null, '', `?section=${next}`);
  }, []);

  /**
   * The third level of the drill-down: one Scene Card.
   *
   * Pushed rather than replaced, like the section above it, so the back gesture walks back out
   * scene → scene list → section list rather than leaving the screen entirely.
   */
  const showScene = useCallback((sceneId: string | null) => {
    setOpenScene(sceneId);
    const search = sceneId === null ? '?section=scenes' : `?section=scenes&scene=${encodeURIComponent(sceneId)}`;
    window.history.pushState(null, '', search);
  }, []);

  const backToList = useCallback(() => {
    // Pushed, not replaced: the list is somewhere the author navigated to, so the gesture that
    // got them here has to be able to take them back out.
    setAtList(true);
    window.history.pushState(null, '', window.location.pathname);
  }, []);

  const showProblem = useCallback(
    (path: string) => {
      setFocusPath(path);
      const target = sectionForPath(path);
      openSection(target);
      // A scene's problems are only navigable if following one opens the card: the section on
      // its own is a list of twenty ids, which is where the author started.
      const sceneId = target === 'scenes' ? (path.split('.')[1] ?? null) : null;
      if (sceneId !== null) showScene(sceneId);
    },
    [openSection, showScene],
  );

  // --- Lint, continuously -----------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetch('/api/authoring/lint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: { ...pkg, package_version: nextVersion } }),
      })
        .then((response) => (response.ok ? (response.json() as Promise<LintResult>) : null))
        .then((result) => {
          if (!cancelled && result !== null) setLint(result);
        })
        .catch(() => {
          // The panel keeps showing the last answer it had. A lint that could not be reached is
          // not a reason to tell the author their package is clean.
        });
    }, LINT_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pkg, nextVersion]);

  // --- Saving -----------------------------------------------------------------------------

  /**
   * Send whatever is queued, one write at a time, until the queue is empty.
   *
   * Resolves when the queue drains, so a caller that needs the write to have landed — a rename —
   * can await it and read `outcome`.
   */
  const drain = useCallback(async (): Promise<void> => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (queued.current !== null) {
        const candidate = queued.current;
        queued.current = null;
        setSave({ kind: 'saving' });

        try {
          const response = await fetch(`/api/stories/${storyId}/manuscript`, {
            method: 'PUT',
            headers: session.headers(),
            body: JSON.stringify({ package: candidate, updated_at: updatedAt.current }),
          });
          const body = (await response.json()) as Record<string, unknown>;

          if (response.status === 409) {
            // Stop, do not retry: retrying with the store's token is precisely the clobber the
            // precondition exists to prevent.
            queued.current = null;
            outcome.current = 'this draft changed somewhere else';
            setSave({ kind: 'conflict' });
            return;
          }
          if (!response.ok) {
            outcome.current =
              typeof body['error'] === 'string' ? body['error'] : `save failed (${response.status})`;
            setSave({ kind: 'error', message: outcome.current });
            return;
          }

          const saved = body as unknown as ManuscriptPayload;
          updatedAt.current = saved.updated_at;
          outcome.current = null;
          setBasedOn(saved.based_on_version);
          setNextVersion(saved.next_package_version);
          setSave({ kind: 'saved' });
          if (saved.story_id !== storyId) {
            const search = window.location.search;
            router.replace(`/stories/${saved.story_id}/edit${search}`);
            return;
          }
        } catch (error) {
          outcome.current = error instanceof Error ? error.message : 'save failed';
          setSave({ kind: 'error', message: outcome.current });
          return;
        }
      }
    } finally {
      draining.current = false;
    }
  }, [router, session, storyId]);

  useEffect(() => {
    if (!dirty || save.kind === 'conflict' || !session.canWrite) return;
    const timer = setTimeout(() => {
      setDirty(false);
      queued.current = pkg;
      void drain();
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, drain, pkg, save.kind, session.canWrite]);

  const rename = useCallback(
    async (next: string): Promise<string | null> => {
      const candidate = { ...pkg, story_id: next };
      setPkg(candidate);
      setDirty(false);
      queued.current = candidate;
      await drain();
      return outcome.current;
    },
    [drain, pkg],
  );

  // --- Lint problems, indexed by the field that owns them ---------------------------------

  const problemsByPath = useMemo(() => {
    const index = new Map<string, PackageProblem[]>();
    for (const problem of lint.problems) {
      index.set(problem.path, [...(index.get(problem.path) ?? []), problem]);
    }
    return index;
  }, [lint]);

  const flagged = useCallback(
    (path: string) =>
      (problemsByPath.get(path) ?? []).some((problem) => problem.severity === 'error'),
    [problemsByPath],
  );

  const problemsFor = useCallback(
    (prefix: string) =>
      lint.problems.filter(
        (problem) => problem.path === prefix || problem.path.startsWith(`${prefix}.`),
      ).length,
    [lint],
  );

  const counts = sectionCounts(pkg);
  const perSection: Record<EditorSection, number> = {
    story: 0,
    voice: 0,
    world: counts.entities + counts.relationships,
    scenes: counts.scenes,
    transfer: 0,
    publish: lint.errors.length,
  };

  const publish = useCallback(async (): Promise<string | null> => {
    const response = await fetch(`/api/stories/${storyId}/manuscript/publish`, {
      method: 'POST',
      headers: session.headers(),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      return typeof body['error'] === 'string'
        ? body['error']
        : `publish failed (${response.status})`;
    }
    const manuscript = body['manuscript'] as Manuscript | undefined;
    if (manuscript !== undefined) {
      updatedAt.current = manuscript.updated_at;
      setBasedOn(manuscript.based_on_version);
    }
    setNextVersion((current) => current + 1);
    // The shell above this screen shows the published version, and the story now has one.
    router.refresh();
    return null;
  }, [router, session, storyId]);

  const discard = useCallback(async (): Promise<string | null> => {
    const response = await fetch(`/api/stories/${storyId}/manuscript`, {
      method: 'DELETE',
      headers: session.headers(),
    });
    const body = (await response.json()) as { story_remains?: boolean; error?: string };
    if (!response.ok) return body.error ?? `discard failed (${response.status})`;
    router.push(body.story_remains === true ? `/stories/${storyId}` : '/');
    return null;
  }, [router, session, storyId]);

  return (
    <>
      <div className="editor-head">
        <span className="meta">
          Draft · {published ? `published through v${basedOn ?? '—'}` : 'never published'} · next
          publish writes v{nextVersion}
        </span>
        <SaveIndicator state={save} canWrite={session.canWrite} onReload={() => router.refresh()} />
      </div>

      <AuthorTokenField session={session} />

      <div className={atList ? 'editor-shell at-list' : 'editor-shell'}>
        <nav className="section-list">
          {EDITOR_SECTIONS.map((entry) => (
            <button
              key={entry}
              type="button"
              className={!atList && entry === section ? 'current' : undefined}
              onClick={() => openSection(entry)}
            >
              <span>{SECTION_LABELS[entry]}</span>
              <span className="count">
                {entry === 'publish'
                  ? perSection.publish === 0
                    ? ''
                    : `${perSection.publish} ✕`
                  : perSection[entry] === 0
                    ? ''
                    : perSection[entry]}
              </span>
            </button>
          ))}
        </nav>

        <div className="section-body">
          <p className="section-back">
            <button type="button" className="tiny" onClick={backToList}>
              ← all sections
            </button>
          </p>

          {section === 'story' ? (
            <StorySection
              pkg={pkg}
              onChange={edit}
              renameable={basedOn === null && !published}
              onRename={rename}
              flagged={flagged}
              busy={save.kind === 'saving'}
            />
          ) : null}
          {section === 'voice' ? <VoiceSection pkg={pkg} onChange={edit} flagged={flagged} /> : null}
          {section === 'world' ? (
            <WorldSection pkg={pkg} onChange={edit} flagged={flagged} focusPath={focusPath} />
          ) : null}
          {section === 'scenes' ? (
            <ScenesSection
              pkg={pkg}
              onChange={edit}
              flagged={flagged}
              problemsFor={problemsFor}
              openSceneId={openScene}
              onOpenScene={showScene}
            />
          ) : null}
          {section === 'transfer' ? (
            <TransferPanel
              storyId={storyId}
              pkg={pkg}
              retainedVersions={retainedVersions}
              onImport={edit}
            />
          ) : null}
          {section === 'publish' ? (
            <PublishSection
              lint={lint}
              nextVersion={nextVersion}
              basedOnVersion={basedOn}
              dirty={dirty || save.kind === 'saving'}
              canWrite={session.canWrite}
              onPublish={publish}
              onDiscard={discard}
              onShowProblem={showProblem}
              published={published}
            />
          ) : null}

          <LintPanel lint={lint} onShowProblem={showProblem} />
        </div>
      </div>
    </>
  );
}

/**
 * What autosave is doing.
 *
 * Autosave is invisible while it works, which means the only thing it has to be loud about is
 * failing — and a conflict is the one failure the author, not a retry, has to resolve.
 */
function SaveIndicator({
  state,
  canWrite,
  onReload,
}: {
  state: SaveState;
  canWrite: boolean;
  onReload: () => void;
}) {
  if (!canWrite) return <span className="save-state">not saving — no author token</span>;

  switch (state.kind) {
    case 'clean':
    case 'saved':
      return <span className="save-state">saved</span>;
    case 'saving':
      return <span className="save-state">saving…</span>;
    case 'error':
      return <span className="save-state bad">not saved — {state.message}</span>;
    case 'conflict':
      return (
        <span className="save-state bad">
          this draft changed somewhere else — nothing here has been saved since
          <button type="button" className="tiny" onClick={onReload}>
            reload it
          </button>
        </span>
      );
  }
}

/**
 * Every problem, always visible, each one a link to the field that owns it.
 *
 * Errors first: an error is the only kind that stops a publish, so it is the only kind with a
 * claim on being read first.
 */
function LintPanel({
  lint,
  onShowProblem,
}: {
  lint: LintResult;
  onShowProblem: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="panel">
      <h3>
        {lint.problems.length === 0
          ? 'Nothing to report'
          : `${lint.errors.length} error${lint.errors.length === 1 ? '' : 's'}, ${lint.warnings.length} warning${lint.warnings.length === 1 ? '' : 's'}`}{' '}
        <button type="button" className="tiny" onClick={() => setOpen(!open)}>
          {open ? 'hide' : 'show'}
        </button>
      </h3>
      {lint.problems.length === 0 ? (
        <p className="meta">
          No cross-reference errors, and nothing flagged for craft. Warnings never block a publish;
          errors always do.
        </p>
      ) : null}
      {!open
        ? null
        : [...lint.errors, ...lint.warnings].map((problem, index) => (
            // Keyed by position: two rows of the same table can report the same path.
            <button
              key={index}
              type="button"
              className={problem.severity === 'error' ? 'lint-problem error' : 'lint-problem'}
              onClick={() => onShowProblem(problem.path)}
            >
              <span className="where">
                {problem.path} · {problem.code}
              </span>
              {problem.message}
            </button>
          ))}
    </div>
  );
}
