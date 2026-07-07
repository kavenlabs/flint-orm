// -----------------------------------------------------------------------
// flint-orm — public API
// -----------------------------------------------------------------------

// Main entry: flint() factory + sql template
export { flint, sql } from './flint';
export type { ConnectionDetails, SQLExpression, Executable, SelectStage1, InsertStage1, UpdateStage1 } from './flint';

// Schema: table/column definitions (flint-orm/table)
export { text, integer, boolean, json, date, real } from './schema/columns';
export type { ColumnDef, IntegerColumnDef, DateColumnDef, DateColumnDefWithDefault } from './schema/columns';
export { table, snakeCase } from './schema/table';
export type { InferRow, InsertRow, TableDef, AnyTable } from './schema/table';

// Conditions: eq, and, or, gt, gte, lt, lte, neq, isIn, isNotIn, isNull, isNotNull, like, glob, between (flint-orm/conditions)
export { eq, and, or, gt, gte, lt, lte, neq, isIn, isNotIn, isNull, isNotNull, like, glob, between } from './query/conditions';
export type { Condition } from './query/conditions';

// Aggregates: count, countColumn, sum, avg, min, max (flint-orm/aggregates)
export { count, countColumn, sum, avg, min, max } from './query/aggregates';
