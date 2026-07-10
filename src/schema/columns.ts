/** Foreign key referential action. */
export type ForeignKeyAction = 'cascade' | 'set null' | 'set default' | 'restrict' | 'no action';

// Column definitions
/**
 * A column definition with chainable modifiers.
 *
 * @example
 * const name = text("name").notNull().default("unnamed");
 */
export interface ColumnDef<T, S extends string = string> {
  readonly name: string;
  primaryKey(): ColumnDef<T, S>;
  notNull(): ColumnDef<T, S>;
  unique(): ColumnDef<T, S>;
  /** Set a static default value used when the value is omitted during insert. */
  default(value: T): ColumnDef<T, S>;
  /** Set a dynamic default function called when the value is omitted during insert. */
  defaultFn(fn: () => T): ColumnDef<T, S>;
  /**
   * Define a foreign key reference to another table's column.
   *
   * @example
   * text("userId").references(users.id)
   */
  references(target: ColumnDef<any, any>): ColumnDef<T, S>;
  /** Set ON DELETE action for the foreign key. Requires `.references()` to be called first. */
  onDelete(action: ForeignKeyAction): ColumnDef<T, S>;
  /** Set ON UPDATE action for the foreign key. Requires `.references()` to be called first. */
  onUpdate(action: ForeignKeyAction): ColumnDef<T, S>;
  readonly __internal: {
    /** Phantom — exists only at the type level, never accessed at runtime. */
    readonly _type: T;
    /** SQLite storage class: "text" | "integer" | "real" | "blob". */
    readonly sqlType: S;
    /** Column constraint flags — set via modifiers, read by migration generator. */
    readonly isPrimaryKey: boolean;
    readonly isNotNull: boolean;
    readonly isUnique: boolean;
    readonly hasDefault: boolean;
    readonly defaultValue: T | undefined;
    readonly defaultFn: (() => T) | undefined;
    readonly isAutoIncrement: boolean;
    readonly hasDefaultNow: boolean;
    readonly hasOnUpdate: boolean;
    /** Foreign key reference — table and column names. */
    readonly referencesTable: string | null;
    readonly referencesColumn: string | null;
    /** Foreign key referential actions. */
    readonly onDelete: ForeignKeyAction | null;
    readonly onUpdate: ForeignKeyAction | null;
    /** Converts logical value → storage value. Called by the builder. */
    readonly encode: (value: T) => unknown;
    /** Converts storage value → logical value. Called by the builder. */
    readonly decode: (value: unknown) => T;
    /** Table name — set by table() when the column is attached. Used for join disambiguation. */
    readonly tableName: string | null;
  };
}

/** An integer column definition with auto-increment support. */
export interface IntegerColumnDef<S extends string = 'integer'> extends ColumnDef<number, S> {
  primaryKey(): IntegerColumnDef<S>;
  notNull(): IntegerColumnDef<S>;
  unique(): IntegerColumnDef<S>;
  default(value: number): IntegerColumnDef<S>;
  defaultFn(fn: () => number): IntegerColumnDef<S>;
  /**
   * Mark as auto-increment (SQLite ROWID alias).
   *
   * @example
   * const id = integer("id").primaryKey().autoIncrement();
   */
  autoIncrement(): IntegerColumnDef<S>;
}

/** A date column that stores a unix timestamp (milliseconds) in SQLite. Nullable in results unless `.defaultNow()` is called. */
export interface DateColumnDef extends ColumnDef<Date, 'integer'> {
  primaryKey(): DateColumnDef;
  notNull(): DateColumnDef;
  unique(): DateColumnDef;
  default(value: Date): DateColumnDef;
  defaultFn(fn: () => Date): DateColumnDef;
  /**
   * Use `Date.now()` as the default when the value is omitted during insert.
   *
   * @example
   * const createdAt = date("created_at").defaultNow();
   */
  defaultNow(): DateColumnDefWithDefault;
  /**
   * Always set to `Date.now()` on update, regardless of the provided value.
   *
   * @example
   * const updatedAt = date("updated_at").onUpdateTimestamp();
   */
  onUpdateTimestamp(): DateColumnDef;
}

