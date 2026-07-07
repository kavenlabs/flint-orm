// Condition helpers
import type { ColumnDef } from '../schema/columns';

/** A condition node used in WHERE clauses. */
export type Condition =
  | { type: 'eq'; column: ColumnDef<any, any>; value: unknown }
  | { type: 'eqColumn'; left: ColumnDef<any, any>; right: ColumnDef<any, any> }
  | { type: 'gt'; column: ColumnDef<any, any>; value: unknown }
  | { type: 'gte'; column: ColumnDef<any, any>; value: unknown }
  | { type: 'lt'; column: ColumnDef<any, any>; value: unknown }
  | { type: 'lte'; column: ColumnDef<any, any>; value: unknown }
  | { type: 'neq'; column: ColumnDef<any, any>; value: unknown }
  | { type: 'in'; column: ColumnDef<any, any>; values: unknown[] }
  | { type: 'notIn'; column: ColumnDef<any, any>; values: unknown[] }
  | { type: 'isNull'; column: ColumnDef<any, any> }
  | { type: 'isNotNull'; column: ColumnDef<any, any> }
  | { type: 'like'; column: ColumnDef<any, any>; pattern: string }
  | { type: 'glob'; column: ColumnDef<any, any>; pattern: string }
  | { type: 'between'; column: ColumnDef<any, any>; low: unknown; high: unknown }
  | { type: 'and'; conditions: Condition[] }
  | { type: 'or'; conditions: Condition[] };

/** @internal Type guard — check if a value is a ColumnDef. */
function isColumnDef(value: unknown): value is ColumnDef<any, any> {
  return value !== null && typeof value === 'object' && '__internal' in (value as Record<string, unknown>);
}

/**
 * Check if a column equals a value, or if two columns are equal.
 *
 * @example
 * // Value comparison
 * where(eq(users.name, "Alice"))
 *
 * // Column-to-column comparison
 * where(eq(orders.userId, users.id))
 */
export function eq<T>(column: ColumnDef<T, any>, value: T): Condition;
export function eq<T>(left: ColumnDef<T, any>, right: ColumnDef<T, any>): Condition;
export function eq(left: ColumnDef<any, any>, valueOrColumn: unknown): Condition {
  if (isColumnDef(valueOrColumn)) {
    return { type: 'eqColumn', left, right: valueOrColumn };
  }
  return { type: 'eq', column: left, value: valueOrColumn };
}

/**
 * Combine conditions with AND.
 *
 * @example
 * where(and(eq(users.name, "Alice"), eq(users.active, true)))
 */
export function and(...conditions: Condition[]): Condition {
  return { type: 'and', conditions };
}

/**
 * Combine conditions with OR.
 *
 * @example
 * where(or(eq(users.role, "admin"), eq(users.role, "moderator")))
 */
export function or(...conditions: Condition[]): Condition {
  return { type: 'or', conditions };
}

/**
 * Check if a column's value is in the given array.
 *
 * @example
 * where(isIn(users.id, ["u1", "u2", "u3"]))
 */
export function isIn<T>(column: ColumnDef<T, any>, values: T[]): Condition {
  return { type: 'in', column, values };
}

/**
 * Check if a column's value is not in the given array.
 *
 * @example
 * where(isNotIn(users.id, ["u4", "u5"]))
 */
export function isNotIn<T>(column: ColumnDef<T, any>, values: T[]): Condition {
  return { type: 'notIn', column, values };
}

/**
 * Check if a column is NULL.
 *
 * @example
 * where(isNull(users.deletedAt))
 */
export function isNull(column: ColumnDef<any, any>): Condition {
  return { type: 'isNull', column };
}

/**
 * Check if a column is NOT NULL.
 *
 * @example
 * where(isNotNull(users.name))
 */
export function isNotNull(column: ColumnDef<any, any>): Condition {
  return { type: 'isNotNull', column };
}

/**
 * Pattern match using SQL `LIKE`. Use `%` for any sequence of characters, `_` for a single character.
 *
 * @example
 * where(like(users.name, "A%"))
 */
