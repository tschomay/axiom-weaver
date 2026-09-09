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
