// ---------------------------------------------------------------------------
// better-sqlite3 driver adapter
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3';
import type { Executor } from '../executor';
import { createClient } from '../flint';

/** Synchronous executor backed by better-sqlite3, wrapped in Promises for uniform API. */
export class BetterSqlite3Executor implements Executor {
  #client: Database.Database;

  constructor(client: Database.Database) {
    this.#client = client;
  }

  all(sql: string, params: unknown[]): Promise<unknown[]> {
    return Promise.resolve(this.#client.prepare(sql).all(...params));
  }

  get(sql: string, params: unknown[]): Promise<unknown> {
    return Promise.resolve(this.#client.prepare(sql).get(...params));
  }

  run(sql: string, params: unknown[]): Promise<void> {
    this.#client.prepare(sql).run(...params);
    return Promise.resolve();
  }

  transaction(fn: () => void | Promise<void>): Promise<void> {
    this.#client.exec('BEGIN');
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.then(
          () => {
            this.#client.exec('COMMIT');
          },
          (err) => {
            this.#client.exec('ROLLBACK');
            throw err;
          },
        );
      }
      this.#client.exec('COMMIT');
      return Promise.resolve();
    } catch (err) {
      this.#client.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.#client.close();
  }
}

/**
 * Create a flint database client using better-sqlite3.
 *
 * @example
 * import { flint } from 'flint-orm/better-sqlite3'
 * const db = flint({ url: './app.db' })
 */
export function flint(details: { url: string }) {
  const client = new Database(details.url);
  return createClient(new BetterSqlite3Executor(client));
}
