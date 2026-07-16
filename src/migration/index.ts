// ---------------------------------------------------------------------------
// flint-orm/migration — public API for the migration system
// ---------------------------------------------------------------------------

export { defineMigration } from './migration';
export { serializeSchema } from './serialize';
export { diffSchemas, emptyState, resolveRenames, CancellationError } from './diff';
export type { RenamePrompt } from './diff';
export { generateSQL } from './sql';
export { generate } from './generate';
export type { GenerateOptions } from './generate';
export { migrate, getMigrationStatus } from './migrate';
export type { MigrateOptions, MigrateResult, MigrationStatus } from './migrate';
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
} from './operations';
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
} from './types';
