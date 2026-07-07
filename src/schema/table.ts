// Table definition
import type { ColumnDef, IntegerColumnDef, DateColumnDef, DateColumnDefWithDefault } from "./columns";
/** A table definition mapping column names to their `ColumnDef`s. */
export type TableDef<T> = T & {
  readonly _: { readonly name: string };
};

/** @internal A relaxed table type used internally for generic constraints. */
export type AnyTable = {
  readonly _: { readonly name: string };
  [key: string]: unknown;
};

/**
 * Define a table from a record of column definitions.
 *
 * @example
 * const users = table("users", {
 *   id: text("id").primaryKey(),
 *   name: text("name").notNull(),
 * });
 */
/** A column with optional modifier methods from sub-interfaces. */
type StampedColumn = ColumnDef<any, any> & {
  autoIncrement?: () => ColumnDef<any, any>;
  defaultNow?: () => ColumnDef<any, any>;
  onUpdate?: () => ColumnDef<any, any>;
};

export function table<T extends Record<string, ColumnDef<any, any>>>(
  name: string,
  columns: T,
): TableDef<T> {
  // Stamp table name onto each column
  const stamped = Object.create(null);
  for (const [key, col] of Object.entries(columns)) {
    // If column has no name (empty string), use the object key as the SQL name
    const columnName = col.name || key;
    const stampedInternal = { ...col.__internal, name: columnName, tableName: name };
    const stampedCol: StampedColumn = {
      name: columnName,
      __internal: stampedInternal,
      primaryKey() {
        return { ...this, __internal: { ...stampedInternal, isPrimaryKey: true } };
      },
      notNull() {
        return { ...this, __internal: { ...stampedInternal, isNotNull: true } };
      },
      unique() {
        return { ...this, __internal: { ...stampedInternal, isUnique: true } };
      },
      default(value: any) {
        return { ...this, __internal: { ...stampedInternal, hasDefault: true, defaultValue: value } };
      },
      defaultFn(fn: () => any) {
        return { ...this, __internal: { ...stampedInternal, hasDefault: true, defaultFn: fn } };
      },
      references(target: ColumnDef<any, any>) {
        return { ...this, __internal: { ...stampedInternal, referencesTable: target.__internal.tableName, referencesColumn: target.name } };
      },
    };

    // Preserve autoIncrement if the original column had it (integer columns)
    if ("autoIncrement" in col) {
      stampedCol.autoIncrement = function () {
        return { ...this, __internal: { ...stampedInternal, isAutoIncrement: true } };
      };
    }

    // Preserve defaultNow/onUpdate if the original column had them (date columns)
    if ("defaultNow" in col) {
      stampedCol.defaultNow = function () {
        return { ...this, __internal: { ...stampedInternal, hasDefaultNow: true } };
      };
    }
    if ("onUpdate" in col) {
      stampedCol.onUpdate = function () {
        return { ...this, __internal: { ...stampedInternal, hasOnUpdate: true } };
      };
    }

    stamped[key] = stampedCol;
  }
  return Object.assign(stamped, {
    _: { name },
  }) as TableDef<T>;
}

/**
 * Derive the row shape from a table's column definitions.
 * DateColumnDef → Date | null (nullable unless defaultNow() was called)
 * DateColumnDefWithDefault → Date (non-nullable, has a guaranteed default)
 * All other columns → their _type as-is.
 *
 * Uses `infer C` to extract the column record from TableDef<T> so TypeScript
 * evaluates the mapped type against the concrete columns, not the intersection.
 * This produces cleaner hover info: { id: string; name: string } instead of
 * Pick<InferRow<TableDef<{...}>>, ...>.
 */
export type InferRow<T extends TableDef<any>> = T extends TableDef<infer C>
  ? {
      [K in keyof Omit<C, "_">]: C[K] extends DateColumnDefWithDefault
        ? Date
        : C[K] extends DateColumnDef
          ? Date | null
          : C[K] extends ColumnDef<any, any>
            ? C[K]["__internal"]["_type"]
            : never;
    }
  : never;

/** @internal Check if a column has an auto-generated default. */
type HasAutoDefault<C> = C extends DateColumnDef
  ? true
  : C extends IntegerColumnDef<any>
    ? true
    : false;

/** The row type for inserts — columns with auto-defaults (integer, date) are optional. */
export type InsertRow<T extends TableDef<any>> = {
  [K in keyof Omit<T, "_"> as HasAutoDefault<T[K]> extends true ? never : K]: T[K] extends ColumnDef<any, any>
    ? T[K]["__internal"]["_type"]
    : never;
} & {
  [K in keyof Omit<T, "_"> as HasAutoDefault<T[K]> extends true ? K : never]?: T[K] extends ColumnDef<any, any>
    ? T[K]["__internal"]["_type"]
    : never;
};

// @internal snakeCase helper
/** @internal Convert camelCase to snake_case. */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Define a table with auto snake_case column names.
 * Column names are inferred from object keys and converted to snake_case.
 * Column constructors can be called without a name.
 *
 * @example
 * const users = snakeCase.table("users", {
 *   id: text().primaryKey(),
 *   firstName: text(),
 * });
 */
export function snakeCaseTable<T extends Record<string, ColumnDef<any, any>>>(
  tableName: string,
  columns: T,
): TableDef<T> {
  // Create a new object with snake_case names stamped onto each column
  const converted: Record<string, ColumnDef<any, any>> = {};
  for (const [key, col] of Object.entries(columns)) {
    const sqlName = toSnakeCase(key);
    // If the column has no name (empty string), use the snake_case key
    const columnName = col.name || sqlName;
    const stampedInternal = { ...col.__internal, name: columnName, tableName };
    const stampedCol: StampedColumn = {
      name: columnName,
      __internal: stampedInternal,
      primaryKey() {
        return { ...this, __internal: { ...stampedInternal, isPrimaryKey: true } };
      },
      notNull() {
        return { ...this, __internal: { ...stampedInternal, isNotNull: true } };
      },
      unique() {
        return { ...this, __internal: { ...stampedInternal, isUnique: true } };
      },
      default(value: any) {
        return { ...this, __internal: { ...stampedInternal, hasDefault: true, defaultValue: value } };
      },
      defaultFn(fn: () => any) {
        return { ...this, __internal: { ...stampedInternal, hasDefault: true, defaultFn: fn } };
      },
      references(target: ColumnDef<any, any>) {
        return { ...this, __internal: { ...stampedInternal, referencesTable: target.__internal.tableName, referencesColumn: target.name } };
      },
    };

    if ("autoIncrement" in col) {
      stampedCol.autoIncrement = function () {
        return { ...this, __internal: { ...stampedInternal, isAutoIncrement: true } };
      };
    }
    if ("defaultNow" in col) {
      stampedCol.defaultNow = function () {
        return { ...this, __internal: { ...stampedInternal, hasDefaultNow: true } };
      };
    }
    if ("onUpdate" in col) {
      stampedCol.onUpdate = function () {
        return { ...this, __internal: { ...stampedInternal, hasOnUpdate: true } };
      };
    }
    converted[key] = stampedCol;
  }

  return table(tableName, converted as T);
}

/** Provides `snakeCase.table()` for auto snake_case column naming. */
export const snakeCase = {
  table: snakeCaseTable,
};
