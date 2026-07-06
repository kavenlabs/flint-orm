// -----------------------------------------------------------------------
// flint-orm — public API
// -----------------------------------------------------------------------

// Main entry: flint() factory + sql template
export { flint, sql } from "./flint";
export type { ConnectionDetails, SQLExpression, Executable, SelectStage1, JoinSelectStage1, JoinBuilder, SingleJoinBuilder, JoinResult } from "./flint";

// Schema: table/column definitions (flint-orm/table)
export { text, integer, boolean, json, real } from "./schema/columns";
export type { ColumnDef } from "./schema/columns";
export { table } from "./schema/table";
export type { InferRow, TableDef } from "./schema/table";

// Conditions: eq, and, or (flint-orm/conditions)
export { eq, and, or } from "./query/conditions";
export type { Condition } from "./query/conditions";
