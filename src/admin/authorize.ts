/**
 * Authorization for the phone-usable admin routes under `/admin`.
 *
 * There is no separate admin secret to create or rotate — the check reuses
 * `BLOB_READ_WRITE_TOKEN`. Whoever holds that token already has full read/write access to the
 * Blob store directly (via the SDK or the Vercel dashboard), so comparing against it grants an
 * admin route no capability beyond what the token already carries; it's only a convenient
 * trigger for someone who has the token but no terminal.
 */

import { timingSafeEqual } from 'node:crypto';

/**
 * Whether a submitted token matches the server's `BLOB_READ_WRITE_TOKEN`.
 *
 * Both empty/undefined always fails closed — an unset env var (e.g. local dev, where the
 * filesystem store needs no token at all) must never make every submitted value "authorized".
 */
export function isAuthorizedAdminRequest(
  submittedToken: string | null | undefined,
  envToken: string | undefined = process.env.BLOB_READ_WRITE_TOKEN,
): boolean {
  if (!envToken || !submittedToken) return false;

  const submitted = Buffer.from(submittedToken);
  const expected = Buffer.from(envToken);
  // timingSafeEqual throws on a length mismatch rather than returning false.
  if (submitted.length !== expected.length) return false;
  return timingSafeEqual(submitted, expected);
}

/** Pull the bearer token out of a Fetch API Request's Authorization header. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1] ?? null;
}

/**
 * Whether this process is a local, single-author instance.
 *
 * `BLOB_READ_WRITE_TOKEN` does double duty: it selects the Vercel Blob store
 * (`createBlobStore`) *and* is the admin secret. So a local run cannot set it to authorize a
 * write without also pointing every write at the shared production store — which is exactly the
 * bind ADR 0016's author surfaces walk into, since they are write surfaces an author is meant to
 * use, not an occasional phone-only admin trigger.
 *
 * Unset, in a non-production build, the store is the filesystem under `BLOB_LOCAL_ROOT`: a
 * developer's own working copy, with nothing in it anyone else can reach. There is no secret to
 * check because there is nothing shared to protect. A production build always requires the token,
 * whether or not one is configured — an unset variable there fails closed, as before.
 */
export function isLocalAuthorInstance(
  env: { NODE_ENV?: string | undefined; BLOB_READ_WRITE_TOKEN?: string | undefined } = process.env,
): boolean {
  return env.NODE_ENV !== 'production' && !env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Whether a request may write through an author surface (ADR 0016 §1's four surfaces).
 *
 * ADR 0015 §5's rule is unchanged — only the author compiles, resolves a proposal or promotes an
 * edition — this only says how that author is recognized: by the same `BLOB_READ_WRITE_TOKEN`
 * every other write surface uses, or by being the sole occupant of a local filesystem instance.
 */
export function isAuthorizedAuthorRequest(
  submittedToken: string | null | undefined,
  env: { NODE_ENV?: string | undefined; BLOB_READ_WRITE_TOKEN?: string | undefined } = process.env,
): boolean {
  if (isLocalAuthorInstance(env)) return true;
  return isAuthorizedAdminRequest(submittedToken, env.BLOB_READ_WRITE_TOKEN);
}
