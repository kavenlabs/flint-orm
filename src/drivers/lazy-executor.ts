// ---------------------------------------------------------------------------
// Lazy executor — defers connection to first query
// ---------------------------------------------------------------------------

import type { Executor } from '../executor';

/**
 * Wraps an async executor factory, deferring connection until first use.
 * This lets flint() be synchronous even for async drivers.
 */
export class LazyExecutor implements Executor {
  #factory: () => Promise<Executor>;
  #executor?: Executor;
  #promise?: Promise<Executor>;

  constructor(factory: () => Promise<Executor>) {
    this.#factory = factory;
  }

  async #resolve(): Promise<Executor> {
    if (this.#executor) return this.#executor;
    if (!this.#promise) {
      this.#promise = this.#factory().then((exec) => {
        this.#executor = exec;
        return exec;
      });
    }
    return this.#promise;
  }

  async all(sql: string, params: unknown[]): Promise<unknown[]> {
    const exec = await this.#resolve();
    return exec.all(sql, params);
  }

  async get(sql: string, params: unknown[]): Promise<unknown> {
    const exec = await this.#resolve();
    return exec.get(sql, params);
  }

  async run(sql: string, params: unknown[]): Promise<{ rowsAffected: number }> {
    const exec = await this.#resolve();
    return exec.run(sql, params);
  }

  async transaction(fn: () => void | Promise<void>): Promise<void> {
    const exec = await this.#resolve();
    return exec.transaction(fn);
  }

  close(): void {
    this.#executor?.close();
  }
}
