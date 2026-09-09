/**
 * Store selection.
 *
 * Vercel Blob when a token is configured, the filesystem store otherwise — same interface, same
 * pathnames, so the fixture load and the tests run with no token and no network.
 */

import { FileSystemBlobStore } from './fs-blob-store';
import { VercelBlobStore } from './vercel-blob-store';
import { StoryRepository } from './story-repository';
import type { BlobStore } from './blob-store';

export const DEFAULT_LOCAL_ROOT = '.data';

export function createBlobStore(): BlobStore {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return new VercelBlobStore();
  }
  return new FileSystemBlobStore(process.env.BLOB_LOCAL_ROOT ?? DEFAULT_LOCAL_ROOT);
}

let cached: StoryRepository | null = null;

/** The process-wide repository. */
export function storyRepository(): StoryRepository {
  cached ??= new StoryRepository(createBlobStore());
  return cached;
}

export * from './blob-store';
export * from './paths';
export { FileSystemBlobStore, VercelBlobStore, StoryRepository };
