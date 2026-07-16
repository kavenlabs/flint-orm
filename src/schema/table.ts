// Table definition
import type { ColumnDef, IntegerColumnDef, DateColumnDef, DateColumnDefWithDefault, ForeignKeyAction } from './columns';
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
  onUpdateTimestamp?: () => ColumnDef<any, any>;
  onDelete?: (action: ForeignKeyAction) => ColumnDef<any, any>;
  onUpdate?: (action: ForeignKeyAction) => ColumnDef<any, any>;
};

export function table<T extends Record<string, ColumnDef<any, any>>>(
  name: string,
  columns: T,
  indexFn?: (t: TableDef<T>) => (IndexBuilder | PrimaryKeyBuilder)[],
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
        return {
          ...this,
          __internal: { ...stampedInternal, hasDefault: true, defaultValue: value },
        };
      },
      defaultFn(fn: () => any) {
        return { ...this, __internal: { ...stampedInternal, hasDefault: true, defaultFn: fn } };
      },
      references(target: ColumnDef<any, any>) {
        return {
          ...this,
          __internal: {
            ...stampedInternal,
            referencesTable: target.__internal.tableName,
            referencesColumn: target.name,
          },
        };
      },
      onDelete(action: ForeignKeyAction) {
        return { ...this, __internal: { ...stampedInternal, onDelete: action } };
      },
      onUpdate(action: ForeignKeyAction) {
        return { ...this, __internal: { ...stampedInternal, onUpdate: action } };
      },
    };

    // Preserve autoIncrement if the original column had it (integer columns)
    if ('autoIncrement' in col) {
      stampedCol.autoIncrement = function () {
        return { ...this, __internal: { ...stampedInternal, isAutoIncrement: true } };
      };
    }

    // Preserve defaultNow/onUpdateTimestamp if the original column had them (date columns)
    if ('defaultNow' in col) {
      stampedCol.defaultNow = function () {
        return { ...this, __internal: { ...stampedInternal, hasDefaultNow: true } };
      };
    }
    if ('onUpdateTimestamp' in col) {
      stampedCol.onUpdateTimestamp = function () {
        return { ...this, __internal: { ...stampedInternal, hasOnUpdate: true } };
      };
    }

    stamped[key] = stampedCol;
  }
  const result = Object.assign(stamped, {
    _: { name },
  }) as TableDef<T>;

  // Attach indexes and composite primary key from callback
  if (indexFn) {
    const raw = indexFn(result);
    if (raw.length > 0) {
      const tableObj = result as Record<string, unknown>;
      const indexes: IndexDef[] = [];
      let primaryKeyDef: PrimaryKeyDef | undefined;

      for (const item of raw) {
        if (item && typeof item === 'object' && '_type' in item) {
          if ((item as PrimaryKeyBuilderInternal)._type === 'primaryKey') {
            primaryKeyDef = (item as PrimaryKeyBuilderInternal).build();
          } else {
            indexes.push((item as IndexBuilderInternal).build());
          }
        }
      }

      // Validate: no column-level PK if composite PK is defined
      if (primaryKeyDef) {
        for (const [key, col] of Object.entries(columns)) {
          if (col.__internal.isPrimaryKey) {
            throw new Error(`Column "${key}" has primaryKey() but table "${name}" also defines a composite primaryKey(). Use one or the other.`);
          }
        }
        tableObj.__primaryKey = primaryKeyDef;
      }

      if (indexes.length > 0) {
        tableObj.__indexes = indexes;
      }
    }
  }

  return result;
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
export type InferRow<T extends TableDef<any>> =
  T extends TableDef<infer C>
    ? {
        [K in keyof Omit<C, '_'>]: C[K] extends DateColumnDefWithDefault
          ? Date
          : C[K] extends DateColumnDef
            ? Date | null
            : C[K] extends ColumnDef<any, any>
              ? C[K]['__internal']['_type']
              : never;
      }
    : never;

/** @internal Check if a column has an auto-generated default. */
type HasAutoDefault<C> = C extends DateColumnDef
  ? true
  : C extends IntegerColumnDef<any>
    ? true
    : C extends ColumnDef<any, any>
      ? C['__internal']['defaultFn'] extends undefined
        ? C['__internal']['hasDefault'] extends true
          ? true
          : false
        : true
      : false;

