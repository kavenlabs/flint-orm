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

/** Decode a raw SQLite row into the full logical TS shape. */
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

/** Decode a flat joined row into two separate table shapes. */
function decodeJoinedRow<Parent extends TableDef<any>, Child extends TableDef<any>>(
  raw: Record<string, unknown>,
  parent: Parent,
  child: Child,
): [InferRow<Parent>, InferRow<Child>] {
  const p: Record<string, unknown> = {};
  for (const [key, col] of columnEntries(parent as any)) {
    p[key] = col.__internal.decode(raw[col.name]);
  }
  const c: Record<string, unknown> = {};
  for (const [key, col] of columnEntries(child as any)) {
    c[key] = col.__internal.decode(raw[`${(child as any)._.name}_${col.name}`]);
  }
  return [p as InferRow<Parent>, c as InferRow<Child>];
}

/** Find the primary key column name of a table. Throws if none found. */
function findPK(tbl: TableDef<any>): string {
  for (const [, col] of columnEntries(tbl as any)) {
    if (col.__internal.isPrimaryKey) return col.name;
  }
  throw new Error("Table has no primary key column — cannot group join results");
}

/** Find the primary key TS key of a table. */
function findPKKey(tbl: TableDef<any>): string {
  for (const [key, col] of columnEntries(tbl as any)) {
    if (col.__internal.isPrimaryKey) return key;
  }
  throw new Error("Table has no primary key column");
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
// SELECT — three-phase: SelectStage1 → SelectBuilder → (ColumnSelectBuilder | SingleSelectBuilder)
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
export class SelectBuilder<T extends TableDef<any>, C extends keyof InferRow<T> = keyof InferRow<T>> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #conditions: Condition[];
  #selectedColumns: C[] | null;

  constructor(
    client: DatabaseClient,
    tableName: string,
    table: T,
    conditions: Condition[] = [],
    selectedColumns: C[] | null = null,
  ) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
  }

  where(condition: Condition): SelectBuilder<T, C> {
    return new SelectBuilder(this.#client, this.#tableName, this.#table, [...this.#conditions, condition], this.#selectedColumns);
  }

  /**
   * Narrow which columns appear in the result.
   * Each string must be a real key on the table.
   */
  columns<K extends keyof InferRow<T>>(keys: K[]): ColumnSelectBuilder<T, K> {
    return new ColumnSelectBuilder(this.#client, this.#tableName, this.#table, this.#conditions, keys as any);
  }

  /**
   * Return a single row or null instead of an array.
   * Adds LIMIT 1 to the SQL.
   */
  single(): SingleSelectBuilder<T, C> {
    return new SingleSelectBuilder(this.#client, this.#tableName, this.#table, this.#conditions, this.#selectedColumns);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const entries = columnEntries(this.#table as any);
    let cols: string;
    if (this.#selectedColumns) {
      cols = this.#selectedColumns
        .map((k) => (this.#table as any)[k as string].name)
        .join(", ");
    } else {
      cols = entries.map(([, c]) => c.name).join(", ");
    }
    const params: unknown[] = [];
    let sql = `SELECT ${cols} FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    return { sql, params };
  }

  execute(): Pick<InferRow<T>, C>[] {
    const { sql, params } = this.toSQL();
    const rows = this.#client.prepare(sql).all(...bind(params)) as Record<string, unknown>[];
    if (this.#selectedColumns) {
      return rows.map((r) => decodeSelectedRow(r, this.#table, this.#selectedColumns!));
    }
    return rows.map((r) => decodeRow(r, this.#table));
  }
}

// -----------------------------------------------------------------------
// Column-selected SELECT builder — after .columns() has been called
// -----------------------------------------------------------------------

export class ColumnSelectBuilder<T extends TableDef<any>, C extends keyof InferRow<T>> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #conditions: Condition[];
  #selectedColumns: C[];

  constructor(
    client: DatabaseClient,
    tableName: string,
    table: T,
    conditions: Condition[],
    selectedColumns: C[],
  ) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
  }

  where(condition: Condition): ColumnSelectBuilder<T, C> {
    return new ColumnSelectBuilder(this.#client, this.#tableName, this.#table, [...this.#conditions, condition], this.#selectedColumns);
  }

  single(): SingleSelectBuilder<T, C> {
    return new SingleSelectBuilder(this.#client, this.#tableName, this.#table, this.#conditions, this.#selectedColumns);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const cols = this.#selectedColumns
      .map((k) => (this.#table as any)[k as string].name)
      .join(", ");
    const params: unknown[] = [];
    let sql = `SELECT ${cols} FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    return { sql, params };
  }

  execute(): Pick<InferRow<T>, C>[] {
    const { sql, params } = this.toSQL();
    const rows = this.#client.prepare(sql).all(...bind(params)) as Record<string, unknown>[];
    return rows.map((r) => decodeSelectedRow(r, this.#table, this.#selectedColumns));
  }
}

// -----------------------------------------------------------------------
// Single-row SELECT builder — after .single() has been called
// -----------------------------------------------------------------------

export class SingleSelectBuilder<T extends TableDef<any>, C extends keyof InferRow<T> = keyof InferRow<T>> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #conditions: Condition[];
  #selectedColumns: C[] | null;

  constructor(
    client: DatabaseClient,
    tableName: string,
    table: T,
    conditions: Condition[],
    selectedColumns: C[] | null = null,
  ) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
  }

  where(condition: Condition): SingleSelectBuilder<T, C> {
    return new SingleSelectBuilder(this.#client, this.#tableName, this.#table, [...this.#conditions, condition], this.#selectedColumns);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const entries = columnEntries(this.#table as any);
    let cols: string;
    if (this.#selectedColumns) {
      cols = this.#selectedColumns
        .map((k) => (this.#table as any)[k as string].name)
        .join(", ");
    } else {
      cols = entries.map(([, c]) => c.name).join(", ");
    }
    const params: unknown[] = [];
    let sql = `SELECT ${cols} FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    sql += " LIMIT 1";
    return { sql, params };
  }

  /** Returns a single row or null — never throws on empty results. */
  execute(): Pick<InferRow<T>, C> | null {
    const { sql, params } = this.toSQL();
    const row = this.#client.prepare(sql).get(...bind(params)) as Record<string, unknown> | null;
    if (!row) return null;
    if (this.#selectedColumns) {
      return decodeSelectedRow(row, this.#table, this.#selectedColumns);
    }
    return decodeRow(row, this.#table) as Pick<InferRow<T>, C>;
  }
}

// -----------------------------------------------------------------------
// JOIN — two-phase: JoinSelectStage1 → JoinOnBuilder → JoinSelectBuilder
// -----------------------------------------------------------------------

/** Phase 1: only .on() is available after .leftJoin()/.innerJoin(). */
export interface JoinSelectStage1<Parent extends TableDef<any>> {
  on<Child extends TableDef<any>>(child: Child): JoinOnBuilder<Parent, Child>;
}

/** Phase 2: .on() has been called, returning the full JoinSelectBuilder. */
export interface JoinOnBuilder<Parent extends TableDef<any>, Child extends TableDef<any>> {
  on(condition: Condition): JoinSelectBuilder<Parent, Child>;
}

/** Implementation of JoinSelectStage1 — only .on() is available. */
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

  on<Child extends TableDef<any>>(child: Child): JoinOnBuilder<Parent, Child> {
    const childName = (child as any)._.name as string;
    return new JoinOnBuilderImpl(this.#client, this.#parent, this.#parentName, child, childName, this.#joinType);
  }
}

/** Implementation of JoinOnBuilder — .on() returns JoinSelectBuilder. */
class JoinOnBuilderImpl<Parent extends TableDef<any>, Child extends TableDef<any>> implements JoinOnBuilder<Parent, Child> {
  #client: DatabaseClient;
  #parent: Parent;
  #parentName: string;
  #child: Child;
  #childName: string;
  #joinType: JoinType;

  constructor(
    client: DatabaseClient,
    parent: Parent,
    parentName: string,
    child: Child,
    childName: string,
    joinType: JoinType,
  ) {
    this.#client = client;
    this.#parent = parent;
    this.#parentName = parentName;
    this.#child = child;
    this.#childName = childName;
    this.#joinType = joinType;
  }

  on(condition: Condition): JoinSelectBuilder<Parent, Child> {
    return new JoinSelectBuilder(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#child,
      this.#childName,
      this.#joinType,
      condition,
    );
  }
}

/**
 * Full JOIN builder — available after .leftJoin()/.innerJoin() and .on().
 *
 * One-to-many joins produce nested results: the parent row appears once
 * with a key containing an array of all matching child rows.
 *
 * .columns() narrows top-level fields while the joined data arrives fully.
 * .single() returns one parent (with nested children) or null.
 */
export class JoinSelectBuilder<
  Parent extends TableDef<any>,
  Child extends TableDef<any>,
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> implements Executable {
  #client: DatabaseClient;
  #parent: Parent;
  #parentName: string;
  #child: Child;
  #childName: string;
  #joinType: JoinType;
  #joinCondition: Condition;
  #conditions: Condition[];
  #selectedColumns: ParentCols[] | null;

  /** The key under which child rows are nested in the result. */
  static readonly CHILD_KEY = "__children";

  constructor(
    client: DatabaseClient,
    parent: Parent,
    parentName: string,
    child: Child,
    childName: string,
    joinType: JoinType,
    joinCondition: Condition,
    conditions: Condition[] = [],
    selectedColumns: ParentCols[] | null = null,
  ) {
    this.#client = client;
    this.#parent = parent;
    this.#parentName = parentName;
    this.#child = child;
    this.#childName = childName;
    this.#joinType = joinType;
    this.#joinCondition = joinCondition;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
  }

  where(condition: Condition): JoinSelectBuilder<Parent, Child, ParentCols> {
    return new JoinSelectBuilder(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#child,
      this.#childName,
      this.#joinType,
      this.#joinCondition,
      [...this.#conditions, condition],
      this.#selectedColumns,
    );
  }

  /**
   * Narrow which parent columns appear in the result.
   * The child table's data always arrives fully as a nested array.
   */
  columns<K extends keyof InferRow<Parent>>(keys: K[]): JoinSelectBuilder<Parent, Child, K> {
    return new JoinSelectBuilder(
      this.#client, this.#parent, this.#parentName,
      this.#child, this.#childName, this.#joinType,
      this.#joinCondition, this.#conditions, keys as any,
    );
  }

  /** Return a single parent (with nested children) or null. */
  single(): SingleJoinSelectBuilder<Parent, Child, ParentCols> {
    return new SingleJoinSelectBuilder(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#child,
      this.#childName,
      this.#joinType,
      this.#joinCondition,
      this.#conditions,
      this.#selectedColumns,
    );
  }

  toSQL(): { sql: string; params: unknown[] } {
    const parentEntries = columnEntries(this.#parent as any);
    let parentCols: string;
    if (this.#selectedColumns) {
      parentCols = this.#selectedColumns
        .map((k) => `${this.#parentName}.${(this.#parent as any)[k as string].name}`)
        .join(", ");
    } else {
      parentCols = parentEntries.map(([, c]) => `${this.#parentName}.${c.name}`).join(", ");
    }

    const childEntries = columnEntries(this.#child as any);
    const childCols = childEntries
      .map(([, c]) => `${this.#childName}.${c.name} AS ${this.#childName}_${c.name}`)
      .join(", ");

    const joinKeyword = this.#joinType === "left" ? "LEFT JOIN" : "INNER JOIN";
    const params: unknown[] = [];
    const where = compileConditions(this.#conditions, params);

    let sql = `SELECT ${parentCols}${childCols ? ", " + childCols : ""} FROM ${this.#parentName} ${joinKeyword} ${this.#childName} ON ?`;
    // The join condition's params need to come first.
    // Actually, we need to compile the join condition separately.
    const joinParams: unknown[] = [];
    const joinOn = compileConditions([this.#joinCondition], joinParams);
    sql = `SELECT ${parentCols}${childCols ? ", " + childCols : ""} FROM ${this.#parentName} ${joinKeyword} ${this.#childName} ON ${joinOn}`;

    if (where !== "1=1") sql += ` WHERE ${where}`;

    // Prepend join params before where params
    return { sql, params: [...joinParams, ...params] };
  }

  execute(): JoinResult<Parent, Child, ParentCols>[] {
    const { sql, params } = this.toSQL();
    const rows = this.#client.prepare(sql).all(...bind(params)) as Record<string, unknown>[];

    // Group flat rows by parent PK
    const parentEntries = columnEntries(this.#parent as any);
    const childEntries = columnEntries(this.#child as any);
    const pkKey = findPKKey(this.#parent);
    const pkColName = (this.#parent as any)[pkKey].name;
    const grouped = new Map<unknown, { parent: Record<string, unknown>; children: Record<string, unknown>[] }>();

    for (const row of rows) {
      const pk = row[pkColName];
      if (!grouped.has(pk)) {
        // Extract parent columns from the row
        const parentRow: Record<string, unknown> = {};
        for (const [key, col] of parentEntries) {
          parentRow[key] = row[col.name];
        }
        grouped.set(pk, { parent: parentRow, children: [] });
      }
      // Extract child columns (prefixed with childTableName_)
      const childRow: Record<string, unknown> = {};
      let hasNonNullChild = false;
      for (const [key, col] of childEntries) {
        const val = row[`${this.#childName}_${col.name}`];
        childRow[key] = val;
        if (val != null) hasNonNullChild = true;
      }
      // For LEFT JOIN: only add child if at least one child column is non-null
      if (this.#joinType === "left" && !hasNonNullChild) continue;
      grouped.get(pk)!.children.push(childRow);
    }

    // Build nested result
    const result: JoinResult<Parent, Child, ParentCols>[] = [];
    for (const { parent, children } of grouped.values()) {
      const decodedParent = this.#selectedColumns
        ? decodeSelectedRow(parent, this.#parent, this.#selectedColumns)
        : decodeRow(parent, this.#parent);
      const decodedChildren = children.map((c) => decodeRow(c, this.#child));
      result.push({
        ...decodedParent,
        [JoinSelectBuilder.CHILD_KEY]: decodedChildren,
      } as JoinResult<Parent, Child, ParentCols>);
    }

    return result;
  }
}

/**
 * Result type for a one-to-many join.
 * Parent fields are Pick'd if .columns() was used.
 * Child data is always fully present as an array.
 */
export type JoinResult<
  Parent extends TableDef<any>,
  Child extends TableDef<any>,
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> = Pick<InferRow<Parent>, ParentCols> & { [JoinSelectBuilder.CHILD_KEY]: InferRow<Child>[] };

// -----------------------------------------------------------------------
// Single-row JOIN builder — after .single() on a JoinSelectBuilder
// -----------------------------------------------------------------------

export class SingleJoinSelectBuilder<
  Parent extends TableDef<any>,
  Child extends TableDef<any>,
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> implements Executable {
  #client: DatabaseClient;
  #parent: Parent;
  #parentName: string;
  #child: Child;
  #childName: string;
  #joinType: JoinType;
  #joinCondition: Condition;
  #conditions: Condition[];
  #selectedColumns: ParentCols[] | null;

  constructor(
    client: DatabaseClient,
    parent: Parent,
    parentName: string,
    child: Child,
    childName: string,
    joinType: JoinType,
    joinCondition: Condition,
    conditions: Condition[],
    selectedColumns: ParentCols[] | null = null,
  ) {
    this.#client = client;
    this.#parent = parent;
    this.#parentName = parentName;
    this.#child = child;
    this.#childName = childName;
    this.#joinType = joinType;
    this.#joinCondition = joinCondition;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
  }

  where(condition: Condition): SingleJoinSelectBuilder<Parent, Child, ParentCols> {
    return new SingleJoinSelectBuilder(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#child,
      this.#childName,
      this.#joinType,
      this.#joinCondition,
      [...this.#conditions, condition],
      this.#selectedColumns,
    );
  }

  toSQL(): { sql: string; params: unknown[] } {
    // Same as JoinSelectBuilder.toSQL() but with LIMIT 1
    const parentEntries = columnEntries(this.#parent as any);
    let parentCols: string;
    if (this.#selectedColumns) {
      parentCols = this.#selectedColumns
        .map((k) => `${this.#parentName}.${(this.#parent as any)[k as string].name}`)
        .join(", ");
    } else {
      parentCols = parentEntries.map(([, c]) => `${this.#parentName}.${c.name}`).join(", ");
    }

    const childEntries = columnEntries(this.#child as any);
    const childCols = childEntries
      .map(([, c]) => `${this.#childName}.${c.name} AS ${this.#childName}_${c.name}`)
      .join(", ");

    const joinKeyword = this.#joinType === "left" ? "LEFT JOIN" : "INNER JOIN";
    const joinParams: unknown[] = [];
    const joinOn = compileConditions([this.#joinCondition], joinParams);
    const whereParams: unknown[] = [];
    const where = compileConditions(this.#conditions, whereParams);

    let sql = `SELECT ${parentCols}${childCols ? ", " + childCols : ""} FROM ${this.#parentName} ${joinKeyword} ${this.#childName} ON ${joinOn}`;
    if (where !== "1=1") sql += ` WHERE ${where}`;
    sql += " LIMIT 1";

    return { sql, params: [...joinParams, ...whereParams] };
  }

  /** Returns a single parent with nested children, or null. */
  execute(): JoinResult<Parent, Child, ParentCols> | null {
    const { sql, params } = this.toSQL();
    const row = this.#client.prepare(sql).get(...bind(params)) as Record<string, unknown> | null;
    if (!row) return null;

    // For single(), the LIMIT 1 means we get at most one parent.
    // But there could still be multiple rows if the join produces them
    // (e.g. one parent with 3 children = 3 rows, but LIMIT 1 cuts to 1).
    // This is actually wrong for one-to-many — LIMIT 1 would cut children.
    // The correct approach: use a subquery or fetch all then take first parent.
    // For now, we fetch without LIMIT and take the first group.

    // Actually, let me re-approach: for single() on a join, we should NOT
    // use LIMIT 1 on the JOIN query (it would cut children). Instead,
    // we add a WHERE on the parent PK and fetch all matching rows, then group.
    // But we don't know the PK value at this point...

    // Simplest correct approach: don't add LIMIT 1 to the JOIN SQL.
    // Instead, execute the full join, group, and take the first result.
    // This is what the full execute() does — we just slice after.
    const fullSql = this.toSQL().sql.replace(/ LIMIT 1$/, "");
    const allRows = this.#client.prepare(fullSql).all(...bind(params)) as Record<string, unknown>[];
    if (allRows.length === 0) return null;

    // Group by parent PK (same logic as JoinSelectBuilder.execute)
    const parentEntries = columnEntries(this.#parent as any);
    const childEntries = columnEntries(this.#child as any);
    const pkKey = findPKKey(this.#parent);
    const pkColName = (this.#parent as any)[pkKey].name;
    const grouped = new Map<unknown, { parent: Record<string, unknown>; children: Record<string, unknown>[] }>();

    for (const r of allRows) {
      const pk = r[pkColName];
      if (!grouped.has(pk)) {
        const parentRow: Record<string, unknown> = {};
        for (const [key, col] of parentEntries) {
          parentRow[key] = r[col.name];
        }
        grouped.set(pk, { parent: parentRow, children: [] });
      }
      const childRow: Record<string, unknown> = {};
      let hasNonNullChild = false;
      for (const [key, col] of childEntries) {
        const val = r[`${this.#childName}_${col.name}`];
        childRow[key] = val;
        if (val != null) hasNonNullChild = true;
      }
      if (this.#joinType === "left" && !hasNonNullChild) continue;
      grouped.get(pk)!.children.push(childRow);
    }

    // Take the first group
    const first = grouped.values().next().value;
    if (!first) return null;

    const decodedParent = this.#selectedColumns
      ? decodeSelectedRow(first.parent, this.#parent, this.#selectedColumns)
      : decodeRow(first.parent, this.#parent);
    const decodedChildren = first.children.map((c) => decodeRow(c, this.#child));

    return {
      ...decodedParent,
      [JoinSelectBuilder.CHILD_KEY]: decodedChildren,
    } as JoinResult<Parent, Child, ParentCols>;
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
