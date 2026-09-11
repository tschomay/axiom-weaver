/**
 * The blob store interface.
 *
 * `docs/research/vercel-runtime.md` §3.5 models the "normalized JSON tables written *as if* SQL"
 * as blob path prefixes: the table is the prefix, the primary key is the pathname. Everything
 * above this interface talks in those paths, so swapping Vercel Blob for Postgres later stays
 * mechanical, as the map requires.
 */

export interface BlobStore {
  /** Read a JSON document, or `null` if the pathname holds nothing. */
  get(pathname: string): Promise<string | null>;
  /**
   * Write a JSON document.
   *
   * `allowOverwrite` is explicit because Vercel Blob blocks overwrites by default and because
   * the caller's intent matters here: a retained `package_version` snapshot is immutable and
   * must never be overwritten, while a pointer or a Working Draft log is overwritten every save.
   */
  put(pathname: string, body: string, options?: { allowOverwrite?: boolean }): Promise<void>;
  /** Pathnames under a prefix. */
  list(prefix: string): Promise<string[]>;
  /** Whether a pathname holds anything. */
  head(pathname: string): Promise<boolean>;
  /**
   * Delete a document. A no-op when the pathname holds nothing.
   *
   * This is not the `del()` + `put()` update the Vercel store's own notes forbid — that is a
   * *rewrite* pretending to be two operations. This is a genuine removal, and the one caller is
   * discarding a Manuscript (ADR 0017 §9). No retained snapshot is ever removed through it.
   */
  remove(pathname: string): Promise<void>;
}

export class BlobConflictError extends Error {
  constructor(pathname: string) {
    super(`Refusing to overwrite existing blob "${pathname}"`);
    this.name = 'BlobConflictError';
  }
}
