'use client';

import { useState } from 'react';
import type { LintResult } from '@/authoring/lint';
import { publishReadiness } from '@/authoring/editor-model';

/**
 * Publish, and discard.
 *
 * Both say what they are about to do before they do it. Publish names the `package_version` it
 * will write — `max(retained) + 1`, computed by the route and never by arithmetic here — and says
 * that the bump will flag the Working Draft stale, because that is the consequence an author
 * cannot see from this screen (ADR 0015 §3). Discard says what survives it.
 */
export function PublishSection({
  lint,
  nextVersion,
  basedOnVersion,
  dirty,
  canWrite,
  onPublish,
  onDiscard,
  onShowProblem,
  published,
}: {
  lint: LintResult;
  nextVersion: number;
  basedOnVersion: number | null;
  dirty: boolean;
  canWrite: boolean;
  onPublish: () => Promise<string | null>;
  onDiscard: () => Promise<string | null>;
  onShowProblem: (path: string) => void;
  published: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const readiness = publishReadiness({
    nextVersion,
    errors: lint.errors.length,
    warnings: lint.warnings.length,
    basedOnVersion,
  });

  return (
    <section>
      <h2>Publish</h2>

      <div className="panel">
        <h3>
          This would write package_version {readiness.nextVersion}
          {basedOnVersion === null ? " \u2014 the story's first" : ''}
        </h3>
        <p className="meta">
          A published version is retained forever: a Compiled edition may pin it, and every read of
          that edition has to keep dereferencing. That is why publishing is a separate act from
          saving, and why the version is never one you type.
        </p>
        {readiness.willFlagStale ? (
          <p>
            Publishing bumps the version, which flags <strong>every compiled scene</strong> in the
            Working Draft stale. Staleness propagates bluntly — it does not work out which scenes
            your edits could actually have touched — so expect the whole draft to want recompiling.
          </p>
        ) : (
          <p className="meta">
            Nothing has been compiled against this story yet, so there is no Working Draft for this
            publish to flag stale.
          </p>
        )}
      </div>

      {readiness.ready ? (
        readiness.warnings === 0 ? null : (
          <p className="meta">
            {readiness.warnings} warning{readiness.warnings === 1 ? '' : 's'} stand — warnings never
            block a publish. They are judgments about craft and completeness you are allowed to
            disagree with, or to publish mid-thought.
          </p>
        )
      ) : (
        <div className="panel">
          <h3>
            {readiness.errors} error{readiness.errors === 1 ? '' : 's'} block this publish
          </h3>
          <p className="meta">
            Each is a defect that would otherwise fail at compile time — further from the field that
            caused it, and more expensively.
          </p>
          {lint.errors.map((problem, index) => (
            <button
              // Keyed by position: two rows of the same table can report the same path.
              key={index}
              type="button"
              className="lint-problem error"
              onClick={() => onShowProblem(problem.path)}
            >
              <span className="where">
                {problem.path} · {problem.code}
              </span>
              {problem.message}
            </button>
          ))}
        </div>
      )}

      <div className="row-actions">
        <button
          type="button"
          className="action primary"
          disabled={!readiness.ready || busy || dirty || !canWrite}
          onClick={() => {
            setBusy(true);
            setOutcome(null);
            void onPublish()
              .then((error) =>
                setOutcome(
                  error ?? `Published package_version ${readiness.nextVersion}.`,
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Publish version {readiness.nextVersion}
        </button>
        {dirty ? <span className="meta">saving your last edit first…</span> : null}
      </div>

      {outcome === null ? null : <p className="meta">{outcome}</p>}

      <h2>Discard</h2>
      <p>
        Dropping this draft {published ? 'returns the story to its published package' : ''}
        {published
          ? '. Published versions, the Working Draft and any editions are untouched.'
          : ' removes the story: it has never published, so the draft is all there is of it.'}
      </p>
      <div className="row-actions">
        {confirmDiscard ? (
          <>
            <button
              type="button"
              className="action"
              disabled={busy || !canWrite}
              onClick={() => {
                setBusy(true);
                void onDiscard()
                  .then((error) => setOutcome(error))
                  .finally(() => setBusy(false));
              }}
            >
              Yes, discard {published ? 'the draft' : 'this story'}
            </button>
            <button type="button" className="action" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </button>
          </>
        ) : (
          <button
            type="button"
            className="action"
            disabled={busy || !canWrite}
            onClick={() => setConfirmDiscard(true)}
          >
            Discard this draft
          </button>
        )}
      </div>
    </section>
  );
}
