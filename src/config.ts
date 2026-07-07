// ---------------------------------------------------------------------------
// flint-orm config types
// ---------------------------------------------------------------------------

export interface FlintConfig {
  /** Path to schema folder or file containing table() exports. */
  schema: string;

  /** Path to the migrations directory. Defaults to "./flint". */
  migrations?: string;
}

/**
 * Define a flint-orm config with type checking and autocomplete.
 *
 * @example
 * import { defineConfig } from "flint-orm/config";
 *
 * export default defineConfig({
 *   schema: "./src/schema",
 * });
 */
export function defineConfig(config: FlintConfig): FlintConfig {
  return config;
}
