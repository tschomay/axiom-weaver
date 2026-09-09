/**
 * The Vercel Blob `BlobStore`.
 *
 * Three constraints from `docs/research/vercel-runtime.md` §3.2/§3.5 are load-bearing and are
 * honoured here rather than left to callers:
 *
 * - **A private store, read through route handlers.** Sharing a Compiled edition's URL must never
 *   expose the Story Package behind it (ADR 0015 §5), so nothing is world-readable by pathname.
 * - **Every read uses `useCache: false`.** The research file names a stale read as "the single
 *   most likely source of a subtle continuity bug" — a 60-second stale read of the told-ledger
 *   would make the engine re-introduce a fact it already told the reader. Correctness first.
 * - **Never `del()` + `put()` to update.** Overwrites go through `allowOverwrite`.
 */

import { get, head, list, put } from '@vercel/blob';
import { BlobConflictError, type BlobStore } from './blob-store';

export interface VercelBlobStoreOptions {
  /** Falls back to `BLOB_READ_WRITE_TOKEN` in the environment. */
  token?: string;
}

export class VercelBlobStore implements BlobStore {
  private readonly token: string | undefined;

  constructor(options: VercelBlobStoreOptions = {}) {
    this.token = options.token ?? process.env.BLOB_READ_WRITE_TOKEN;
  }

  private get auth(): { token?: string } {
    return this.token === undefined ? {} : { token: this.token };
  }

  async get(pathname: string): Promise<string | null> {
    // Consistent read: bypass the CDN so this reflects the previous scene's write.
    const result = await get(pathname, { ...this.auth, access: 'private', useCache: false });
    if (result === null || result.stream === null) return null;
    return await new Response(result.stream).text();
  }

  async head(pathname: string): Promise<boolean> {
    try {
      await head(pathname, this.auth);
      return true;
    } catch {
      return false;
    }
  }

  async put(
    pathname: string,
    body: string,
    options: { allowOverwrite?: boolean } = {},
  ): Promise<void> {
    const allowOverwrite = options.allowOverwrite === true;
    if (!allowOverwrite && (await this.head(pathname))) {
      throw new BlobConflictError(pathname);
    }
    await put(pathname, body, {
      ...this.auth,
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite,
    });
  }

  async list(prefix: string): Promise<string[]> {
    const pathnames: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ ...this.auth, prefix, cursor });
      pathnames.push(...page.blobs.map((blob) => blob.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor !== undefined);
    return pathnames.sort();
  }
}
