// -----------------------------------------------------------------------
// flint-orm — public API (shared, driver-agnostic)
// -----------------------------------------------------------------------

// Core: sql template + createClient (for custom driver adapters)
export { sql, createClient } from './flint';
export type { SQLExpression, Executable, SelectBuilder, InsertStage1, UpdateStage1 } from './flint';
export type { Executor } from './executor';

// Schema: table/column definitions (flint-orm/table)
export { text, integer, boolean, json, date, real } from './schema/columns';
export type { ColumnDef, IntegerColumnDef, DateColumnDef, DateColumnDefWithDefault } from './schema/columns';
export { table, index, primaryKey, snakeCase } from './schema/table';
export type { InferRow, InsertRow, TableDef, AnyTable, IndexDef, IndexBuilder, PrimaryKeyBuilder, PrimaryKeyDef } from './schema/table';

// Conditions: eq, and, or, gt, gte, lt, lte, neq, isIn, isNotIn, isNull, isNotNull, like, glob, between (flint-orm/conditions)
export { eq, and, or, gt, gte, lt, lte, neq, isIn, isNotIn, isNull, isNotNull, like, glob, between } from './query/conditions';
export type { Condition } from './query/conditions';

// Aggregates: count, countColumn, sum, avg, min, max (flint-orm/aggregates)
export { count, countColumn, sum, avg, min, max } from './query/aggregates';

// Introspection: read live database schema
export { introspect } from './sqlite/introspect';
