// ---------------------------------------------------------------------------
// Query builders — immutable, chainable, parameterized.
// Every value passes through column.encode() on the way in,
// and column.decode() on the way out, at a single chokepoint each.
// ---------------------------------------------------------------------------

import { type Database, type SQLQueryBindings } from "bun:sqlite";
import type { ColumnDef } from "./columns";
import type { Condition } from "./conditions";
import { compileConditions } from "./conditions";
import type { TableDef, InferRow } from "./table";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Cast params array to what bun:sqlite expects. */
function bind(params: unknown[]): SQLQueryBindings[] {
  return params as SQLQueryBindings[];
}

/** Get column entries from a table (filters out the `._` metadata prop). */
function columnEntries(tbl: Record<string, any>): [string, ColumnDef<any, any>][] {
  return Object.entries(tbl).filter(([k]) => k !== "_") as [string, ColumnDef<any, any>][];
}

/** Decode a raw SQLite row into the logical TS shape. */
function decodeRow<T extends TableDef<any>>(
  raw: Record<string, unknown>,
  tbl: T,
): InferRow<T> {
  const out: Record<string, unknown> = {};
  for (const [key, col] of columnEntries(tbl as any)) {
    out[key] = col.decode(raw[col.name]);
  }
  return out as InferRow<T>;
}

// ---------------------------------------------------------------------------
// SELECT
// ---------------------------------------------------------------------------

export class SelectBuilder<T extends TableDef<any>> {
  private readonly _tableName: string;
  private readonly _table: T;
  private readonly _conditions: Condition[];

  constructor(tableName: string, table: T, conditions: Condition[] = []) {
    this._tableName = tableName;
    this._table = table;
    this._conditions = conditions;
  }

  from<U extends TableDef<any>>(table: U): SelectBuilder<U> {
    const name = (table as any)._.name as string;
    return new SelectBuilder(name, table, this._conditions);
  }

  where(condition: Condition): SelectBuilder<T> {
    return new SelectBuilder(this._tableName, this._table, [...this._conditions, condition]);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const entries = columnEntries(this._table as any);
    const cols = entries.map(([, c]) => c.name).join(", ");
    const params: unknown[] = [];
    let sql = `SELECT ${cols} FROM ${this._tableName}`;
    const where = compileConditions(this._conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    return { sql, params };
  }

  execute(db: Database): InferRow<T>[] {
    const { sql, params } = this.toSQL();
    const rows = db.prepare(sql).all(...bind(params)) as Record<string, unknown>[];
    return rows.map((r) => decodeRow(r, this._table));
  }
}

/** `select()` returns a builder waiting for `.from()`. */
export function select(): SelectBuilder<any> {
  return new SelectBuilder("", null as any);
}

// ---------------------------------------------------------------------------
// INSERT
// ---------------------------------------------------------------------------

export class InsertBuilder<T extends TableDef<any>> {
  private readonly _tableName: string;
  private readonly _table: T;
  private readonly _row: InferRow<T> | undefined;

  constructor(tableName: string, table: T, row?: InferRow<T>) {
    this._tableName = tableName;
    this._table = table;
    this._row = row;
  }

  values(row: InferRow<T>): InsertBuilder<T> {
    return new InsertBuilder(this._tableName, this._table, row);
  }

  toSQL(): { sql: string; params: unknown[] } {
    if (!this._row) throw new Error("Missing .values() call");
    const entries = columnEntries(this._table as any);
    const names = entries.map(([, c]) => c.name).join(", ");
    const placeholders = entries.map(() => "?").join(", ");
    const params = entries.map(([key, c]) =>
      c.encode((this._row as any)[key]),
    );
    return {
      sql: `INSERT INTO ${this._tableName} (${names}) VALUES (${placeholders})`,
      params,
    };
  }

  execute(db: Database): void {
    const { sql, params } = this.toSQL();
    db.prepare(sql).run(...bind(params));
  }
}

export function insert<T extends TableDef<any>>(table: T): InsertBuilder<T> {
  const name = (table as any)._.name as string;
  return new InsertBuilder(name, table);
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

export class UpdateBuilder<T extends TableDef<any>> {
  private readonly _tableName: string;
  private readonly _table: T;
  private readonly _set: Partial<InferRow<T>>;
  private readonly _conditions: Condition[];

  constructor(
    tableName: string,
    table: T,
    set: Partial<InferRow<T>> = {},
    conditions: Condition[] = [],
  ) {
    this._tableName = tableName;
    this._table = table;
    this._set = set;
    this._conditions = conditions;
  }

  set(partial: Partial<InferRow<T>>): UpdateBuilder<T> {
    return new UpdateBuilder(this._tableName, this._table, { ...this._set, ...partial }, this._conditions);
  }

  where(condition: Condition): UpdateBuilder<T> {
    return new UpdateBuilder(this._tableName, this._table, this._set, [...this._conditions, condition]);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const setClauses: string[] = [];
    for (const key of Object.keys(this._set)) {
      const col: ColumnDef<any, any> = (this._table as any)[key];
      setClauses.push(`${col.name} = ?`);
      params.push(col.encode((this._set as any)[key]));
    }
    if (setClauses.length === 0) throw new Error("Missing .set() call");
    let sql = `UPDATE ${this._tableName} SET ${setClauses.join(", ")}`;
    const where = compileConditions(this._conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    return { sql, params };
  }

  execute(db: Database): void {
    const { sql, params } = this.toSQL();
    db.prepare(sql).run(...bind(params));
  }
}

export function update<T extends TableDef<any>>(table: T): UpdateBuilder<T> {
  const name = (table as any)._.name as string;
  return new UpdateBuilder(name, table);
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export class DeleteBuilder<T extends TableDef<any>> {
  private readonly _tableName: string;
  private readonly _table: T;
  private readonly _conditions: Condition[];

  constructor(tableName: string, table: T, conditions: Condition[] = []) {
    this._tableName = tableName;
    this._table = table;
    this._conditions = conditions;
  }

  where(condition: Condition): DeleteBuilder<T> {
    return new DeleteBuilder(this._tableName, this._table, [...this._conditions, condition]);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    let sql = `DELETE FROM ${this._tableName}`;
    const where = compileConditions(this._conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    return { sql, params };
  }

  execute(db: Database): void {
    const { sql, params } = this.toSQL();
    db.prepare(sql).run(...bind(params));
  }
}

export function delete_<T extends TableDef<any>>(table: T): DeleteBuilder<T> {
  const name = (table as any)._.name as string;
  return new DeleteBuilder(name, table);
}
