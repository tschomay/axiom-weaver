import { NextResponse } from 'next/server';
import { isLocalAuthorInstance } from '@/admin/authorize';

export const dynamic = 'force-dynamic';

/**
 * What an author surface needs to know before it offers a write action: whether this instance
 * wants a token at all.
 *
 * A local filesystem-backed instance has no shared store to protect and no token to type
 * (`isLocalAuthorInstance`); a deployment always does. Saying so up front is the difference
 * between a form the author fills in for a reason and one that rejects them for leaving it blank.
 */
export function GET() {
  return NextResponse.json({ token_required: !isLocalAuthorInstance() });
}
