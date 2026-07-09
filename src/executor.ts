/**
 * A database executor that runs SQL and returns results.
 * All methods return Promises for a uniform async API.
 */
export interface Executor {
  /** Execute a query and return all matching rows. */
  all(sql: string, params: unknown[]): Promise<unknown[]>;
  /** Execute a query and return a single row or null. */
  get(sql: string, params: unknown[]): Promise<unknown>;
  /** Execute a statement (INSERT, UPDATE, DELETE, DDL). */
  run(sql: string, params: unknown[]): Promise<void>;
  /** Run a callback inside a transaction. */
  transaction(fn: () => void | Promise<void>): Promise<void>;
  /** Close the underlying database connection. No-op if already closed. */
  close(): void;
}
