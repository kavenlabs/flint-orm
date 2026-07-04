// ---------------------------------------------------------------------------
// Column definitions — each named function returns an immutable ColumnDef
// with chainable modifiers. Internal details live under __internal.
// ---------------------------------------------------------------------------

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
    /** Converts logical value → storage value. Called by the builder. */
    readonly encode: (value: T) => unknown;
    /** Converts storage value → logical value. Called by the builder. */
    readonly decode: (value: unknown) => T;
  };
}

// ---------------------------------------------------------------------------
// Internal builder
// ---------------------------------------------------------------------------

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
      encode: config.encode,
      decode: config.decode,
    },
  };

  const col: ColumnDef<T, S> = {
    ...base,
    primaryKey() {
      return { ...col, __internal: { ...col.__internal, isPrimaryKey: true } };
    },
    notNull() {
      return { ...col, __internal: { ...col.__internal, isNotNull: true } };
    },
    unique() {
      return { ...col, __internal: { ...col.__internal, isUnique: true } };
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
