// -----------------------------------------------------------------------
// Query builders — immutable, chainable, parameterized.
// Every value passes through column.__internal.encode() on the way in,
// and column.__internal.decode() on the way out, at a single chokepoint each.
// Builders receive `client` at construction — .execute() takes no arguments.
// -----------------------------------------------------------------------

import type { SQLQueryBindings } from "bun:sqlite";
import type { ColumnDef } from "../schema/columns";
import type { Condition } from "./conditions";
import { compileConditions, eq } from "./conditions";
import type { TableDef, InferRow, InsertRow } from "../schema/table";
import { ValidationError, QueryError } from "../errors";

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

/** Decode a raw SQLite row into the full logical TS shape. */
function decodeRow<T extends TableDef<any>>(raw: Record<string, unknown>, tbl: T): InferRow<T> {
  const out: Record<string, unknown> = {};
  for (const [key, col] of columnEntries(tbl as any)) {
    out[key] = col.__internal.decode(raw[col.name]);
  }
  return out as InferRow<T>;
}

/** Decode a raw row for only the specified columns (column selection). */
function decodeSelectedRow<T extends TableDef<any>, C extends keyof InferRow<T>>(
  raw: Record<string, unknown>,
  tbl: T,
  keys: C[],
): Pick<InferRow<T>, C> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const col: ColumnDef<any, any> = (tbl as any)[key];
    out[key as string] = col.__internal.decode(raw[col.name]);
  }
  return out as Pick<InferRow<T>, C>;
}

/** Find the primary key TS key of a table. */
function findPKKey(tbl: TableDef<any>): string {
  for (const [key, col] of columnEntries(tbl as any)) {
    if (col.__internal.isPrimaryKey) return key;
  }
  throw new ValidationError("Table has no primary key column");
}

/**
 * Resolve a join condition from foreign key references.
 * Scans the child table for columns that reference the parent table.
 * Returns the first matching condition.
 */
function resolveForeignKeyCondition(
  parent: TableDef<any>,
  parentName: string,
  child: TableDef<any>,
  childName: string,
): Condition {
  for (const [, col] of columnEntries(child as any)) {
    if (
      col.__internal.referencesTable === parentName &&
      col.__internal.referencesColumn
    ) {
      // Find the parent column that matches the referenced column name
      const parentCol = (parent as any)[col.__internal.referencesColumn] as ColumnDef<any, any>;
      if (parentCol) {
        return eq(parentCol, col);
      }
    }
  }
  throw new ValidationError(
    `No foreign key reference found from "${childName}" to "${parentName}". Use .references() on the child table or provide an explicit condition.`
  );
}

/** Resolve column list SQL from selected columns or all entries. */
function resolveColumns<T extends TableDef<any>>(
  table: T,
  selectedColumns: string[] | null,
  prefix?: string,
): string {
  if (selectedColumns) {
    return selectedColumns
      .map((k) => {
        const name = (table as any)[k].name;
        return prefix ? `${prefix}.${name}` : name;
      })
      .join(", ");
  }
  const entries = columnEntries(table as any);
  return entries.map(([, c]) => (prefix ? `${prefix}.${c.name}` : c.name)).join(", ");
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
    get(...params: SQLQueryBindings[]): unknown;
    run(...params: SQLQueryBindings[]): void;
  };
}

// -----------------------------------------------------------------------
// Join types
// -----------------------------------------------------------------------

type JoinType = "left" | "inner";

// -----------------------------------------------------------------------
// SELECT — two-phase: SelectStage1 → SelectBuilder
// -----------------------------------------------------------------------

/** Phase 1: only .from() is available. */
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

/**
 * Full SELECT builder — available after .from().
 *
 * C tracks which columns are selected:
 * - Default: keyof InferRow<T> (all columns)
 * - After .columns(): the narrowed Pick type
 */
export class SelectBuilder<
  T extends TableDef<any>,
  C extends keyof InferRow<T> = keyof InferRow<T>,
> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #conditions: Condition[];
  #selectedColumns: C[] | null;
  #orderByClauses: { column: ColumnDef<any, any>; direction: "asc" | "desc" }[];
  #limitValue: number | null;
  #offsetValue: number | null;

  constructor(
    client: DatabaseClient,
    tableName: string,
    table: T,
    conditions: Condition[] = [],
    selectedColumns: C[] | null = null,
    orderByClauses: { column: ColumnDef<any, any>; direction: "asc" | "desc" }[] = [],
    limitValue: number | null = null,
    offsetValue: number | null = null,
  ) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
    this.#orderByClauses = orderByClauses;
    this.#limitValue = limitValue;
    this.#offsetValue = offsetValue;
  }

  where(condition: Condition): SelectBuilder<T, C> {
    return new SelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      [...this.#conditions, condition],
      this.#selectedColumns,
      this.#orderByClauses,
      this.#limitValue,
      this.#offsetValue,
    );
  }

  /**
   * Narrow which columns appear in the result.
   * Each string must be a real key on the table.
   */
  columns<K extends keyof InferRow<T>>(keys: K[]): SelectBuilder<T, K> {
    return new SelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      this.#conditions,
      keys as any,
      this.#orderByClauses,
      this.#limitValue,
      this.#offsetValue,
    );
  }

  /**
   * Return a single row or null instead of an array.
   * Adds LIMIT 1 to the SQL.
   */
  single(): SingleSelectBuilder<T, C> {
    return new SingleSelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      this.#orderByClauses,
      this.#offsetValue,
    );
  }

  /**
   * Add an ORDER BY clause. Multiple calls stack.
   * @param key - Column key to sort by (e.g. "name")
   * @param direction - "asc" or "desc" (default: "asc")
   */
  orderBy<K extends keyof InferRow<T>>(
    key: K,
    direction: "asc" | "desc" = "asc",
  ): SelectBuilder<T, C> {
    const column = (this.#table as any)[key] as ColumnDef<any, any>;
    return new SelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      [...this.#orderByClauses, { column, direction }],
      this.#limitValue,
      this.#offsetValue,
    );
  }

  /**
   * Limit the number of results.
   * @param n - Maximum number of rows to return
   */
  limit(n: number): SelectBuilder<T, C> {
    return new SelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      this.#orderByClauses,
      n,
      this.#offsetValue,
    );
  }

  /**
   * Skip N rows before returning results.
   * @param n - Number of rows to skip
   */
  offset(n: number): SelectBuilder<T, C> {
    return new SelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      this.#orderByClauses,
      this.#limitValue,
      n,
    );
  }

  toSQL(): { sql: string; params: unknown[] } {
    const cols = resolveColumns(this.#table, this.#selectedColumns as string[] | null);
    const params: unknown[] = [];
    let sql = `SELECT ${cols} FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    if (this.#orderByClauses.length > 0) {
      const orderClauses = this.#orderByClauses
        .map((o) => `${o.column.name} ${o.direction.toUpperCase()}`)
        .join(", ");
      sql += ` ORDER BY ${orderClauses}`;
    }
    if (this.#limitValue !== null) sql += ` LIMIT ${this.#limitValue}`;
    if (this.#offsetValue !== null) sql += ` OFFSET ${this.#offsetValue}`;
    return { sql, params };
  }

  execute(): Pick<InferRow<T>, C>[] {
    const { sql, params } = this.toSQL();
    try {
      const rows = this.#client.prepare(sql).all(...bind(params)) as Record<string, unknown>[];
      if (this.#selectedColumns) {
        return rows.map((r) => decodeSelectedRow(r, this.#table, this.#selectedColumns!));
      }
      return rows.map((r) => decodeRow(r, this.#table));
    } catch (e) {
      throw new QueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

// -----------------------------------------------------------------------
// Single-row SELECT builder — after .single() has been called
// -----------------------------------------------------------------------

export class SingleSelectBuilder<
  T extends TableDef<any>,
  C extends keyof InferRow<T> = keyof InferRow<T>,
> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #conditions: Condition[];
  #selectedColumns: C[] | null;
  #orderByClauses: { column: ColumnDef<any, any>; direction: "asc" | "desc" }[];
  #offsetValue: number | null;

  constructor(
    client: DatabaseClient,
    tableName: string,
    table: T,
    conditions: Condition[],
    selectedColumns: C[] | null = null,
    orderByClauses: { column: ColumnDef<any, any>; direction: "asc" | "desc" }[] = [],
    offsetValue: number | null = null,
  ) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
    this.#orderByClauses = orderByClauses;
    this.#offsetValue = offsetValue;
  }

  where(condition: Condition): SingleSelectBuilder<T, C> {
    return new SingleSelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      [...this.#conditions, condition],
      this.#selectedColumns,
      this.#orderByClauses,
      this.#offsetValue,
    );
  }

  orderBy<K extends keyof InferRow<T>>(
    key: K,
    direction: "asc" | "desc" = "asc",
  ): SingleSelectBuilder<T, C> {
    const column = (this.#table as any)[key] as ColumnDef<any, any>;
    return new SingleSelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      [...this.#orderByClauses, { column, direction }],
      this.#offsetValue,
    );
  }

  offset(n: number): SingleSelectBuilder<T, C> {
    return new SingleSelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      this.#orderByClauses,
      n,
    );
  }

  toSQL(): { sql: string; params: unknown[] } {
    const cols = resolveColumns(this.#table, this.#selectedColumns as string[] | null);
    const params: unknown[] = [];
    let sql = `SELECT ${cols} FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    if (this.#orderByClauses.length > 0) {
      const orderClauses = this.#orderByClauses
        .map((o) => `${o.column.name} ${o.direction.toUpperCase()}`)
        .join(", ");
      sql += ` ORDER BY ${orderClauses}`;
    }
    sql += " LIMIT 1";
    if (this.#offsetValue !== null) sql += ` OFFSET ${this.#offsetValue}`;
    return { sql, params };
  }

  /** Returns a single row or null — never throws on empty results. */
  execute(): Pick<InferRow<T>, C> | null {
    const { sql, params } = this.toSQL();
    try {
      const row = this.#client.prepare(sql).get(...bind(params)) as Record<string, unknown> | null;
      if (!row) return null;
      if (this.#selectedColumns) {
        return decodeSelectedRow(row, this.#table, this.#selectedColumns);
      }
      return decodeRow(row, this.#table) as Pick<InferRow<T>, C>;
    } catch (e) {
      throw new QueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

// -----------------------------------------------------------------------
// JOIN — two-phase: JoinSelectStage1 → JoinBuilder
// -----------------------------------------------------------------------

/** Description of a single JOIN clause. */
interface JoinClause {
  table: TableDef<any>;
  name: string;
  condition: Condition;
}

/**
 * Phase 1: only .on(child, condition) is available after db.leftJoin().
 * .on() takes both the child table AND the join condition in one call.
 * Chain multiple .on() calls for multiple joins.
 */
export interface JoinSelectStage1<Parent extends TableDef<any>> {
  on<Child extends TableDef<any>>(child: Child, condition: Condition): JoinBuilder<Parent, [Child]>;
  /** Auto-join: infer condition from foreign key references on the child table. */
  on<Child extends TableDef<any>>(child: Child): JoinBuilder<Parent, [Child]>;
}

/**
 * Full join builder — chain more .on() calls or call .execute().
 * .on(child, condition) adds another join.
 */
export interface JoinBuilder<
  Parent extends TableDef<any>,
  Joined extends TableDef<any>[],
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> {
  on<NewChild extends TableDef<any>>(
    child: NewChild,
    condition: Condition,
  ): JoinBuilder<Parent, [...Joined, NewChild], ParentCols>;
  /** Auto-join: infer condition from foreign key references on the child table. */
  on<NewChild extends TableDef<any>>(
    child: NewChild,
  ): JoinBuilder<Parent, [...Joined, NewChild], ParentCols>;
  columns<K extends keyof InferRow<Parent>>(keys: K[]): JoinBuilder<Parent, Joined, K>;
  where(condition: Condition): JoinBuilder<Parent, Joined, ParentCols>;
  orderBy<K extends keyof InferRow<Parent>>(
    key: K,
    direction?: "asc" | "desc",
  ): JoinBuilder<Parent, Joined, ParentCols>;
  limit(n: number): JoinBuilder<Parent, Joined, ParentCols>;
  offset(n: number): JoinBuilder<Parent, Joined, ParentCols>;
  single(): SingleJoinBuilder<Parent, Joined, ParentCols>;
  toSQL(): { sql: string; params: unknown[] };
  execute(): JoinResult<Parent, Joined, ParentCols>[];
}

/** Single-row join builder — after .single() on a JoinBuilder. */
export interface SingleJoinBuilder<
  Parent extends TableDef<any>,
  Joined extends TableDef<any>[],
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> {
  where(condition: Condition): SingleJoinBuilder<Parent, Joined, ParentCols>;
  orderBy<K extends keyof InferRow<Parent>>(
    key: K,
    direction?: "asc" | "desc",
  ): SingleJoinBuilder<Parent, Joined, ParentCols>;
  offset(n: number): SingleJoinBuilder<Parent, Joined, ParentCols>;
  toSQL(): { sql: string; params: unknown[] };
  execute(): JoinResult<Parent, Joined, ParentCols> | null;
}

/**
 * Implementation of JoinSelectStage1 — only .on(child, condition) is available.
 * This is what db.leftJoin() returns.
 */
export class JoinStage1<Parent extends TableDef<any>> implements JoinSelectStage1<Parent> {
  #client: DatabaseClient;
  #parent: Parent;
  #parentName: string;
  #joinType: JoinType;

  constructor(client: DatabaseClient, parent: Parent, parentName: string, joinType: JoinType) {
    this.#client = client;
    this.#parent = parent;
    this.#parentName = parentName;
    this.#joinType = joinType;
  }

  /**
   * Add a join. Takes both the child table AND the join condition.
   * Returns a builder that allows chaining more .on() calls.
   */
  on<Child extends TableDef<any>>(
    child: Child,
    condition?: Condition,
  ): JoinBuilder<Parent, [Child]> {
    const childName = (child as any)._.name as string;
    const resolvedCondition = condition ?? resolveForeignKeyCondition(this.#parent, this.#parentName, child, childName);
    return new JoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      [{ table: child, name: childName, condition: resolvedCondition }],
      this.#joinType,
    );
  }
}

/**
 * Full JOIN builder — chains .on(child, condition) calls, executes with nested results.
 *
 * One-to-many joins produce nested results: the parent row appears once
 * with each joined table's data under its table name as key.
 */
export class JoinBuilderImpl<
  Parent extends TableDef<any>,
  Joined extends TableDef<any>[],
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> implements JoinBuilder<Parent, Joined, ParentCols> {
  #client: DatabaseClient;
  #parent: Parent;
  #parentName: string;
  #joins: JoinClause[];
  #joinType: JoinType;
  #conditions: Condition[];
  #selectedColumns: ParentCols[] | null;
  #orderByClauses: { column: ColumnDef<any, any>; direction: "asc" | "desc" }[];
  #limitValue: number | null;
  #offsetValue: number | null;

  constructor(
    client: DatabaseClient,
    parent: Parent,
    parentName: string,
    joins: JoinClause[],
    joinType: JoinType,
    conditions: Condition[] = [],
    selectedColumns: ParentCols[] | null = null,
    orderByClauses: { column: ColumnDef<any, any>; direction: "asc" | "desc" }[] = [],
    limitValue: number | null = null,
    offsetValue: number | null = null,
  ) {
    this.#client = client;
    this.#parent = parent;
    this.#parentName = parentName;
    this.#joins = joins;
    this.#joinType = joinType;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
    this.#orderByClauses = orderByClauses;
    this.#limitValue = limitValue;
    this.#offsetValue = offsetValue;
  }

  /**
   * Add another join. Takes both the child table AND the join condition.
   * Returns a new builder with the accumulated joins.
   */
  on<NewChild extends TableDef<any>>(
    child: NewChild,
    condition?: Condition,
  ): JoinBuilder<Parent, [...Joined, NewChild], ParentCols> {
    const childName = (child as any)._.name as string;
    const resolvedCondition = condition ?? resolveForeignKeyCondition(this.#parent, this.#parentName, child, childName);
    return new JoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      [...this.#joins, { table: child, name: childName, condition: resolvedCondition }],
      this.#joinType,
      this.#conditions,
      this.#selectedColumns,
    ) as any;
  }

  where(condition: Condition): JoinBuilder<Parent, Joined, ParentCols> {
    return new JoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#joins,
      this.#joinType,
      [...this.#conditions, condition],
      this.#selectedColumns,
    ) as any;
  }

  columns<K extends keyof InferRow<Parent>>(keys: K[]): JoinBuilder<Parent, Joined, K> {
    return new JoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#joins,
      this.#joinType,
      this.#conditions,
      keys as any,
      this.#orderByClauses,
      this.#limitValue,
      this.#offsetValue,
    ) as any;
  }

  orderBy<K extends keyof InferRow<Parent>>(
    key: K,
    direction: "asc" | "desc" = "asc",
  ): JoinBuilder<Parent, Joined, ParentCols> {
    const column = (this.#parent as any)[key] as ColumnDef<any, any>;
    return new JoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#joins,
      this.#joinType,
      this.#conditions,
      this.#selectedColumns,
      [...this.#orderByClauses, { column, direction }],
      this.#limitValue,
      this.#offsetValue,
    ) as any;
  }

  limit(n: number): JoinBuilder<Parent, Joined, ParentCols> {
    return new JoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#joins,
      this.#joinType,
      this.#conditions,
      this.#selectedColumns,
      this.#orderByClauses,
      n,
      this.#offsetValue,
    ) as any;
  }

  offset(n: number): JoinBuilder<Parent, Joined, ParentCols> {
    return new JoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#joins,
      this.#joinType,
      this.#conditions,
      this.#selectedColumns,
      this.#orderByClauses,
      this.#limitValue,
      n,
    ) as any;
  }

  single(): SingleJoinBuilder<Parent, Joined, ParentCols> {
    return new SingleJoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#joins,
      this.#joinType,
      this.#conditions,
      this.#selectedColumns,
      this.#orderByClauses,
      this.#offsetValue,
    ) as any;
  }

  toSQL(): { sql: string; params: unknown[] } {
    const parentCols = resolveColumns(
      this.#parent,
      this.#selectedColumns as string[] | null,
      this.#parentName,
    );

    const childCols: string[] = [];
    for (const join of this.#joins) {
      const entries = columnEntries(join.table as any);
      for (const [, c] of entries) {
        childCols.push(`${join.name}.${c.name} AS ${join.name}_${c.name}`);
      }
    }

    const joinKeyword = this.#joinType === "left" ? "LEFT JOIN" : "INNER JOIN";
    const joinClauses: string[] = [];
    const joinParams: unknown[] = [];
    for (const join of this.#joins) {
      const joinOn = compileConditions([join.condition], joinParams);
      joinClauses.push(`${joinKeyword} ${join.name} ON ${joinOn}`);
    }

    const whereParams: unknown[] = [];
    const where = compileConditions(this.#conditions, whereParams);

    let sql = `SELECT ${parentCols}${childCols.length ? ", " + childCols.join(", ") : ""} FROM ${this.#parentName} ${joinClauses.join(" ")}`;
    if (where !== "1=1") sql += ` WHERE ${where}`;
    if (this.#orderByClauses.length > 0) {
      const orderClauses = this.#orderByClauses
        .map((o) => `${o.column.name} ${o.direction.toUpperCase()}`)
        .join(", ");
      sql += ` ORDER BY ${orderClauses}`;
    }
    if (this.#limitValue !== null) sql += ` LIMIT ${this.#limitValue}`;
    if (this.#offsetValue !== null) sql += ` OFFSET ${this.#offsetValue}`;

    return { sql, params: [...joinParams, ...whereParams] };
  }

  execute(): JoinResult<Parent, Joined, ParentCols>[] {
    const { sql, params } = this.toSQL();
    try {
      const rows = this.#client.prepare(sql).all(...bind(params)) as Record<string, unknown>[];

      // Group flat rows by parent PK
      const parentEntries = columnEntries(this.#parent as any);
      const pkKey = findPKKey(this.#parent);
      const pkColName = (this.#parent as any)[pkKey].name;

      // Build child entry maps for each join
      const childEntryMaps: {
        name: string;
        entries: [string, ColumnDef<any, any>][];
        table: TableDef<any>;
      }[] = [];
      for (const j of this.#joins) {
        childEntryMaps.push({
          name: j.name,
          entries: columnEntries(j.table as any),
          table: j.table,
        });
      }

      const grouped = new Map<
        unknown,
        { parent: Record<string, unknown>; children: Record<string, unknown>[][] }
      >();

      for (const row of rows) {
        const pk = row[pkColName];
        if (!grouped.has(pk)) {
          const parentRow: Record<string, unknown> = {};
          for (const [key, col] of parentEntries) {
            parentRow[key] = row[col.name];
          }
          grouped.set(pk, {
            parent: parentRow,
            children: childEntryMaps.map(() => []),
          });
        }

        const group = grouped.get(pk)!;
        childEntryMaps.forEach((childMap, i) => {
          const childRow: Record<string, unknown> = {};
          let hasNonNullChild = false;
          for (const [key, col] of childMap.entries) {
            const val = row[`${childMap.name}_${col.name}`];
            childRow[key] = val;
            if (val != null) hasNonNullChild = true;
          }
          if (this.#joinType === "left" && !hasNonNullChild) return;
          group.children[i]!.push(childRow);
        });
      }

      // Build nested result
      const result: JoinResult<Parent, Joined, ParentCols>[] = [];
      for (const { parent, children } of grouped.values()) {
        const decodedParent = this.#selectedColumns
          ? decodeSelectedRow(parent, this.#parent, this.#selectedColumns)
          : decodeRow(parent, this.#parent);

        const nested: Record<string, unknown> = { ...decodedParent };
        childEntryMaps.forEach((childMap, i) => {
          nested[childMap.name] = children[i]!.map((c) => decodeRow(c, childMap.table));
        });

        result.push(nested as JoinResult<Parent, Joined, ParentCols>);
      }

      return result;
    } catch (e) {
      if (e instanceof QueryError) throw e;
      throw new QueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

/**
 * Result type for joined queries.
 * Parent fields are Pick'd if .columns() was used.
 * Each joined table's data is nested under its table name as an array.
 */
export type JoinResult<
  Parent extends TableDef<any>,
  Joined extends TableDef<any>[],
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> = Pick<InferRow<Parent>, ParentCols> & Record<string, unknown>;

// -----------------------------------------------------------------------
// Single-row JOIN builder — after .single() on a JoinBuilder
// -----------------------------------------------------------------------

export class SingleJoinBuilderImpl<
  Parent extends TableDef<any>,
  Joined extends TableDef<any>[],
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> implements Executable {
  #client: DatabaseClient;
  #parent: Parent;
  #parentName: string;
  #joins: JoinClause[];
  #joinType: JoinType;
  #conditions: Condition[];
  #selectedColumns: ParentCols[] | null;
  #orderByClauses: { column: ColumnDef<any, any>; direction: "asc" | "desc" }[];
  #offsetValue: number | null;

  constructor(
    client: DatabaseClient,
    parent: Parent,
    parentName: string,
    joins: JoinClause[],
    joinType: JoinType,
    conditions: Condition[],
    selectedColumns: ParentCols[] | null = null,
    orderByClauses: { column: ColumnDef<any, any>; direction: "asc" | "desc" }[] = [],
    offsetValue: number | null = null,
  ) {
    this.#client = client;
    this.#parent = parent;
    this.#parentName = parentName;
    this.#joins = joins;
    this.#joinType = joinType;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
    this.#orderByClauses = orderByClauses;
    this.#offsetValue = offsetValue;
  }

  where(condition: Condition): SingleJoinBuilderImpl<Parent, Joined, ParentCols> {
    return new SingleJoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#joins,
      this.#joinType,
      [...this.#conditions, condition],
      this.#selectedColumns,
      this.#orderByClauses,
      this.#offsetValue,
    );
  }

  orderBy<K extends keyof InferRow<Parent>>(
    key: K,
    direction: "asc" | "desc" = "asc",
  ): SingleJoinBuilderImpl<Parent, Joined, ParentCols> {
    const column = (this.#parent as any)[key] as ColumnDef<any, any>;
    return new SingleJoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#joins,
      this.#joinType,
      this.#conditions,
      this.#selectedColumns,
      [...this.#orderByClauses, { column, direction }],
      this.#offsetValue,
    );
  }

  offset(n: number): SingleJoinBuilderImpl<Parent, Joined, ParentCols> {
    return new SingleJoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#joins,
      this.#joinType,
      this.#conditions,
      this.#selectedColumns,
      this.#orderByClauses,
      n,
    );
  }

  toSQL(): { sql: string; params: unknown[] } {
    const parentCols = resolveColumns(
      this.#parent,
      this.#selectedColumns as string[] | null,
      this.#parentName,
    );

    const childCols: string[] = [];
    for (const join of this.#joins) {
      const entries = columnEntries(join.table as any);
      for (const [, c] of entries) {
        childCols.push(`${join.name}.${c.name} AS ${join.name}_${c.name}`);
      }
    }

    const joinKeyword = this.#joinType === "left" ? "LEFT JOIN" : "INNER JOIN";
    const joinClauses: string[] = [];
    const joinParams: unknown[] = [];
    for (const join of this.#joins) {
      const joinOn = compileConditions([join.condition], joinParams);
      joinClauses.push(`${joinKeyword} ${join.name} ON ${joinOn}`);
    }

    const whereParams: unknown[] = [];
    const where = compileConditions(this.#conditions, whereParams);

    let sql = `SELECT ${parentCols}${childCols.length ? ", " + childCols.join(", ") : ""} FROM ${this.#parentName} ${joinClauses.join(" ")}`;
    if (where !== "1=1") sql += ` WHERE ${where}`;
    if (this.#orderByClauses.length > 0) {
      const orderClauses = this.#orderByClauses
        .map((o) => `${o.column.name} ${o.direction.toUpperCase()}`)
        .join(", ");
      sql += ` ORDER BY ${orderClauses}`;
    }
    sql += " LIMIT 1";
    if (this.#offsetValue !== null) sql += ` OFFSET ${this.#offsetValue}`;

    return { sql, params: [...joinParams, ...whereParams] };
  }

  /** Returns a single parent with nested children, or null. */
  execute(): JoinResult<Parent, Joined, ParentCols> | null {
    const { sql, params } = this.toSQL();
    try {
      const allRows = this.#client.prepare(sql).all(...bind(params)) as Record<string, unknown>[];
      if (allRows.length === 0) return null;

      // Group by parent PK (same logic as JoinBuilderImpl.execute)
      const parentEntries = columnEntries(this.#parent as any);
      const pkKey = findPKKey(this.#parent);
      const pkColName = (this.#parent as any)[pkKey].name;

      const childEntryMaps: {
        name: string;
        entries: [string, ColumnDef<any, any>][];
        table: TableDef<any>;
      }[] = [];
      for (const j of this.#joins) {
        childEntryMaps.push({
          name: j.name,
          entries: columnEntries(j.table as any),
          table: j.table,
        });
      }

      const grouped = new Map<
        unknown,
        { parent: Record<string, unknown>; children: Record<string, unknown>[][] }
      >();

      for (const r of allRows) {
        const pk = r[pkColName];
        if (!grouped.has(pk)) {
          const parentRow: Record<string, unknown> = {};
          for (const [key, col] of parentEntries) {
            parentRow[key] = r[col.name];
          }
          grouped.set(pk, {
            parent: parentRow,
            children: childEntryMaps.map(() => []),
          });
        }

        const group = grouped.get(pk)!;
        childEntryMaps.forEach((childMap, i) => {
          const childRow: Record<string, unknown> = {};
          let hasNonNullChild = false;
          for (const [key, col] of childMap.entries) {
            const val = r[`${childMap.name}_${col.name}`];
            childRow[key] = val;
            if (val != null) hasNonNullChild = true;
          }
          if (this.#joinType === "left" && !hasNonNullChild) return;
          group.children[i]!.push(childRow);
        });
      }

      const first = grouped.values().next().value;
      if (!first) return null;

      const decodedParent = this.#selectedColumns
        ? decodeSelectedRow(first.parent, this.#parent, this.#selectedColumns)
        : decodeRow(first.parent, this.#parent);

      const nested: Record<string, unknown> = { ...decodedParent };
      childEntryMaps.forEach((childMap, i) => {
        nested[childMap.name] = first.children[i]!.map((c) => decodeRow(c, childMap.table));
      });

      return nested as JoinResult<Parent, Joined, ParentCols>;
    } catch (e) {
      if (e instanceof QueryError) throw e;
      throw new QueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

// -----------------------------------------------------------------------
// INSERT — two-phase: InsertStage1 (only .values()) → InsertBuilder
// -----------------------------------------------------------------------

/** First phase: only .values() is available. Prevents .toSQL()/.execute() before supplying a row. */
export interface InsertStage1<T extends TableDef<any>> {
  values(row: InsertRow<T>): InsertBuilder<T>;
}

/** Lightweight wrapper that only exposes .values(). */
export class InsertValuesBuilder<T extends TableDef<any>> implements InsertStage1<T> {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;

  constructor(client: DatabaseClient, tableName: string, table: T) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
  }

  values(row: InsertRow<T>): InsertBuilder<T> {
    return new InsertBuilder(this.#client, this.#tableName, this.#table, row);
  }
}

/** Full INSERT builder — available after .values() has been called. */
export class InsertBuilder<T extends TableDef<any>> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #row: InsertRow<T>;

  constructor(client: DatabaseClient, tableName: string, table: T, row: InsertRow<T>) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#row = row;
  }

  toSQL(): { sql: string; params: unknown[] } {
    const entries = columnEntries(this.#table as any);

    // Filter out columns with defaults when value is undefined
    const inserts: [string, ColumnDef<any, any>][] = [];
    for (const [key, c] of entries) {
      const value = (this.#row as any)[key];
      if (value === undefined && c.__internal.hasDefault) {
        // Skip — let SQLite handle the default
        continue;
      }
      if (value === undefined && c.__internal.isAutoIncrement) {
        // Skip — let SQLite handle autoincrement
        continue;
      }
      if (value === undefined && c.__internal.hasDefaultNow) {
        // Use current time as default
        inserts.push([key, c]);
        continue;
      }
      inserts.push([key, c]);
    }

    if (inserts.length === 0) {
      // All columns have defaults — insert with defaults only
      const allDefault = entries.filter(
        ([, c]) =>
          c.__internal.hasDefault || c.__internal.isAutoIncrement || c.__internal.hasDefaultNow,
      );
      const names = allDefault.map(([, c]) => c.name).join(", ");
      const placeholders = allDefault.map(() => "DEFAULT").join(", ");
      return {
        sql: `INSERT INTO ${this.#tableName} (${names}) VALUES (${placeholders})`,
        params: [],
      };
    }

    const names = inserts.map(([, c]) => c.name).join(", ");
    const placeholders = inserts.map(() => "?").join(", ");
    const params = inserts.map(([key, c]) => {
      const value = (this.#row as any)[key];
      if (value === undefined && c.__internal.hasDefaultNow) {
        return c.__internal.encode(new Date());
      }
      return c.__internal.encode(value);
    });
    return {
      sql: `INSERT INTO ${this.#tableName} (${names}) VALUES (${placeholders})`,
      params,
    };
  }

  execute(): void {
    const { sql, params } = this.toSQL();
    try {
      this.#client.prepare(sql).run(...bind(params));
    } catch (e) {
      throw new QueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

// -----------------------------------------------------------------------
// UPDATE — two-phase: UpdateStage1 (only .set()) → UpdateBuilder
// -----------------------------------------------------------------------

/** First phase: only .set() is available. Prevents .toSQL()/.execute() before supplying values. */
export interface UpdateStage1<T extends TableDef<any>> {
  set(partial: Partial<InferRow<T>>): UpdateBuilder<T>;
}

/** Lightweight wrapper that only exposes .set(). */
export class UpdateSetBuilder<T extends TableDef<any>> implements UpdateStage1<T> {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;

  constructor(client: DatabaseClient, tableName: string, table: T) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
  }

  set(partial: Partial<InferRow<T>>): UpdateBuilder<T> {
    return new UpdateBuilder(this.#client, this.#tableName, this.#table, partial);
  }
}

/** Full UPDATE builder — available after .set() has been called. */
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
    set: Partial<InferRow<T>>,
    conditions: Condition[] = [],
  ) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#set = set;
    this.#conditions = conditions;
  }

  set(partial: Partial<InferRow<T>>): UpdateBuilder<T> {
    return new UpdateBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      { ...this.#set, ...partial },
      this.#conditions,
    );
  }

  where(condition: Condition): UpdateBuilder<T> {
    return new UpdateBuilder(this.#client, this.#tableName, this.#table, this.#set, [
      ...this.#conditions,
      condition,
    ]);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const setClauses: string[] = [];
    const setKeys = new Set(Object.keys(this.#set));
    for (const key of Object.keys(this.#set)) {
      const col: ColumnDef<any, any> = (this.#table as any)[key];
      // onUpdate always wins — ignore user value
      if (col.__internal.hasOnUpdate) {
        setClauses.push(`${col.name} = ?`);
        params.push(col.__internal.encode(new Date()));
        continue;
      }
      setClauses.push(`${col.name} = ?`);
      params.push(col.__internal.encode((this.#set as any)[key]));
    }
    let sql = `UPDATE ${this.#tableName} SET ${setClauses.join(", ")}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    return { sql, params };
  }

  execute(): void {
    const { sql, params } = this.toSQL();
    try {
      this.#client.prepare(sql).run(...bind(params));
    } catch (e) {
      throw new QueryError(`Failed to execute query: ${sql}`, e as Error);
    }
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
    return new DeleteBuilder(this.#client, this.#tableName, this.#table, [
      ...this.#conditions,
      condition,
    ]);
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
    try {
      this.#client.prepare(sql).run(...bind(params));
    } catch (e) {
      throw new QueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}
