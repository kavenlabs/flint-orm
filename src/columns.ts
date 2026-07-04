// ---------------------------------------------------------------------------
// Column definitions — each named function returns an immutable ColumnDef
// with phantom _type, encode/decode, and chainable modifiers.
// ---------------------------------------------------------------------------

export interface ColumnDef<T, S extends string = string> {
  readonly name: string;
  readonly sqlType: S;
  /** Phantom — exists only at the type level, never accessed at runtime. */
  readonly _type: T;
  readonly encode: (value: T) => unknown;
  readonly decode: (value: unknown) => T;
  readonly isPrimaryKey: boolean;
  readonly isNotNull: boolean;
  readonly isUnique: boolean;
  primaryKey(): ColumnDef<T, S>;
  notNull(): ColumnDef<T, S>;
  unique(): ColumnDef<T, S>;
}

// Internal builder — not exported.
function makeColumn<T, S extends string>(config: {
  name: string;
  sqlType: S;
  encode: (value: T) => unknown;
  decode: (value: unknown) => T;
}): ColumnDef<T, S> {
  const base = {
    name: config.name,
    sqlType: config.sqlType,
    _type: undefined as T,
    encode: config.encode,
    decode: config.decode,
    isPrimaryKey: false,
    isNotNull: false,
    isUnique: false,
  };

  const col: ColumnDef<T, S> = {
    ...base,
    primaryKey() {
      return { ...col, isPrimaryKey: true };
    },
    notNull() {
      return { ...col, isNotNull: true };
    },
    unique() {
      return { ...col, isUnique: true };
    },
  };

  return col;
}

// ---------------------------------------------------------------------------
// Public column constructors
// ---------------------------------------------------------------------------

export function text(name: string): ColumnDef<string, "text"> {
  return makeColumn({
    name,
    sqlType: "text",
    encode: (v) => v,
    decode: (v) => (v == null ? (null as unknown as string) : (v as string)),
  });
}

export function integer(name: string): ColumnDef<number, "integer"> {
  return makeColumn({
    name,
    sqlType: "integer",
    encode: (v) => v,
    decode: (v) => (v == null ? (null as unknown as number) : Number(v)),
  });
}

/** Stores 0/1 in SQLite, exposes boolean in TS. */
export function boolean(name: string): ColumnDef<boolean, "integer"> {
  return makeColumn({
    name,
    sqlType: "integer",
    encode: (v) => (v ? 1 : 0),
    decode: (v) => (v == null ? (null as unknown as boolean) : Boolean(v)),
  });
}

/** Stores JSON text in SQLite, exposes T in TS. */
export function json<T>(name: string): ColumnDef<T, "text"> {
  return makeColumn({
    name,
    sqlType: "text",
    encode: (v) => (v == null ? null : JSON.stringify(v)),
    decode: (v) =>
      v == null ? (null as unknown as T) : (JSON.parse(v as string) as T),
  });
}

export function real(name: string): ColumnDef<number, "real"> {
  return makeColumn({
    name,
    sqlType: "real",
    encode: (v) => v,
    decode: (v) => (v == null ? (null as unknown as number) : Number(v)),
  });
}