/** A date column with a guaranteed default value, making it non-nullable in query results. */
export interface DateColumnDefWithDefault extends DateColumnDef {
  primaryKey(): DateColumnDefWithDefault;
  notNull(): DateColumnDefWithDefault;
  unique(): DateColumnDefWithDefault;
  default(value: Date): DateColumnDefWithDefault;
  defaultFn(fn: () => Date): DateColumnDefWithDefault;
  defaultNow(): DateColumnDefWithDefault;
  onUpdateTimestamp(): DateColumnDefWithDefault;
}

// @internal Internal builder
/** @internal Cast null to a column's type. */
function nullCast<T>(): T {
  return null as unknown as T;
}

function makeColumn<T, S extends string>(config: {
  name: string;
  sqlType: S;
  encode: (value: T) => unknown;
  decode: (value: unknown) => T;
}): ColumnDef<T, S> {
  const base = {
    name: config.name,
    __internal: {
      _type: undefined as unknown as T,
      sqlType: config.sqlType,
      isPrimaryKey: false,
      isNotNull: false,
      isUnique: false,
      hasDefault: false,
      defaultValue: undefined as T | undefined,
      defaultFn: undefined as (() => T) | undefined,
      isAutoIncrement: false,
      hasDefaultNow: false,
      hasOnUpdate: false,
      referencesTable: null as string | null,
      referencesColumn: null as string | null,
      onDelete: null as ForeignKeyAction | null,
      onUpdate: null as ForeignKeyAction | null,
      encode: config.encode,
      decode: config.decode,
      tableName: null as string | null,
    },
  };

  const col: ColumnDef<T, S> = {
    ...base,
    primaryKey() {
      return { ...this, __internal: { ...this.__internal, isPrimaryKey: true } };
    },
    notNull() {
      return { ...this, __internal: { ...this.__internal, isNotNull: true } };
    },
    unique() {
      return { ...this, __internal: { ...this.__internal, isUnique: true } };
    },
    default(value: T) {
      return { ...this, __internal: { ...this.__internal, hasDefault: true, defaultValue: value } };
    },
    defaultFn(fn: () => T) {
      return { ...this, __internal: { ...this.__internal, hasDefault: true, defaultFn: fn } };
    },
    references(target: ColumnDef<any, any>) {
      return {
        ...this,
        __internal: {
          ...this.__internal,
          referencesTable: target.__internal.tableName,
          referencesColumn: target.name,
        },
      };
    },
    onDelete(action: ForeignKeyAction) {
      return { ...this, __internal: { ...this.__internal, onDelete: action } };
    },
    onUpdate(action: ForeignKeyAction) {
      return { ...this, __internal: { ...this.__internal, onUpdate: action } };
    },
  };

  return col;
}

// Public column constructors
/**
 * Create a text column.
 *
 * @example
 * const name = text("name").notNull();
 */
export function text(name?: string): ColumnDef<string, 'text'> {
  return makeColumn({
    name: name ?? '',
    sqlType: 'text',
    encode: (v) => v,
    decode: (v) => (v == null ? nullCast<string>() : (v as string)),
  });
}

/**
 * Create an integer column.
 *
 * @example
 * const id = integer("id").primaryKey().autoIncrement();
 */
