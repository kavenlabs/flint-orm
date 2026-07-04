// ---------------------------------------------------------------------------
// flint-orm — public API exports
// ---------------------------------------------------------------------------

// Column definitions
export { type ColumnDef, text, integer, boolean, json, real } from "./columns";

// Table definition
export { type TableDef, type InferRow, table } from "./table";

// Conditions
export { type Condition, eq, and, or } from "./conditions";

// Query builders
export {
  select,
  insert,
  update,
  delete_,
  SelectBuilder,
  InsertBuilder,
  UpdateBuilder,
  DeleteBuilder,
} from "./builder";
