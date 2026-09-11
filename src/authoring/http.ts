/**
 * Turning the authoring module's errors into the statuses a surface can act on.
 *
 * Every authoring route reports failure the same way, because the screen's response to each is
 * different: a 409 means reload and merge, a 422 means put the author on a field, a 400 means the
 * request was malformed. One place decides which is which so four routes cannot drift.
 */

import { ManuscriptConflictError } from '../persistence/story-repository';
import { ManuscriptSeedError, PublishRejectedError } from './manuscript';
import type { LintResult } from './lint';

export interface ErrorBody {
  readonly error: string;
  readonly reason?: string;
  readonly stored_updated_at?: string | null;
  readonly lint?: LintResult;
}

export interface MappedError {
  readonly status: number;
  readonly body: ErrorBody;
}

const SEED_STATUS: Record<ManuscriptSeedError['reason'], number> = {
  story_id_taken: 409,
  story_not_found: 404,
  version_not_found: 404,
  invalid_story_id: 400,
};

/** `null` for an error this module does not own — the caller rethrows rather than guessing. */
export function mapAuthoringError(error: unknown): MappedError | null {
  if (error instanceof ManuscriptConflictError) {
    // The stored timestamp goes back so the screen can offer to reload rather than assert that
    // something unspecified went wrong (ADR 0017 §8).
    return {
      status: 409,
      body: {
        error: error.message,
        reason: 'manuscript_conflict',
        stored_updated_at: error.storedUpdatedAt,
      },
    };
  }
  if (error instanceof PublishRejectedError) {
    // The lint result, not a bare message: the screen's job is to put the author on the field.
    return {
      status: 422,
      body: { error: error.message, reason: 'lint_rejected', lint: error.lint },
    };
  }
  if (error instanceof ManuscriptSeedError) {
    return { status: SEED_STATUS[error.reason], body: { error: error.message, reason: error.reason } };
  }
  return null;
}
