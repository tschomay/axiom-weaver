import { describe, expect, it } from 'vitest';
import { bearerToken, isAuthorizedAdminRequest } from '@/admin/authorize';

describe('isAuthorizedAdminRequest', () => {
  it('authorizes a submitted token that matches the env token', () => {
    expect(isAuthorizedAdminRequest('secret-token', 'secret-token')).toBe(true);
  });

  it('rejects a mismatched token', () => {
    expect(isAuthorizedAdminRequest('wrong', 'secret-token')).toBe(false);
  });

  it('rejects when no env token is configured — never authorize against nothing', () => {
    // Local dev has no BLOB_READ_WRITE_TOKEN at all; an empty submission must not match it.
    expect(isAuthorizedAdminRequest('', undefined)).toBe(false);
    expect(isAuthorizedAdminRequest('anything', undefined)).toBe(false);
  });

  it('rejects an empty or missing submission even when an env token exists', () => {
    expect(isAuthorizedAdminRequest('', 'secret-token')).toBe(false);
    expect(isAuthorizedAdminRequest(null, 'secret-token')).toBe(false);
    expect(isAuthorizedAdminRequest(undefined, 'secret-token')).toBe(false);
  });

  it('rejects a token of different length without throwing', () => {
    expect(isAuthorizedAdminRequest('short', 'a-much-longer-secret-token')).toBe(false);
  });
});

describe('bearerToken', () => {
  it('extracts the token from a well-formed Authorization header', () => {
    const request = new Request('https://example.test', {
      headers: { authorization: 'Bearer abc123' },
    });
    expect(bearerToken(request)).toBe('abc123');
  });

  it('returns null when the header is absent or malformed', () => {
    expect(bearerToken(new Request('https://example.test'))).toBeNull();
    expect(
      bearerToken(new Request('https://example.test', { headers: { authorization: 'abc123' } })),
    ).toBeNull();
    expect(
      bearerToken(
        new Request('https://example.test', { headers: { authorization: 'Basic abc123' } }),
      ),
    ).toBeNull();
  });
});
