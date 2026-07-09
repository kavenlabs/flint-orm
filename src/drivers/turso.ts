// ---------------------------------------------------------------------------
// @tursodatabase/database driver adapter
// ---------------------------------------------------------------------------

import { connect } from '@tursodatabase/database';
import type { Database } from '@tursodatabase/database';
import type { Executor } from '../executor';
import { createClient } from '../flint';

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

  async run(sql: string, params: unknown[]): Promise<void> {
    await this.#db.run(sql, ...sanitize(params));
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
 * @example
 * import { flint } from 'flint-orm/turso'
 * const db = await flint({ url: './app.db' })
 */
export async function flint(details: { url: string }) {
  const db = await connect(details.url);
  return createClient(new TursoExecutor(db));
}
