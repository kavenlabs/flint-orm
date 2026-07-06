// -----------------------------------------------------------------------
// Condition helpers — typed eq / and / or for WHERE clauses.
// -----------------------------------------------------------------------

import type { ColumnDef } from "../schema/columns";

/** A condition node — either a comparison or a logical组合. */
export type Condition =
  | { type: "eq"; column: ColumnDef<any, any>; value: unknown }
  | { type: "eqColumn"; left: ColumnDef<any, any>; right: ColumnDef<any, any> }
  | { type: "in"; column: ColumnDef<any, any>; values: unknown[] }
  | { type: "notIn"; column: ColumnDef<any, any>; values: unknown[] }
  | { type: "isNull"; column: ColumnDef<any, any> }
  | { type: "isNotNull"; column: ColumnDef<any, any> }
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
