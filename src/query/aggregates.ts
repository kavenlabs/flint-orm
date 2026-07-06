// Aggregate functions
import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { ColumnDef } from "../schema/columns";
import type { AnyTable } from "../schema/table";
import type { Condition } from "./conditions";
import { compileCondition } from "./conditions";

// @internal Helpers
/** @internal Extract the table name from a table definition. */
function getTableName(table: AnyTable): string {
  return table._.name;
}

/** @internal Extract the column name from a ColumnDef. */
function getColumnName(column: ColumnDef<any, any>): string {
  return column.name;
}

/** @internal Compile a condition to { sql, params }. */
function compileWhere(condition?: Condition): { whereSql: string; params: unknown[] } {
  if (!condition) {
    return { whereSql: "", params: [] };
  }
  const params: unknown[] = [];
  const whereSql = compileCondition(condition, params);
  return { whereSql: ` WHERE ${whereSql}`, params };
}

// Aggregate functions
/**
 * Count all rows in a table, optionally filtered by a condition.
 *
 * @example
 * const total = db.count(users);
 * const active = db.count(users, eq(users.active, true));
 */
export function count<T extends AnyTable>(
  client: Database,
  table: T,
  condition?: Condition,
): number {
  const tableName = getTableName(table);
  const { whereSql, params } = compileWhere(condition);
  const sql = `SELECT count(*) as cnt FROM ${tableName}${whereSql}`;
  const result = client.prepare(sql).get(...(params as SQLQueryBindings[])) as { cnt: number };
  return result.cnt;
}

/**
 * Count non-null values of a column, optionally filtered by a condition.
 *
 * @example
 * const count = db.countColumn(users, users.email);
 */
export function countColumn<T extends AnyTable, C extends ColumnDef<any, any>>(
  client: Database,
  table: T,
  column: C,
  condition?: Condition,
): number {
  const tableName = getTableName(table);
  const columnName = getColumnName(column);
  const { whereSql, params } = compileWhere(condition);
  const sql = `SELECT count(${columnName}) as cnt FROM ${tableName}${whereSql}`;
  const result = client.prepare(sql).get(...(params as SQLQueryBindings[])) as { cnt: number };
  return result.cnt;
}

/**
 * Sum non-null values of a column, optionally filtered by a condition.
 *
 * @example
 * const total = db.sum(orders, orders.amount);
 */
export function sum<T extends AnyTable, C extends ColumnDef<any, any>>(
  client: Database,
  table: T,
  column: C,
  condition?: Condition,
): number | null {
  const tableName = getTableName(table);
  const columnName = getColumnName(column);
  const { whereSql, params } = compileWhere(condition);
  const sql = `SELECT sum(${columnName}) as total FROM ${tableName}${whereSql}`;
  const result = client.prepare(sql).get(...(params as SQLQueryBindings[])) as { total: number | null };
  return result.total;
}

/**
 * Average non-null values of a column, optionally filtered by a condition.
 *
 * @example
 * const avgAge = db.avg(users, users.age);
 */
export function avg<T extends AnyTable, C extends ColumnDef<any, any>>(
  client: Database,
  table: T,
  column: C,
  condition?: Condition,
): number | null {
  const tableName = getTableName(table);
  const columnName = getColumnName(column);
  const { whereSql, params } = compileWhere(condition);
  const sql = `SELECT avg(${columnName}) as average FROM ${tableName}${whereSql}`;
  const result = client.prepare(sql).get(...(params as SQLQueryBindings[])) as { average: number | null };
  return result.average;
}

/**
 * Find the minimum non-null value of a column, optionally filtered by a condition.
 *
 * @example
 * const minAge = db.min(users, users.age);
 */
export function min<T extends AnyTable, C extends ColumnDef<any, any>>(
  client: Database,
  table: T,
  column: C,
  condition?: Condition,
): number | null {
  const tableName = getTableName(table);
  const columnName = getColumnName(column);
  const { whereSql, params } = compileWhere(condition);
  const sql = `SELECT min(${columnName}) as minimum FROM ${tableName}${whereSql}`;
  const result = client.prepare(sql).get(...(params as SQLQueryBindings[])) as { minimum: number | null };
  return result.minimum;
}

/**
 * Find the maximum non-null value of a column, optionally filtered by a condition.
 *
 * @example
 * const maxAge = db.max(users, users.age);
 */
export function max<T extends AnyTable, C extends ColumnDef<any, any>>(
  client: Database,
  table: T,
  column: C,
  condition?: Condition,
): number | null {
  const tableName = getTableName(table);
  const columnName = getColumnName(column);
  const { whereSql, params } = compileWhere(condition);
  const sql = `SELECT max(${columnName}) as maximum FROM ${tableName}${whereSql}`;
  const result = client.prepare(sql).get(...(params as SQLQueryBindings[])) as { maximum: number | null };
  return result.maximum;
}
