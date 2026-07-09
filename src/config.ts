// ---------------------------------------------------------------------------
// flint-orm config types
// ---------------------------------------------------------------------------

export type Driver = 'bun-sqlite' | 'better-sqlite3' | 'libsql' | 'libsql-web' | 'turso-sync' | 'turso';

export interface DatabaseConfig {
  /** Path or URL to the SQLite database. */
  url: string;
  /** Auth token (required for libsql, libsql-web, turso-sync drivers). */
  authToken?: string;
}

export interface FlintConfig {
  /** Which SQLite driver to use. */
  driver: Driver;

  /** Database connection details. */
  database: DatabaseConfig;

  /** Path to schema folder or file containing table() exports. */
  schema: string;

  /** Path to the migrations directory. Defaults to "./flint". */
  migrations?: string;
}

/**
 * Define a flint-orm config.
 *
 * @example
 * import { defineConfig } from "flint-orm/config";
 *
 * export default defineConfig({
 *   driver: "bun-sqlite",
 *   database: { url: "./app.db" },
 *   schema: "./src/schema",
 * });
 */
export function defineConfig(config: FlintConfig): FlintConfig {
  return config;
}
