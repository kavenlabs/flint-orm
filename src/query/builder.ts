// -----------------------------------------------------------------------
// Query builders — immutable, chainable, parameterized.
// Every value passes through column.__internal.encode() on the way in,
// and column.__internal.decode() on the way out, at a single chokepoint each.
// Builders receive `client` at construction — .execute() takes no arguments.
// -----------------------------------------------------------------------

import type { SQLQueryBindings } from "bun:sqlite";
import type { ColumnDef } from "../schema/columns";
import type { Condition } from "./conditions";
import { compileConditions } from "./conditions";
import type { TableDef, InferRow } from "../schema/table";

// -----------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Executable — structural type for anything that can produce SQL.
// batch() uses this so it's not tied to any specific builder class.
// -----------------------------------------------------------------------

export interface Executable {
  toSQL(): { sql: string; params: unknown[] };
}

// -----------------------------------------------------------------------
// Client type — anything that can run SQL
// -----------------------------------------------------------------------

export interface DatabaseClient {
  prepare(sql: string): {
    all(...params: SQLQueryBindings[]): unknown[];
    run(...params: SQLQueryBindings[]): void;
  };
}

// -----------------------------------------------------------------------
// SELECT — two-phase: SelectStage1 (only .from()) → SelectBuilder
// -----------------------------------------------------------------------

/** First phase: only .from() is available. Prevents calling .toSQL()/.execute() before supplying a table. */
export interface SelectStage1 {
  from<U extends TableDef<any>>(table: U): SelectBuilder<U>;
}

/** Lightweight wrapper that only exposes .from(). */
export class SelectFromBuilder implements SelectStage1 {
  #client: DatabaseClient;
  #conditions: Condition[];

  constructor(client: DatabaseClient, conditions: Condition[] = []) {
    this.#client = client;
    this.#conditions = conditions;
  }

  from<U extends TableDef<any>>(table: U): SelectBuilder<U> {
    const name = (table as any)._.name as string;
    return new SelectBuilder(this.#client, name, table, this.#conditions);
  }
}

/** Full SELECT builder — available after .from() has been called. */
export class SelectBuilder<T extends TableDef<any>> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #conditions: Condition[];

  constructor(client: DatabaseClient, tableName: string, table: T, conditions: Condition[] = []) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
  }

  where(condition: Condition): SelectBuilder<T> {
    return new SelectBuilder(this.#client, this.#tableName, this.#table, [...this.#conditions, condition]);
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

  execute(): InferRow<T>[] {
    const { sql, params } = this.toSQL();
    const rows = this.#client.prepare(sql).all(...bind(params)) as Record<string, unknown>[];
    return rows.map((r) => decodeRow(r, this.#table));
  }
}

// -----------------------------------------------------------------------
// INSERT
// -----------------------------------------------------------------------

export class InsertBuilder<T extends TableDef<any>> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #row: InferRow<T> | undefined;

  constructor(client: DatabaseClient, tableName: string, table: T, row?: InferRow<T>) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#row = row;
  }

  values(row: InferRow<T>): InsertBuilder<T> {
    return new InsertBuilder(this.#client, this.#tableName, this.#table, row);
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

  execute(): void {
    const { sql, params } = this.toSQL();
    this.#client.prepare(sql).run(...bind(params));
  }
}

// -----------------------------------------------------------------------
// UPDATE
// -----------------------------------------------------------------------

export class UpdateBuilder<T extends TableDef<any>> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #set: Partial<InferRow<T>>;
  #conditions: Condition[];

  constructor(
    client: DatabaseClient,
    tableName: string,
    table: T,
    set: Partial<InferRow<T>> = {},
    conditions: Condition[] = [],
  ) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#set = set;
    this.#conditions = conditions;
  }

  set(partial: Partial<InferRow<T>>): UpdateBuilder<T> {
    return new UpdateBuilder(this.#client, this.#tableName, this.#table, { ...this.#set, ...partial }, this.#conditions);
  }

  where(condition: Condition): UpdateBuilder<T> {
    return new UpdateBuilder(this.#client, this.#tableName, this.#table, this.#set, [...this.#conditions, condition]);
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

  execute(): void {
    const { sql, params } = this.toSQL();
    this.#client.prepare(sql).run(...bind(params));
  }
}

// -----------------------------------------------------------------------
// DELETE
// -----------------------------------------------------------------------

export class DeleteBuilder<T extends TableDef<any>> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #conditions: Condition[];

  constructor(client: DatabaseClient, tableName: string, table: T, conditions: Condition[] = []) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
  }

  where(condition: Condition): DeleteBuilder<T> {
    return new DeleteBuilder(this.#client, this.#tableName, this.#table, [...this.#conditions, condition]);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    let sql = `DELETE FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    return { sql, params };
  }

  execute(): void {
    const { sql, params } = this.toSQL();
    this.#client.prepare(sql).run(...bind(params));
  }
}
