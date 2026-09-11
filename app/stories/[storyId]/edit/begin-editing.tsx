'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthorTokenField, useAuthorSession } from '../../../author-token';

/**
 * Opening an edit on a published story.
 *
 * Seeding the Manuscript is a write, so it is an act the author takes rather than a side effect of
 * visiting a URL — which also means the token field has somewhere to be before the first write,
 * instead of the screen discovering it needs one halfway through an autosave.
 */
export function BeginEditing({
  storyId,
  title,
  version,
}: {
  storyId: string;
  title: string;
  version: number;
}) {
  const router = useRouter();
  const session = useAuthorSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section>
      <h2>Edit {title}</h2>
      <p>
        This opens a draft of package_version {version}. Edits go to the draft and nothing else:
        the published version, the Working Draft and any editions pinned to it stay exactly as they
        are until you publish.
      </p>

      <AuthorTokenField session={session} />

      <div className="row-actions">
        <button
          type="button"
          className="action primary"
          disabled={busy || !session.canWrite}
          onClick={() => {
            setBusy(true);
            setError(null);
            void fetch('/api/manuscripts', {
              method: 'POST',
              headers: session.headers(),
              body: JSON.stringify({ source: 'edit', story_id: storyId }),
            })
              .then(async (response) => {
                if (response.ok) {
                  router.refresh();
                  return;
                }
                const body = (await response.json()) as { error?: string };
                setError(body.error ?? `could not start editing (${response.status})`);
              })
              .catch((reason: unknown) =>
                setError(reason instanceof Error ? reason.message : 'could not start editing'),
              )
              .finally(() => setBusy(false));
          }}
        >
          Start editing
        </button>
      </div>

      {error === null ? null : <p className="admin-error">{error}</p>}
    </section>
  );
}
