// -----------------------------------------------------------------------
// Table definition — column definitions live as direct properties of the
// table object so that `users.name` is the ColumnDef, not the table name.
// Table metadata (SQL name) is stored under `._`.
// -----------------------------------------------------------------------

import type { ColumnDef } from "./columns";
/**
 * A table definition. `T` is the column map — every key is a column name
 * whose value is a ColumnDef. The hidden `._` property carries SQL metadata.
 */
export type TableDef<T> = T & {
  readonly _: { readonly name: string };
};

/**
 * Define a table from a record of column definitions.
 * Stamps the table name onto each column's __internal.tableName
 * so that join conditions can disambiguate columns across tables.
 */
export function table<T extends Record<string, ColumnDef<any, any>>>(
  name: string,
  columns: T,
): TableDef<T> {
  // Stamp table name onto each column
  const stamped = Object.create(null);
  for (const [key, col] of Object.entries(columns)) {
    stamped[key] = {
      ...col,
      __internal: { ...col.__internal, tableName: name },
    };
  }
  return Object.assign(stamped, {
    _: { name },
  }) as TableDef<T>;
}

/**
 * Derive the row shape from a table's column definitions.
 * Each column's phantom `_type` (inside `__internal`) becomes the property type.
 * Skips `_` metadata and any non-ColumnDef properties.
 */
export type InferRow<T extends TableDef<any>> = {
  [K in keyof Omit<T, "_">]: T[K] extends ColumnDef<any, any>
    ? T[K]["__internal"]["_type"]
    : never;
};