export function integer(name?: string): IntegerColumnDef<'integer'> {
  const base = makeColumn<number, 'integer'>({
    name: name ?? '',
    sqlType: 'integer',
    encode: (v) => v,
    decode: (v) => (v == null ? nullCast<number>() : Number(v)),
  });

  const intCol: IntegerColumnDef<'integer'> = {
    ...base,
    primaryKey() {
      return {
        ...this,
        __internal: { ...this.__internal, isPrimaryKey: true },
      } as IntegerColumnDef<'integer'>;
    },
    notNull() {
      return {
        ...this,
        __internal: { ...this.__internal, isNotNull: true },
      } as IntegerColumnDef<'integer'>;
    },
    unique() {
      return {
        ...this,
        __internal: { ...this.__internal, isUnique: true },
      } as IntegerColumnDef<'integer'>;
    },
    default(value: number) {
      return {
        ...this,
        __internal: { ...this.__internal, hasDefault: true, defaultValue: value },
      } as IntegerColumnDef<'integer'>;
    },
    defaultFn(fn: () => number) {
      return {
        ...this,
        __internal: { ...this.__internal, hasDefault: true, defaultFn: fn },
      } as IntegerColumnDef<'integer'>;
    },
    autoIncrement() {
      return {
        ...this,
        __internal: { ...this.__internal, isAutoIncrement: true },
      } as IntegerColumnDef<'integer'>;
    },
  };

  return intCol;
}

/**
 * Create a boolean column. Stores `0`/`1` in SQLite, exposed as `boolean` in TypeScript.
 *
 * @example
 * const active = boolean("active").notNull().default(true);
 */
export function boolean(name?: string): ColumnDef<boolean, 'integer'> {
  return makeColumn({
    name: name ?? '',
    sqlType: 'integer',
    encode: (v) => (v ? 1 : 0),
    decode: (v) => (v == null ? nullCast<boolean>() : Boolean(v)),
  });
}

/**
 * Create a JSON column. Stores JSON text in SQLite, exposed as `T` in TypeScript.
 *
 * @example
 * const meta = json<Record<string, unknown>>("meta").default({});
 */
export function json<T>(name?: string): ColumnDef<T, 'text'> {
  return makeColumn({
    name: name ?? '',
    sqlType: 'text',
    encode: (v) => (v == null ? null : JSON.stringify(v)),
    decode: (v) => (v == null ? nullCast<T>() : (JSON.parse(v as string) as T)),
  });
}

/**
 * Create a date column. Stores a unix timestamp (milliseconds) in SQLite, exposed as `Date` in TypeScript.
 *
 * @example
 * const createdAt = date("created_at").defaultNow().notNull();
 */
export function date(name?: string): DateColumnDef {
  const base = makeColumn<Date, 'integer'>({
    name: name ?? '',
    sqlType: 'integer',
    encode: (v) => (v == null ? null : v.getTime()),
    decode: (v) => (v == null ? nullCast<Date>() : new Date(v as number)),
  });

  const dateCol: DateColumnDef = {
    ...base,
    primaryKey() {
      return { ...this, __internal: { ...this.__internal, isPrimaryKey: true } };
    },
    notNull() {
      return { ...this, __internal: { ...this.__internal, isNotNull: true } };
    },
    unique() {
      return { ...this, __internal: { ...this.__internal, isUnique: true } };
    },
    default(value: Date) {
      return { ...this, __internal: { ...this.__internal, hasDefault: true, defaultValue: value } };
    },
    defaultFn(fn: () => Date) {
      return { ...this, __internal: { ...this.__internal, hasDefault: true, defaultFn: fn } };
    },
    defaultNow() {
      return { ...this, __internal: { ...this.__internal, hasDefaultNow: true } };
    },
    onUpdateTimestamp() {
      return { ...this, __internal: { ...this.__internal, hasOnUpdate: true } };
    },
  };

  return dateCol;
}

/**
 * Create a real (floating-point) column.
 *
 * @example
 * const price = real("price").notNull();
 */
export function real(name?: string): ColumnDef<number, 'real'> {
  return makeColumn({
    name: name ?? '',
    sqlType: 'real',
    encode: (v) => v,
    decode: (v) => (v == null ? nullCast<number>() : Number(v)),
  });
}
