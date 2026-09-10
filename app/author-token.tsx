'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The author's write credential, shared by all four surfaces.
 *
 * ADR 0015 §5 is the rule — only the author compiles, resolves a proposal or promotes an edition
 * — and `src/admin/authorize.ts` is where "who is the author" is decided. A deployment wants the
 * same `BLOB_READ_WRITE_TOKEN` every other write surface uses; a local filesystem instance has no
 * shared store to protect and asks for nothing. The surfaces ask which of the two they are in
 * rather than guessing, so the field only appears where it means something.
 *
 * The token is kept in `sessionStorage`: it survives moving between the four surfaces, and it
 * does not outlive the tab.
 */
const STORAGE_KEY = 'axiom-weaver.author-token';

export interface AuthorSession {
  /** `null` until the instance has answered. */
  readonly tokenRequired: boolean | null;
  readonly token: string;
  readonly setToken: (token: string) => void;
  /** Whether a write may be attempted at all. */
  readonly canWrite: boolean;
  readonly headers: () => Record<string, string>;
}

export function useAuthorSession(): AuthorSession {
  const [tokenRequired, setTokenRequired] = useState<boolean | null>(null);
  const [token, setTokenState] = useState('');

  useEffect(() => {
    let cancelled = false;
    // Both reads land together, once the instance has answered: until then no surface offers a
    // write and the field is not rendered, so there is nothing for a restored token to fill in.
    void fetch('/api/author/session')
      .then((response) => response.json() as Promise<{ token_required?: boolean }>)
      .then((body) => body.token_required ?? true)
      .catch(() => true)
      .then((required) => {
        if (cancelled) return;
        setTokenRequired(required);
        try {
          setTokenState(window.sessionStorage.getItem(STORAGE_KEY) ?? '');
        } catch {
          // A browser with site data blocked still authors fine; it just retypes the token.
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setToken = useCallback((next: string) => {
    setTokenState(next);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, next);
    } catch {
      // As above — losing the convenience is not losing the capability.
    }
  }, []);

  const headers = useCallback((): Record<string, string> => {
    const base: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token.length > 0) base['Authorization'] = `Bearer ${token}`;
    return base;
  }, [token]);

  return {
    tokenRequired,
    token,
    setToken,
    canWrite: tokenRequired === false || token.length > 0,
    headers,
  };
}

export function AuthorTokenField({ session }: { session: AuthorSession }) {
  if (session.tokenRequired !== true) return null;

  return (
    <div className="token-field">
      <label className="meta" htmlFor="author-token">
        author token
      </label>
      <input
        id="author-token"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="vercel_blob_rw_…"
        value={session.token}
        onChange={(event) => session.setToken(event.target.value)}
      />
      <span className="meta">needed to compile, resolve a proposal, or promote a run</span>
    </div>
  );
}
