// ---------------------------------------------------------------------------
// Query builders — immutable, chainable, parameterized.
// Every value passes through column.__internal.encode() on the way in,
// and column.__internal.decode() on the way out, at a single chokepoint each.
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
    out[key] = col.__internal.decode(raw[col.name]);
  }
  return out as InferRow<T>;
}

// ---------------------------------------------------------------------------
// SELECT
// ---------------------------------------------------------------------------

export class SelectBuilder<T extends TableDef<any>> {
  #tableName: string;
  #table: T;
  #conditions: Condition[];

  constructor(tableName: string, table: T, conditions: Condition[] = []) {
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
  }

  from<U extends TableDef<any>>(table: U): SelectBuilder<U> {
    const name = (table as any)._.name as string;
    return new SelectBuilder(name, table, this.#conditions);
  }

  where(condition: Condition): SelectBuilder<T> {
    return new SelectBuilder(this.#tableName, this.#table, [...this.#conditions, condition]);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const entries = columnEntries(this.#table as any);
    const cols = entries.map(([, c]) => c.name).join(", ");
    const params: unknown[] = [];
    let sql = `SELECT ${cols} FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    return { sql, params };
  }

  execute(db: Database): InferRow<T>[] {
    const { sql, params } = this.toSQL();
    const rows = db.prepare(sql).all(...bind(params)) as Record<string, unknown>[];
    return rows.map((r) => decodeRow(r, this.#table));
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
  #tableName: string;
  #table: T;
  #row: InferRow<T> | undefined;

  constructor(tableName: string, table: T, row?: InferRow<T>) {
    this.#tableName = tableName;
    this.#table = table;
    this.#row = row;
  }

  values(row: InferRow<T>): InsertBuilder<T> {
    return new InsertBuilder(this.#tableName, this.#table, row);
  }

  toSQL(): { sql: string; params: unknown[] } {
    if (!this.#row) throw new Error("Missing .values() call");
    const entries = columnEntries(this.#table as any);
    const names = entries.map(([, c]) => c.name).join(", ");
    const placeholders = entries.map(() => "?").join(", ");
    const params = entries.map(([key, c]) =>
      c.__internal.encode((this.#row as any)[key]),
    );
    return {
      sql: `INSERT INTO ${this.#tableName} (${names}) VALUES (${placeholders})`,
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
  #tableName: string;
  #table: T;
  #set: Partial<InferRow<T>>;
  #conditions: Condition[];

  constructor(
    tableName: string,
    table: T,
    set: Partial<InferRow<T>> = {},
    conditions: Condition[] = [],
  ) {
    this.#tableName = tableName;
    this.#table = table;
    this.#set = set;
    this.#conditions = conditions;
  }

  set(partial: Partial<InferRow<T>>): UpdateBuilder<T> {
    return new UpdateBuilder(this.#tableName, this.#table, { ...this.#set, ...partial }, this.#conditions);
  }

  where(condition: Condition): UpdateBuilder<T> {
    return new UpdateBuilder(this.#tableName, this.#table, this.#set, [...this.#conditions, condition]);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const setClauses: string[] = [];
    for (const key of Object.keys(this.#set)) {
      const col: ColumnDef<any, any> = (this.#table as any)[key];
      setClauses.push(`${col.name} = ?`);
      params.push(col.__internal.encode((this.#set as any)[key]));
    }
    if (setClauses.length === 0) throw new Error("Missing .set() call");
    let sql = `UPDATE ${this.#tableName} SET ${setClauses.join(", ")}`;
    const where = compileConditions(this.#conditions, params);
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
  #tableName: string;
  #table: T;
  #conditions: Condition[];

  constructor(tableName: string, table: T, conditions: Condition[] = []) {
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
  }

  where(condition: Condition): DeleteBuilder<T> {
    return new DeleteBuilder(this.#tableName, this.#table, [...this.#conditions, condition]);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    let sql = `DELETE FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
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