/** The row type for inserts — columns with auto-defaults (integer, date) are optional. */
export type InsertRow<T extends TableDef<any>> = {
  [K in keyof Omit<T, '_'> as HasAutoDefault<T[K]> extends true ? never : K]: T[K] extends ColumnDef<any, any> ? T[K]['__internal']['_type'] : never;
} & {
  [K in keyof Omit<T, '_'> as HasAutoDefault<T[K]> extends true ? K : never]?: T[K] extends ColumnDef<any, any> ? T[K]['__internal']['_type'] : never;
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
  indexFn?: (t: TableDef<T>) => (IndexBuilder | PrimaryKeyBuilder)[],
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
        return {
          ...this,
          __internal: { ...stampedInternal, hasDefault: true, defaultValue: value },
        };
      },
      defaultFn(fn: () => any) {
        return { ...this, __internal: { ...stampedInternal, hasDefault: true, defaultFn: fn } };
      },
      references(target: ColumnDef<any, any>) {
        return {
          ...this,
          __internal: {
            ...stampedInternal,
            referencesTable: target.__internal.tableName,
            referencesColumn: target.name,
          },
        };
      },
      onDelete(action: ForeignKeyAction) {
        return { ...this, __internal: { ...stampedInternal, onDelete: action } };
      },
      onUpdate(action: ForeignKeyAction) {
        return { ...this, __internal: { ...stampedInternal, onUpdate: action } };
      },
    };

    if ('autoIncrement' in col) {
      stampedCol.autoIncrement = function () {
        return { ...this, __internal: { ...stampedInternal, isAutoIncrement: true } };
      };
    }
    if ('defaultNow' in col) {
      stampedCol.defaultNow = function () {
        return { ...this, __internal: { ...stampedInternal, hasDefaultNow: true } };
      };
    }
    if ('onUpdateTimestamp' in col) {
      stampedCol.onUpdateTimestamp = function () {
        return { ...this, __internal: { ...stampedInternal, hasOnUpdate: true } };
      };
    }
    converted[key] = stampedCol;
  }

  return table(tableName, converted as T, indexFn);
}

/** Provides `snakeCase.table()` for auto snake_case column naming. */
export const snakeCase = {
  table: snakeCaseTable,
};

// ---------------------------------------------------------------------------
// Index definition — chainable builder
// ---------------------------------------------------------------------------

/** An index definition — used internally by the migration system. */
export interface IndexDef {
  name: string;
  columns: string[];
  unique: boolean;
}

/** Public builder returned by `index()` — chain `.on(columns)` then `.unique()`. */
export interface IndexBuilder {
  /** Add one or more columns to the index. */
  on(...columns: ColumnDef<any, any>[]): IndexBuilder;
  /** Mark the index as unique. */
  unique(): IndexBuilder;
}

/** @internal Internal builder with `.build()` — accepted by `table()`. */
interface IndexBuilderInternal extends IndexBuilder {
  _type: 'index';
  build(): IndexDef;
}

// ---------------------------------------------------------------------------
// Primary key definition — chainable builder (composite PK)
// ---------------------------------------------------------------------------

/** A composite primary key definition — used internally by the migration system. */
export interface PrimaryKeyDef {
  columns: string[];
}

/** Public builder returned by `primaryKey()` — chain `.on(columns)`. */
export interface PrimaryKeyBuilder {
  /** Add one or more columns to the composite primary key. */
  on(...columns: ColumnDef<any, any>[]): PrimaryKeyBuilder;
}

/** @internal Internal builder with `.build()` — accepted by `table()`. */
interface PrimaryKeyBuilderInternal extends PrimaryKeyBuilder {
  _type: 'primaryKey';
  build(): PrimaryKeyDef;
}

/**
 * Create a composite primary key definition using a chainable API.
 *
 * @param name - Optional name (reserved for future use, currently unused in SQL)
 * @returns A PrimaryKeyBuilder — chain `.on(columns)`
 *
 * @example
 * const userRoles = table("user_roles", {
 *   userId: text("user_id"),
 *   roleId: text("role_id"),
 * }, (t) => [
 *   primaryKey().on(t.userId, t.roleId),
 * ]);
 */
export function primaryKey(): PrimaryKeyBuilderInternal {
  let columns: ColumnDef<any, any>[] = [];

  const builder: PrimaryKeyBuilderInternal = {
    _type: 'primaryKey',
    on(...cols) {
      columns = cols;
      return builder;
    },
    build(): PrimaryKeyDef {
      if (columns.length === 0) {
        throw new Error('primaryKey() has no columns — call .on() before returning');
      }
      return { columns: columns.map((c) => c.name) };
    },
  };

  return builder;
}

/**
 * Create an index definition using a chainable API.
 *
 * @param name - The index name (will be used as-is in SQL)
 * @returns An IndexBuilder — chain `.on(columns)` then `.unique()`
 *
 * @example
 * const users = table("users", {
 *   id: text("id").primaryKey(),
 *   email: text("email"),
 *   name: text("name"),
 * }, (t) => [
 *   index("idx_users_email").on(t.email).unique(),
 *   index("idx_users_name").on(t.name),
 * ]);
 */
export function index(name: string): IndexBuilderInternal {
  let columns: ColumnDef<any, any>[] = [];
  let isUnique = false;

  const builder: IndexBuilderInternal = {
    _type: 'index',
    on(...cols) {
      columns = cols;
      return builder;
    },
    unique() {
      isUnique = true;
      return builder;
    },
    build(): IndexDef {
      if (columns.length === 0) {
        throw new Error(`Index "${name}" has no columns — call .on() before returning`);
      }
      return {
        name,
        columns: columns.map((c) => c.name),
        unique: isUnique,
      };
    },
  };

  return builder;
}
