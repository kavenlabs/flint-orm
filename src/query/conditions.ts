// ---------------------------------------------------------------------------
// Condition helpers — typed eq / and / or for WHERE clauses.
// ---------------------------------------------------------------------------

import type { ColumnDef } from "../schema/columns";

/** A condition node — either a comparison or a logical组合. */
export type Condition =
  | { type: "eq"; column: ColumnDef<any, any>; value: unknown }
  | { type: "and"; conditions: Condition[] }
  | { type: "or"; conditions: Condition[] };

/** Equality check — value type is inferred from the column's phantom _type. */
export function eq<T>(column: ColumnDef<T, any>, value: T): Condition {
  return { type: "eq", column, value };
}

/** Combine conditions with AND. */
export function and(...conditions: Condition[]): Condition {
  return { type: "and", conditions };
}

/** Combine conditions with OR. */
export function or(...conditions: Condition[]): Condition {
  return { type: "or", conditions };
}

// ---------------------------------------------------------------------------
// Internal: compile a Condition tree to a SQL fragment + params array.
// Encode is applied to every value at this single chokepoint.
// ---------------------------------------------------------------------------

export function compileCondition(
  cond: Condition,
  params: unknown[],
): string {
  switch (cond.type) {
    case "eq":
      params.push(cond.column.__internal.encode(cond.value));
      return `${cond.column.name} = ?`;
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
