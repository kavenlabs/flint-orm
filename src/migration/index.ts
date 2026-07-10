// ---------------------------------------------------------------------------
// flint-orm/migration — public API for the migration system
// ---------------------------------------------------------------------------

export { defineMigration } from './migration.js';
export { serializeSchema } from './serialize.js';
export { diffSchemas, emptyState, resolveRenames, CancellationError } from './diff.js';
export type { RenamePrompt } from './diff.js';
export { generateSQL } from './sql.js';
export { generate } from './generate.js';
export type { GenerateOptions } from './generate.js';
export { migrate, getMigrationStatus } from './migrate.js';
export type { MigrateOptions, MigrateResult, MigrationStatus } from './migrate.js';
export {
  addTable,
  dropTable,
  renameTable,
  addColumn,
  dropColumn,
  renameColumn,
  createIndex,
  dropIndex,
  modifyColumn,
  modifyIndex,
  rebuildTable,
} from './operations.js';
export type {
  SchemaState,
  SerializedColumn,
  SerializedTable,
  SerializedIndex,
  MigrationOperation,
  MigrationFile,
  ModifyColumnOp,
  ModifyIndexOp,
  RebuildTableOp,
} from './types.js';
