// ---------------------------------------------------------------------------
// @tursodatabase/sync driver adapter
// ---------------------------------------------------------------------------

import { connect } from '@tursodatabase/sync';
import type { Database, DatabaseOpts } from '@tursodatabase/sync';
import { resolve } from 'node:path';
import type { Executor } from '../executor';
import { createClient } from '../flint';
import { LazyExecutor } from './lazy-executor';

/** Convert undefined params to null — @tursodatabase/sync rejects undefined. */
function sanitize(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}

/** Async executor backed by @tursodatabase/sync. */
export class TursoSyncExecutor implements Executor {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async all(sql: string, params: unknown[]): Promise<unknown[]> {
    return this.#db.all(sql, ...sanitize(params));
  }

  async get(sql: string, params: unknown[]): Promise<unknown> {
    return this.#db.get(sql, ...sanitize(params)) ?? null;
  }

  async run(sql: string, params: unknown[]): Promise<{ rowsAffected: number }> {
    const result = await this.#db.run(sql, ...sanitize(params));
    return { rowsAffected: result.changes };
  }

  async transaction(fn: () => void | Promise<void>): Promise<void> {
    await this.#db.exec('BEGIN');
    try {
      await fn();
      await this.#db.exec('COMMIT');
    } catch (e) {
      await this.#db.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.#db.close();
  }
}

export interface TursoSyncOptions extends Omit<DatabaseOpts, 'path' | 'url' | 'authToken'> {
  /** Local path for the synced database files (maps to `path` in `@tursodatabase/sync`). */
  url: string;
  /** Remote Turso database URL (maps to `url` in `@tursodatabase/sync`). */
  syncUrl?: string;
  /** Auth token for the remote database. */
  authToken?: DatabaseOpts['authToken'];
}

/**
 * Create a flint database client using @tursodatabase/sync.
 *
 * Connection is established lazily on first query.
 *
 * @example
 * import { flint } from 'flint-orm/turso-sync'
 * const db = flint({ url: './local.db', syncUrl: 'libsql://db.turso.io', authToken: '...' })
 */
export function flint(options: TursoSyncOptions) {
  const { url, syncUrl, authToken, ...rest } = options;
  const localPath = url.includes('://') ? url : resolve(url);
  const executor = new LazyExecutor(async () => {
    const db = await connect({
      path: localPath,
      url: syncUrl,
      authToken,
      ...rest,
    });
    return new TursoSyncExecutor(db);
  });
  return createClient(executor);
}
