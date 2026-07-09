// ---------------------------------------------------------------------------
// @libsql/client/web driver adapter
// ---------------------------------------------------------------------------

import { createClient as createLibsqlClient } from '@libsql/client/web';
import type { Client } from '@libsql/client';
import type { Executor } from '../executor';
import { createClient } from '../flint';

/** Convert undefined params to null — @libsql/client rejects undefined. */
function sanitize(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}

/** Async executor backed by @libsql/client/web. */
export class LibsqlWebExecutor implements Executor {
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

export interface LibSQLWebConnectionDetails {
  /** Database URL — must use ws:, wss:, http:, or https: scheme. */
  url: string;
  authToken?: string;
}

/**
 * Create a flint database client using @libsql/client/web.
 *
 * **Note:** The web client only supports `ws:`, `wss:`, `http:`, and `https:` URLs.
 * `file:` URLs are not supported — use the `flint-orm/libsql` entry point for local SQLite files.
 *
 * @example
 * import { flint } from 'flint-orm/libsql-web'
 * const db = flint({ url: 'libsql://your-db.turso.io', authToken: '...' })
 */
export function flint(details: LibSQLWebConnectionDetails) {
  const client = createLibsqlClient({ url: details.url, authToken: details.authToken });
  return createClient(new LibsqlWebExecutor(client));
}
