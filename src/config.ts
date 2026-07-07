// ---------------------------------------------------------------------------
// flint-orm config types
// ---------------------------------------------------------------------------

export interface FlintConfig {
  /** Path to schema folder or file containing table() exports. */
  schema: string;

  /** Path to the migrations directory. Defaults to "./migrations". */
  migrations: string;
}

/**
 * Define a flint-orm config with type checking and autocomplete.
 *
 * @example
 * import { defineConfig } from "flint-orm/config";
 *
 * export default defineConfig({
 *   schema: "./src/schema",
 *   migrations: "./migrations",
 * });
 */
export function defineConfig(config: FlintConfig): FlintConfig {
  return config;
}
