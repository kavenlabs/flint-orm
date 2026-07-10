// ---------------------------------------------------------------------------
// bun:sqlite driver adapter
// ---------------------------------------------------------------------------

import { Database } from 'bun:sqlite';
import type { DatabaseOptions, SQLQueryBindings } from 'bun:sqlite';
import type { Executor } from '../executor';
import { createClient } from '../flint';

/** Synchronous executor backed by bun:sqlite, wrapped in Promises for uniform API. */
export class BunSqliteExecutor implements Executor {
  #client: Database;

  constructor(client: Database) {
    this.#client = client;
  }

  all(sql: string, params: unknown[]): Promise<unknown[]> {
    return Promise.resolve(this.#client.prepare(sql).all(...(params as SQLQueryBindings[])));
  }

  get(sql: string, params: unknown[]): Promise<unknown> {
    return Promise.resolve(this.#client.prepare(sql).get(...(params as SQLQueryBindings[])));
  }

  run(sql: string, params: unknown[]): Promise<void> {
    this.#client.prepare(sql).run(...(params as SQLQueryBindings[]));
    return Promise.resolve();
  }

  transaction(fn: () => void | Promise<void>): Promise<void> {
    this.#client.run('BEGIN');
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.then(
          () => {
            this.#client.run('COMMIT');
          },
          (err) => {
            this.#client.run('ROLLBACK');
            throw err;
          },
        );
      }
      this.#client.run('COMMIT');
      return Promise.resolve();
    } catch (err) {
      this.#client.run('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.#client.close();
  }
}

/**
 * Create a flint database client using bun:sqlite.
 *
 * @example
 * import { flint } from 'flint-orm/bun-sqlite'
 * const db = flint({ url: './app.db' })
 */
export function flint(options: { url: string } & DatabaseOptions) {
  const { url, ...opts } = options;
  const client = new Database(url, Object.keys(opts).length ? opts : undefined);
  return createClient(new BunSqliteExecutor(client));
}
