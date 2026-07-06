// -----------------------------------------------------------------------
// Aggregate functions — count, countColumn, sum, avg, min, max
// -----------------------------------------------------------------------

import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { ColumnDef } from "../schema/columns";
import type { AnyTable } from "../schema/table";
import type { Condition } from "./conditions";
import { compileCondition } from "./conditions";

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Extract the table name from a table definition. */
function getTableName(table: AnyTable): string {
  return table._.name;
}

/** Extract the column name from a ColumnDef. */
function getColumnName(column: ColumnDef<any, any>): string {
  return column.name;
}

/** Compile a condition to { sql, params } — returns empty string if no condition. */
function compileWhere(condition?: Condition): { whereSql: string; params: unknown[] } {
  if (!condition) {
    return { whereSql: "", params: [] };
  }
  const params: unknown[] = [];
  const whereSql = compileCondition(condition, params);
  return { whereSql: ` WHERE ${whereSql}`, params };
}

// -----------------------------------------------------------------------
// Aggregate functions
// -----------------------------------------------------------------------

/**
 * count(*) — count all rows in the table.
 * @param table - The table to count rows from
 * @param condition - Optional WHERE condition
 * @returns The count as a number
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
 * count(column) — count non-null values of a column.
 * @param table - The table to count from
 * @param column - The column to count non-null values for
 * @param condition - Optional WHERE condition
 * @returns The count as a number
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
 * sum(column) — sum of non-null values.
 * @param table - The table to sum from
 * @param column - The column to sum
 * @param condition - Optional WHERE condition
 * @returns The sum as a number, or null if no rows match
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
 * avg(column) — average of non-null values.
 * @param table - The table to average from
 * @param column - The column to average
 * @param condition - Optional WHERE condition
 * @returns The average as a number, or null if no rows match
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
 * min(column) — minimum non-null value.
 * @param table - The table to find minimum from
 * @param column - The column to find minimum of
 * @param condition - Optional WHERE condition
 * @returns The minimum value, or null if no rows match
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
 * max(column) — maximum non-null value.
 * @param table - The table to find maximum from
 * @param column - The column to find maximum of
 * @param condition - Optional WHERE condition
 * @returns The maximum value, or null if no rows match
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
