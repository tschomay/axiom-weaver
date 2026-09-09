'use client';

import { useState } from 'react';

type Result =
  | { story_id: string; ok: true; package_version: number; scenes: number; entities: number }
  | { story_id: string; ok: false; error: string };

export default function LoadFixturesPage() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [results, setResults] = useState<Result[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setMessage(null);
    setResults(null);

    try {
      const response = await fetch('/api/admin/load-fixtures', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json()) as { results?: Result[]; error?: string };

      if (!response.ok) {
        setStatus('error');
        setMessage(body.error ?? `Request failed (${response.status})`);
        return;
      }

      setResults(body.results ?? []);
      setStatus('done');
    } catch {
      setStatus('error');
      setMessage('Network error — check your connection and try again.');
    }
  }

  return (
    <main>
      <h1>Load fixtures</h1>
      <p className="lede">
        Retains <code>fixtures/cinderella</code> and <code>fixtures/a-christmas-carol</code> into
        this deployment&apos;s Blob store. Safe to run more than once — an unchanged
        <code> package_version</code> is a no-op.
      </p>

      <form onSubmit={submit} className="admin-form">
        <label htmlFor="token">Blob read-write token</label>
        <input
          id="token"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="vercel_blob_rw_..."
          required
        />
        <button type="submit" disabled={status === 'loading' || token.length === 0}>
          {status === 'loading' ? 'Loading…' : 'Load fixtures'}
        </button>
      </form>

      {message !== null && <p className="admin-error">{message}</p>}

      {results !== null && (
        <div className="story">
          {results.map((result) => (
            <p key={result.story_id} className="meta">
              {result.ok
                ? `✓ ${result.story_id} — package_version ${result.package_version}, ${result.scenes} scenes, ${result.entities} entities`
                : `✗ ${result.story_id} — ${result.error}`}
            </p>
          ))}
        </div>
      )}
    </main>
  );
}
