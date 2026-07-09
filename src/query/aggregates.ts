// Aggregate functions
import type { Executor } from '../executor';
import type { ColumnDef } from '../schema/columns';
import type { AnyTable } from '../schema/table';
import type { Condition } from './conditions';
import { compileCondition } from './conditions';

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
    return { whereSql: '', params: [] };
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
 * const total = await db.count(users);
 * const active = await db.count(users, eq(users.active, true));
 */
export async function count<T extends AnyTable>(executor: Executor, table: T, condition?: Condition): Promise<number> {
  const tableName = getTableName(table);
  const { whereSql, params } = compileWhere(condition);
  const sql = `SELECT count(*) as cnt FROM ${tableName}${whereSql}`;
  const result = await executor.get(sql, params);
  return (result as { cnt: number }).cnt;
}

/**
 * Count non-null values of a column, optionally filtered by a condition.
 *
 * @example
 * const count = await db.countColumn(users, users.email);
 */
export async function countColumn<T extends AnyTable, C extends ColumnDef<any, any>>(
  executor: Executor,
  table: T,
  column: C,
  condition?: Condition,
): Promise<number> {
  const tableName = getTableName(table);
  const columnName = getColumnName(column);
  const { whereSql, params } = compileWhere(condition);
  const sql = `SELECT count(${columnName}) as cnt FROM ${tableName}${whereSql}`;
  const result = await executor.get(sql, params);
  return (result as { cnt: number }).cnt;
}

/**
 * Sum non-null values of a column, optionally filtered by a condition.
 *
 * @example
 * const total = await db.sum(orders, orders.amount);
 */
export async function sum<T extends AnyTable, C extends ColumnDef<any, any>>(
  executor: Executor,
  table: T,
  column: C,
  condition?: Condition,
): Promise<number | null> {
  const tableName = getTableName(table);
  const columnName = getColumnName(column);
  const { whereSql, params } = compileWhere(condition);
  const sql = `SELECT sum(${columnName}) as total FROM ${tableName}${whereSql}`;
  const result = await executor.get(sql, params);
  return (result as { total: number | null }).total;
}

/**
 * Average non-null values of a column, optionally filtered by a condition.
 *
 * @example
 * const avgAge = await db.avg(users, users.age);
 */
export async function avg<T extends AnyTable, C extends ColumnDef<any, any>>(
  executor: Executor,
  table: T,
  column: C,
  condition?: Condition,
): Promise<number | null> {
  const tableName = getTableName(table);
  const columnName = getColumnName(column);
  const { whereSql, params } = compileWhere(condition);
  const sql = `SELECT avg(${columnName}) as average FROM ${tableName}${whereSql}`;
  const result = await executor.get(sql, params);
  return (result as { average: number | null }).average;
}

/**
 * Find the minimum non-null value of a column, optionally filtered by a condition.
 *
 * @example
 * const minAge = await db.min(users, users.age);
 */
export async function min<T extends AnyTable, C extends ColumnDef<any, any>>(
  executor: Executor,
  table: T,
  column: C,
  condition?: Condition,
): Promise<number | null> {
  const tableName = getTableName(table);
  const columnName = getColumnName(column);
  const { whereSql, params } = compileWhere(condition);
  const sql = `SELECT min(${columnName}) as minimum FROM ${tableName}${whereSql}`;
  const result = await executor.get(sql, params);
  return (result as { minimum: number | null }).minimum;
}

/**
 * Find the maximum non-null value of a column, optionally filtered by a condition.
 *
 * @example
 * const maxAge = await db.max(users, users.age);
 */
export async function max<T extends AnyTable, C extends ColumnDef<any, any>>(
  executor: Executor,
  table: T,
  column: C,
  condition?: Condition,
): Promise<number | null> {
  const tableName = getTableName(table);
  const columnName = getColumnName(column);
  const { whereSql, params } = compileWhere(condition);
  const sql = `SELECT max(${columnName}) as maximum FROM ${tableName}${whereSql}`;
  const result = await executor.get(sql, params);
  return (result as { maximum: number | null }).maximum;
}
