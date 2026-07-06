// -----------------------------------------------------------------------
// Condition helpers — typed eq / and / or for WHERE clauses.
// -----------------------------------------------------------------------

import type { ColumnDef } from "../schema/columns";

/** A condition node — either a comparison or a logical组合. */
export type Condition =
  | { type: "eq"; column: ColumnDef<any, any>; value: unknown }
  | { type: "eqColumn"; left: ColumnDef<any, any>; right: ColumnDef<any, any> }
  | { type: "gt"; column: ColumnDef<any, any>; value: unknown }
  | { type: "gte"; column: ColumnDef<any, any>; value: unknown }
  | { type: "lt"; column: ColumnDef<any, any>; value: unknown }
  | { type: "lte"; column: ColumnDef<any, any>; value: unknown }
  | { type: "neq"; column: ColumnDef<any, any>; value: unknown }
  | { type: "in"; column: ColumnDef<any, any>; values: unknown[] }
  | { type: "notIn"; column: ColumnDef<any, any>; values: unknown[] }
  | { type: "isNull"; column: ColumnDef<any, any> }
  | { type: "isNotNull"; column: ColumnDef<any, any> }
  | { type: "like"; column: ColumnDef<any, any>; pattern: string }
  | { type: "glob"; column: ColumnDef<any, any>; pattern: string }
  | { type: "between"; column: ColumnDef<any, any>; low: unknown; high: unknown }
  | { type: "and"; conditions: Condition[] }
  | { type: "or"; conditions: Condition[] };

/**
 * Equality check — value type is inferred from the column's phantom _type.
 * Also supports column-to-column comparison when the second argument is a ColumnDef.
 */
export function eq<T>(column: ColumnDef<T, any>, value: T): Condition;
export function eq<T>(left: ColumnDef<T, any>, right: ColumnDef<T, any>): Condition;
export function eq(left: ColumnDef<any, any>, valueOrColumn: unknown): Condition {
  if (
    valueOrColumn !== null &&
    typeof valueOrColumn === "object" &&
    "__internal" in (valueOrColumn as any)
  ) {
    return { type: "eqColumn", left, right: valueOrColumn as ColumnDef<any, any> };
  }
  return { type: "eq", column: left, value: valueOrColumn };
}

/** Combine conditions with AND. */
export function and(...conditions: Condition[]): Condition {
  return { type: "and", conditions };
}

/** Combine conditions with OR. */
export function or(...conditions: Condition[]): Condition {
  return { type: "or", conditions };
}

/** Check if column value is in the given array. */
export function isIn<T>(column: ColumnDef<T, any>, values: T[]): Condition {
  return { type: "in", column, values };
}

/** Check if column value is not in the given array. */
export function isNotIn<T>(column: ColumnDef<T, any>, values: T[]): Condition {
  return { type: "notIn", column, values };
}

/** Check if column value is NULL. */
export function isNull(column: ColumnDef<any, any>): Condition {
  return { type: "isNull", column };
}

/** Check if column value is NOT NULL. */
export function isNotNull(column: ColumnDef<any, any>): Condition {
  return { type: "isNotNull", column };
}

/**
 * Pattern match using LIKE.
 * Use `%` for any sequence of characters, `_` for any single character.
 * Case-insensitive by default in SQLite.
 */
export function like(column: ColumnDef<any, any>, pattern: string): Condition {
  return { type: "like", column, pattern };
}

/**
 * Pattern match using GLOB.
 * Use `*` for any sequence of characters, `?` for any single character.
 * Case-sensitive (unlike LIKE).
 */
export function glob(column: ColumnDef<any, any>, pattern: string): Condition {
  return { type: "glob", column, pattern };
}

/**
 * Range check — column value must be between low and high (inclusive).
 */
export function between<T>(column: ColumnDef<T, any>, low: T, high: T): Condition {
  return { type: "between", column, low, high };
}

/** Greater than — column > value. */
export function gt<T>(column: ColumnDef<T, any>, value: T): Condition {
  return { type: "gt", column, value };
}

/** Greater than or equal — column >= value. */
export function gte<T>(column: ColumnDef<T, any>, value: T): Condition {
  return { type: "gte", column, value };
}

/** Less than — column < value. */
export function lt<T>(column: ColumnDef<T, any>, value: T): Condition {
  return { type: "lt", column, value };
}

/** Less than or equal — column <= value. */
export function lte<T>(column: ColumnDef<T, any>, value: T): Condition {
  return { type: "lte", column, value };
}

/** Not equal — column != value. */
export function neq<T>(column: ColumnDef<T, any>, value: T): Condition {
  return { type: "neq", column, value };
}

// -----------------------------------------------------------------------
// Internal: compile a Condition tree to a SQL fragment + params array.
// Encode is applied to every value at this single chokepoint.
// -----------------------------------------------------------------------

export function compileCondition(
  cond: Condition,
  params: unknown[],
): string {
  switch (cond.type) {
    case "eq":
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} = ?`;
    case "eqColumn": {
      const leftName = cond.left.__internal.tableName
        ? `${cond.left.__internal.tableName}.${cond.left.name}`
        : cond.left.name;
      const rightName = cond.right.__internal.tableName
        ? `${cond.right.__internal.tableName}.${cond.right.name}`
        : cond.right.name;
      return `${leftName} = ${rightName}`;
    }
    case "in": {
      const encoded = cond.values.map((v) => cond.column.__internal.encode(v));
      params.push(...encoded);
      const placeholders = encoded.map(() => "?").join(", ");
      return `${cond.column.name} IN (${placeholders})`;
    }
    case "notIn": {
      const encoded = cond.values.map((v) => cond.column.__internal.encode(v));
      params.push(...encoded);
      const placeholders = encoded.map(() => "?").join(", ");
      return `${cond.column.name} NOT IN (${placeholders})`;
    }
    case "isNull":
      return `${cond.column.name} IS NULL`;
    case "isNotNull":
      return `${cond.column.name} IS NOT NULL`;
    case "like":
      params.push(cond.pattern);
      return `${cond.column.name} LIKE ?`;
    case "glob":
      params.push(cond.pattern);
      return `${cond.column.name} GLOB ?`;
    case "between":
      params.push(cond.column.__internal.encode(cond.low));
      params.push(cond.column.__internal.encode(cond.high));
      return `${cond.column.name} BETWEEN ? AND ?`;
    case "gt":
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} > ?`;
    case "gte":
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} >= ?`;
    case "lt":
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} < ?`;
    case "lte":
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} <= ?`;
    case "neq":
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} != ?`;
    case "and":
      return cond.conditions
        .map((c) => compileCondition(c, params))
        .join(" AND ");
    case "or":
      return `(${cond.conditions
        .map((c) => compileCondition(c, params))
        .join(" OR ")})`;
  }
}

export function compileConditions(
  conditions: Condition[],
  params: unknown[],
): string {
  if (conditions.length === 0) return "1=1";
  return conditions.map((c) => compileCondition(c, params)).join(" AND ");
}
