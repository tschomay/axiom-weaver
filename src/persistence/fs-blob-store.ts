/**
 * A filesystem-backed `BlobStore` for local development and tests.
 *
 * Same pathnames, same overwrite semantics, no network and no token. The Working Draft, the
 * retained package snapshots, and the state logs all behave identically here and on Vercel Blob,
 * which is what lets the fixture load run offline.
 */

import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { BlobConflictError, type BlobStore } from './blob-store';

export class FileSystemBlobStore implements BlobStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private resolvePath(pathname: string): string {
    const target = resolve(this.root, pathname);
    const rel = relative(this.root, target);
    if (rel.startsWith('..') || resolve(target) === resolve(this.root)) {
      throw new Error(`Blob pathname "${pathname}" escapes the store root`);
    }
    return target;
  }

  async get(pathname: string): Promise<string | null> {
    try {
      return await readFile(this.resolvePath(pathname), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async put(
    pathname: string,
    body: string,
    options: { allowOverwrite?: boolean } = {},
  ): Promise<void> {
    const target = this.resolvePath(pathname);
    if (options.allowOverwrite !== true && (await this.head(pathname))) {
      throw new BlobConflictError(pathname);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body, 'utf8');
  }

  async head(pathname: string): Promise<boolean> {
    try {
      await stat(this.resolvePath(pathname));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          found.push(relative(this.root, full).split(sep).join('/'));
        }
      }
    };
    await walk(this.root);
    return found.filter((pathname) => pathname.startsWith(prefix)).sort();
  }
}
