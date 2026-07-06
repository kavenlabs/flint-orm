// -----------------------------------------------------------------------
// Column definitions — each named function returns an immutable ColumnDef
// with chainable modifiers. Internal details live under __internal.
// -----------------------------------------------------------------------

/**
 * Column definition — the public shape consumers interact with.
 *
 * Only `name` and modifier methods are public. Everything else is under
 * `__internal` — the naming signals "don't touch this".
 */
export interface ColumnDef<T, S extends string = string> {
  readonly name: string;
  primaryKey(): ColumnDef<T, S>;
  notNull(): ColumnDef<T, S>;
  unique(): ColumnDef<T, S>;
  /** Set a static default value — used when value is undefined during INSERT. */
  default(value: T): ColumnDef<T, S>;
  /** Set a dynamic default — called when value is undefined during INSERT. */
  defaultFn(fn: () => T): ColumnDef<T, S>;
  /** Define a foreign key reference to another table's column. */
  references(target: ColumnDef<any, any>): ColumnDef<T, S>;
  /** @internal Implementation details. Do not access directly. */
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
    /** Converts logical value → storage value. Called by the builder. */
    readonly encode: (value: T) => unknown;
    /** Converts storage value → logical value. Called by the builder. */
    readonly decode: (value: unknown) => T;
    /** Table name — set by table() when the column is attached. Used for join disambiguation. */
    readonly tableName: string | null;
  };
}

/** Integer column with autoIncrement support. */
export interface IntegerColumnDef<S extends string = "integer"> extends ColumnDef<number, S> {
  primaryKey(): IntegerColumnDef<S>;
  notNull(): IntegerColumnDef<S>;
  unique(): IntegerColumnDef<S>;
  default(value: number): IntegerColumnDef<S>;
  defaultFn(fn: () => number): IntegerColumnDef<S>;
  /** Mark as auto-increment (SQLite ROWID alias). Only available on integer columns. */
  autoIncrement(): IntegerColumnDef<S>;
}

/** Date column — nullable in results unless defaultNow() is called. */
export interface DateColumnDef extends ColumnDef<Date, "integer"> {
  primaryKey(): DateColumnDef;
  notNull(): DateColumnDef;
  unique(): DateColumnDef;
  default(value: Date): DateColumnDef;
  defaultFn(fn: () => Date): DateColumnDef;
  /** Use current Date.now() when value is undefined during INSERT. */
  defaultNow(): DateColumnDefWithDefault;
  /** Always set to current Date.now() on UPDATE, regardless of user value. */
  onUpdate(): DateColumnDef;
}

/** Date column with a guaranteed default — non-nullable in results. */
export interface DateColumnDefWithDefault extends DateColumnDef {
  primaryKey(): DateColumnDefWithDefault;
  notNull(): DateColumnDefWithDefault;
  unique(): DateColumnDefWithDefault;
  default(value: Date): DateColumnDefWithDefault;
  defaultFn(fn: () => Date): DateColumnDefWithDefault;
  defaultNow(): DateColumnDefWithDefault;
  onUpdate(): DateColumnDefWithDefault;
}

// -----------------------------------------------------------------------
// Internal builder
// -----------------------------------------------------------------------

/** Cast null to a column's type — used when SQLite returns NULL for a nullable column. */
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
      return { ...this, __internal: { ...this.__internal, referencesTable: target.__internal.tableName, referencesColumn: target.name } };
    },
  };

  return col;
}

// -----------------------------------------------------------------------
// Public column constructors
// -----------------------------------------------------------------------

export function text(name?: string): ColumnDef<string, "text"> {
  return makeColumn({
    name: name ?? "",
    sqlType: "text",
    encode: (v) => v,
    decode: (v) => (v == null ? nullCast<string>() : (v as string)),
  });
}

export function integer(name?: string): IntegerColumnDef<"integer"> {
  const base = makeColumn<number, "integer">({
    name: name ?? "",
    sqlType: "integer",
    encode: (v) => v,
    decode: (v) => (v == null ? nullCast<number>() : Number(v)),
  });

  const intCol: IntegerColumnDef<"integer"> = {
    ...base,
    primaryKey() {
      return { ...this, __internal: { ...this.__internal, isPrimaryKey: true } } as IntegerColumnDef<"integer">;
    },
    notNull() {
      return { ...this, __internal: { ...this.__internal, isNotNull: true } } as IntegerColumnDef<"integer">;
    },
    unique() {
      return { ...this, __internal: { ...this.__internal, isUnique: true } } as IntegerColumnDef<"integer">;
    },
    default(value: number) {
      return { ...this, __internal: { ...this.__internal, hasDefault: true, defaultValue: value } } as IntegerColumnDef<"integer">;
    },
    defaultFn(fn: () => number) {
      return { ...this, __internal: { ...this.__internal, hasDefault: true, defaultFn: fn } } as IntegerColumnDef<"integer">;
    },
    autoIncrement() {
      return { ...this, __internal: { ...this.__internal, isAutoIncrement: true } } as IntegerColumnDef<"integer">;
    },
  };

  return intCol;
}

/** Stores 0/1 in SQLite, exposes boolean in TS. */
export function boolean(name?: string): ColumnDef<boolean, "integer"> {
  return makeColumn({
    name: name ?? "",
    sqlType: "integer",
    encode: (v) => (v ? 1 : 0),
    decode: (v) => (v == null ? nullCast<boolean>() : Boolean(v)),
  });
}

/** Stores JSON text in SQLite, exposes T in TS. */
export function json<T>(name?: string): ColumnDef<T, "text"> {
  return makeColumn({
    name: name ?? "",
    sqlType: "text",
    encode: (v) => (v == null ? null : JSON.stringify(v)),
    decode: (v) =>
      v == null ? nullCast<T>() : (JSON.parse(v as string) as T),
  });
}

/** Stores unix timestamp in milliseconds (integer) in SQLite, exposes Date in TS. */
export function date(name?: string): DateColumnDef {
  const base = makeColumn<Date, "integer">({
    name: name ?? "",
    sqlType: "integer",
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
    onUpdate() {
      return { ...this, __internal: { ...this.__internal, hasOnUpdate: true } };
    },
  };

  return dateCol;
}

export function real(name?: string): ColumnDef<number, "real"> {
  return makeColumn({
    name: name ?? "",
    sqlType: "real",
    encode: (v) => v,
    decode: (v) => (v == null ? nullCast<number>() : Number(v)),
  });
}
