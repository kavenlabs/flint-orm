// ---------------------------------------------------------------------------
// @tursodatabase/database driver adapter
// ---------------------------------------------------------------------------

import { connect } from '@tursodatabase/database';
import type { Database } from '@tursodatabase/database';
import type { Executor } from '../executor';
import { createClient } from '../flint';
import { LazyExecutor } from './lazy-executor';

/** Convert undefined params to null — @tursodatabase/database rejects undefined. */
function sanitize(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}

/** Async executor backed by @tursodatabase/database. */
export class TursoExecutor implements Executor {
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

/**
 * Create a flint database client using @tursodatabase/database.
 *
 * Connection is established lazily on first query.
 *
 * @example
 * import { flint } from 'flint-orm/turso'
 * const db = flint({ url: './app.db' })
 */
export function flint(options: { url: string } & Parameters<typeof connect>[1]) {
  const { url, ...opts } = options;
  const executor = new LazyExecutor(async () => {
    const db = await connect(url, Object.keys(opts).length ? (opts as Parameters<typeof connect>[1]) : undefined);
    return new TursoExecutor(db);
  });
  return createClient(executor);
}
