// ---------------------------------------------------------------------------
// @libsql/client driver adapter
// ---------------------------------------------------------------------------

import { createClient as createLibsqlClient } from '@libsql/client';
import type { Client, Config } from '@libsql/client';
import { resolve } from 'node:path';
import type { Executor } from '../executor';
import { createClient } from '../flint';

/** Convert undefined params to null — @libsql/client rejects undefined. */
function sanitize(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}

/** @internal Normalize file paths to file: URLs for @libsql/client. */
function normalizeUrl(url: string): string {
  // Already has a scheme (libsql://, file://, http://, etc.)
  if (url.includes('://')) return url;
  // Raw file path — resolve to absolute and wrap in file: scheme

  return `file:${resolve(url)}`;
}

/** Async executor backed by `@libsql/client`. */
export class LibsqlExecutor implements Executor {
  #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  async all(sql: string, params: unknown[]): Promise<unknown[]> {
    const result = await this.#client.execute({ sql, args: sanitize(params) as never[] });
    return result.rows;
  }

  async get(sql: string, params: unknown[]): Promise<unknown> {
    const result = await this.#client.execute({ sql, args: sanitize(params) as never[] });
    return result.rows[0] ?? null;
  }

  async run(sql: string, params: unknown[]): Promise<void> {
    await this.#client.execute({ sql, args: sanitize(params) as never[] });
  }

  async transaction(fn: () => void | Promise<void>): Promise<void> {
    await this.#client.execute('BEGIN');
    try {
      await fn();
      await this.#client.execute('COMMIT');
    } catch (e) {
      await this.#client.execute('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.#client.close();
  }
}

/**
 * Create a flint database client using @libsql/client.
 *
 * @example
 * import { flint } from 'flint-orm/libsql'
 * const db = flint({ url: 'libsql://your-db.turso.io', authToken: '...' })
 */
export function flint(options: Config) {
  const client = createLibsqlClient({ ...options, url: normalizeUrl(options.url) });
  return createClient(new LibsqlExecutor(client));
}
