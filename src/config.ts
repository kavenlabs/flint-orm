// ---------------------------------------------------------------------------
// flint-orm config types
// ---------------------------------------------------------------------------

export interface FlintConfig {
  /** Path to the SQLite database file. */
  url: string;

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
 *   url: "./app.db",
 *   schema: "./src/schema",
 * });
 */
export function defineConfig(config: FlintConfig): FlintConfig {
  return config;
}