export function like(column: ColumnDef<any, any>, pattern: string): Condition {
  return { type: 'like', column, pattern };
}

/**
 * Pattern match using SQL `GLOB`. Use `*` for any sequence of characters, `?` for a single character.
 *
 * @example
 * where(glob(users.name, "A*"))
 */
export function glob(column: ColumnDef<any, any>, pattern: string): Condition {
  return { type: 'glob', column, pattern };
}

/**
 * Check if a column's value is between `low` and `high` (inclusive).
 *
 * @example
 * where(between(users.age, 18, 65))
 */
export function between<T>(column: ColumnDef<T, any>, low: T, high: T): Condition {
  return { type: 'between', column, low, high };
}

/**
 * Check if a column's value is greater than a value.
 *
 * @example
 * where(gt(users.age, 18))
 */
export function gt<T>(column: ColumnDef<T, any>, value: T): Condition {
  return { type: 'gt', column, value };
}

/**
 * Check if a column's value is greater than or equal to a value.
 *
 * @example
 * where(gte(users.age, 18))
 */
export function gte<T>(column: ColumnDef<T, any>, value: T): Condition {
  return { type: 'gte', column, value };
}

/**
 * Check if a column's value is less than a value.
 *
 * @example
 * where(lt(users.age, 65))
 */
export function lt<T>(column: ColumnDef<T, any>, value: T): Condition {
  return { type: 'lt', column, value };
}

/**
 * Check if a column's value is less than or equal to a value.
 *
 * @example
 * where(lte(users.age, 65))
 */
export function lte<T>(column: ColumnDef<T, any>, value: T): Condition {
  return { type: 'lte', column, value };
}

/**
 * Check if a column's value is not equal to a value.
 *
 * @example
 * where(neq(users.id, "u1"))
 */
export function neq<T>(column: ColumnDef<T, any>, value: T): Condition {
  return { type: 'neq', column, value };
}

export function compileCondition(cond: Condition, params: unknown[]): string {
  switch (cond.type) {
    case 'eq':
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} = ?`;
    case 'eqColumn': {
      const leftName = cond.left.__internal.tableName ? `${cond.left.__internal.tableName}.${cond.left.name}` : cond.left.name;
      const rightName = cond.right.__internal.tableName ? `${cond.right.__internal.tableName}.${cond.right.name}` : cond.right.name;
      return `${leftName} = ${rightName}`;
    }
    case 'in': {
      const encoded = cond.values.map((v) => cond.column.__internal.encode(v));
      params.push(...encoded);
      const placeholders = encoded.map(() => '?').join(', ');
      return `${cond.column.name} IN (${placeholders})`;
    }
    case 'notIn': {
      const encoded = cond.values.map((v) => cond.column.__internal.encode(v));
      params.push(...encoded);
      const placeholders = encoded.map(() => '?').join(', ');
      return `${cond.column.name} NOT IN (${placeholders})`;
    }
    case 'isNull':
      return `${cond.column.name} IS NULL`;
    case 'isNotNull':
      return `${cond.column.name} IS NOT NULL`;
    case 'like':
      params.push(cond.pattern);
      return `${cond.column.name} LIKE ?`;
    case 'glob':
      params.push(cond.pattern);
      return `${cond.column.name} GLOB ?`;
    case 'between':
      params.push(cond.column.__internal.encode(cond.low));
      params.push(cond.column.__internal.encode(cond.high));
      return `${cond.column.name} BETWEEN ? AND ?`;
    case 'gt':
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} > ?`;
    case 'gte':
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} >= ?`;
    case 'lt':
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} < ?`;
    case 'lte':
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} <= ?`;
    case 'neq':
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} != ?`;
    case 'and':
      return cond.conditions.map((c) => compileCondition(c, params)).join(' AND ');
    case 'or':
      return `(${cond.conditions.map((c) => compileCondition(c, params)).join(' OR ')})`;
  }
}

export function compileConditions(conditions: Condition[], params: unknown[]): string {
  if (conditions.length === 0) return '1=1';
  return conditions.map((c) => compileCondition(c, params)).join(' AND ');
}
