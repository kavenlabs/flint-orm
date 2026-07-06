// Query builders
import type { SQLQueryBindings } from "bun:sqlite";
import type { ColumnDef } from "../schema/columns";
import type { Condition } from "./conditions";
import { compileConditions, eq } from "./conditions";
import type { TableDef, AnyTable, InferRow, InsertRow } from "../schema/table";
import { FlintValidationError, FlintQueryError } from "../errors";

// @internal Shared helpers
/** @internal Cast params array to what bun:sqlite expects. */
function bind(params: unknown[]): SQLQueryBindings[] {
  return params as SQLQueryBindings[];
}

/** @internal Get a column by key from a table definition. */
function getCol(tbl: AnyTable, key: string): ColumnDef<any, any> {
  const col = (tbl as Record<string, ColumnDef<any, any>>)[key];
  if (!col) throw new FlintValidationError(`Column "${key}" not found in table`);
  return col;
}

/** @internal Get column entries from a table (filters out `._`). */
function columnEntries(tbl: AnyTable): [string, ColumnDef<any, any>][] {
  return Object.entries(tbl).filter(([k]) => k !== "_") as [string, ColumnDef<any, any>][];
}

/** @internal Decode a raw SQLite row into the full logical TS shape. */
function decodeRow<T extends AnyTable>(raw: Record<string, unknown>, tbl: T): InferRow<T> {
  const out: Record<string, unknown> = {};
  for (const [key, col] of columnEntries(tbl)) {
    out[key] = col.__internal.decode(raw[col.name]);
  }
  // SAFETY: built from the table's own column entries — keys and decode functions match InferRow<T>
  return out as InferRow<T>;
}

/** @internal Decode a raw row for only the specified columns. */
function decodeSelectedRow<T extends AnyTable, C extends keyof InferRow<T>>(
  raw: Record<string, unknown>,
  tbl: T,
  keys: C[],
): Pick<InferRow<T>, C> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const col = getCol(tbl, key as string);
    out[key as string] = col.__internal.decode(raw[col.name]);
  }
  // SAFETY: built from the table's own columns, filtered to the requested keys
  return out as Pick<InferRow<T>, C>;
}

/** @internal Find the primary key TS key of a table. */
function findPKKey(tbl: AnyTable): string {
  for (const [key, col] of columnEntries(tbl)) {
    if (col.__internal.isPrimaryKey) return key;
  }
  throw new FlintValidationError("Table has no primary key column");
}

/** @internal Resolve a join condition from foreign key references. */
function resolveForeignKeyCondition(
  parent: AnyTable,
  parentName: string,
  child: AnyTable,
  childName: string,
): Condition {
  for (const [, col] of columnEntries(child)) {
    if (
      col.__internal.referencesTable === parentName &&
      col.__internal.referencesColumn
    ) {
      // Find the parent column that matches the referenced column name
      const parentCol = getCol(parent, col.__internal.referencesColumn);
      if (parentCol) {
        return eq(parentCol, col);
      }
    }
  }
  throw new FlintValidationError(
    `No foreign key reference found from "${childName}" to "${parentName}". Use .references() on the child table or provide an explicit condition.`
  );
}

/** @internal Extract all column references from a condition tree. */
function extractColumns(cond: Condition): ColumnDef<any, any>[] {
  switch (cond.type) {
    case "eq":
      return [cond.column];
    case "eqColumn":
      return [cond.left, cond.right];
    case "in":
    case "notIn":
    case "isNull":
    case "isNotNull":
    case "like":
    case "glob":
    case "between":
      return [cond.column];
    case "and":
    case "or":
      return cond.conditions.flatMap(extractColumns);
    default:
      return [];
  }
}

/** @internal Validate that all columns in conditions belong to the allowed tables. */
function validateColumnOwnership(
  conditions: Condition[],
  allowedTables: AnyTable[],
  context: string,
): void {
  const allowedColumns = new Set(
    allowedTables.flatMap((t) => columnEntries(t).map(([, c]) => c)),
  );
  for (const cond of conditions) {
    const cols = extractColumns(cond);
    for (const col of cols) {
      if (!allowedColumns.has(col)) {
        throw new FlintValidationError(
          `Column "${col.name}" does not belong to ${context}. ` +
          `Check that you're using a column from the queried table, not a different table.`
        );
      }
    }
  }
}

/** @internal Resolve column list SQL from selected columns or all entries. */
function resolveColumns<T extends AnyTable>(
  table: T,
  selectedColumns: string[] | null,
  prefix?: string,
): string {
  if (selectedColumns) {
    return selectedColumns
      .map((k) => {
        const name = getCol(table, k).name;
        return prefix ? `${prefix}.${name}` : name;
      })
      .join(", ");
  }
  const entries = columnEntries(table);
  return entries.map(([, c]) => (prefix ? `${prefix}.${c.name}` : c.name)).join(", ");
}

/** Anything that can produce SQL — used by `db.batch()`. */
export interface Executable {
  toSQL(): { sql: string; params: unknown[] };
}

/** @internal Anything that can run SQL. */
export interface DatabaseClient {
  prepare(sql: string): {
    all(...params: SQLQueryBindings[]): unknown[];
    get(...params: SQLQueryBindings[]): unknown;
    run(...params: SQLQueryBindings[]): void;
  };
}

/** @internal */
type JoinType = "left" | "inner";

// SELECT builders
/** Phase 1 of a SELECT — only `.from()` is available. */
export interface SelectStage1 {
  from<U extends AnyTable>(table: U): SelectBuilder<U>;
}

/** @internal Lightweight wrapper that only exposes `.from()`. */
export class SelectFromBuilder implements SelectStage1 {
  #client: DatabaseClient;
  #conditions: Condition[];

  constructor(client: DatabaseClient, conditions: Condition[] = []) {
    this.#client = client;
    this.#conditions = conditions;
  }

  from<U extends AnyTable>(table: U): SelectBuilder<U> {
    return new SelectBuilder(this.#client, table._.name, table, this.#conditions);
  }
}

/** Full SELECT builder — available after `.from()`. */
export class SelectBuilder<
  T extends AnyTable,
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
  #distinct: boolean;

  constructor(
    client: DatabaseClient,
    tableName: string,
    table: T,
    conditions: Condition[] = [],
    selectedColumns: C[] | null = null,
    orderByClauses: { column: ColumnDef<any, any>; direction: "asc" | "desc" }[] = [],
    limitValue: number | null = null,
    offsetValue: number | null = null,
    distinct: boolean = false,
  ) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
    this.#orderByClauses = orderByClauses;
    this.#limitValue = limitValue;
    this.#offsetValue = offsetValue;
    this.#distinct = distinct;
  }

  /** Add a WHERE condition. Multiple calls stack. */
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
      this.#distinct,
    );
  }

  /**
   * Narrow which columns appear in the result.
   *
   * @example
   * db.select().from(users).columns(["id", "name"])
   */
  columns<K extends keyof InferRow<T>>(keys: K[]): SelectBuilder<T, K> {
    return new SelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      this.#conditions,
      keys as K[],
      this.#orderByClauses,
      this.#limitValue,
      this.#offsetValue,
      this.#distinct,
    );
  }

  /** Return a single row or null instead of an array. Adds `LIMIT 1` to the SQL. */
  single(): SingleSelectBuilder<T, C> {
    return new SingleSelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      this.#orderByClauses,
      this.#offsetValue,
      this.#distinct,
    );
  }

  /** Return only distinct (unique) rows. */
  distinct(): SelectBuilder<T, C> {
    return new SelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      this.#orderByClauses,
      this.#limitValue,
      this.#offsetValue,
      true,
    );
  }

  /**
   * Add an ORDER BY clause. Multiple calls stack.
   *
   * @example
   * db.select().from(users).orderBy("name", "desc")
   */
  orderBy<K extends keyof InferRow<T>>(
    key: K,
    direction: "asc" | "desc" = "asc",
  ): SelectBuilder<T, C> {
    const column = getCol(this.#table, key as string);
    return new SelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      [...this.#orderByClauses, { column, direction }],
      this.#limitValue,
      this.#offsetValue,
      this.#distinct,
    );
  }

  /** Limit the number of results. */
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
      this.#distinct,
    );
  }

  /** Skip N rows before returning results. */
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
      this.#distinct,
    );
  }

  toSQL(): { sql: string; params: unknown[] } {
    validateColumnOwnership(this.#conditions, [this.#table], `SELECT from "${this.#tableName}"`);
    const cols = resolveColumns(this.#table, this.#selectedColumns as unknown as string[] | null);
    const params: unknown[] = [];
    const distinct = this.#distinct ? "DISTINCT " : "";
    let sql = `SELECT ${distinct}${cols} FROM ${this.#tableName}`;
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
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

/** @internal Single-row SELECT builder — after `.single()` has been called. */
export class SingleSelectBuilder<
  T extends AnyTable,
  C extends keyof InferRow<T> = keyof InferRow<T>,
> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #conditions: Condition[];
  #selectedColumns: C[] | null;
  #orderByClauses: { column: ColumnDef<any, any>; direction: "asc" | "desc" }[];
  #offsetValue: number | null;
  #distinct: boolean;

  constructor(
    client: DatabaseClient,
    tableName: string,
    table: T,
    conditions: Condition[],
    selectedColumns: C[] | null = null,
    orderByClauses: { column: ColumnDef<any, any>; direction: "asc" | "desc" }[] = [],
    offsetValue: number | null = null,
    distinct: boolean = false,
  ) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
    this.#orderByClauses = orderByClauses;
    this.#offsetValue = offsetValue;
    this.#distinct = distinct;
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
      this.#distinct,
    );
  }

  orderBy<K extends keyof InferRow<T>>(
    key: K,
    direction: "asc" | "desc" = "asc",
  ): SingleSelectBuilder<T, C> {
    const column = getCol(this.#table, key as string);
    return new SingleSelectBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      [...this.#orderByClauses, { column, direction }],
      this.#offsetValue,
      this.#distinct,
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
      this.#distinct,
    );
  }

  toSQL(): { sql: string; params: unknown[] } {
    validateColumnOwnership(this.#conditions, [this.#table], `SELECT from "${this.#tableName}"`);
    const cols = resolveColumns(this.#table, this.#selectedColumns as unknown as string[] | null);
    const params: unknown[] = [];
    const distinct = this.#distinct ? "DISTINCT " : "";
    let sql = `SELECT ${distinct}${cols} FROM ${this.#tableName}`;
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

  /** Returns a single row or null, never throws on empty results. */
  execute(): Pick<InferRow<T>, C> | null {
    const { sql, params } = this.toSQL();
    try {
      const row = this.#client.prepare(sql).get(...bind(params)) as Record<string, unknown> | null;
      if (!row) return null;
      if (this.#selectedColumns) {
        return decodeSelectedRow(row, this.#table, this.#selectedColumns);
      }
      // SAFETY: decodeRow builds from the table's own column entries
      return decodeRow(row, this.#table) as Pick<InferRow<T>, C>;
    } catch (e) {
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

// JOIN builders
/** @internal Description of a single JOIN clause. */
interface JoinClause {
  table: AnyTable;
  name: string;
  condition: Condition;
}

/** Phase 1 of a JOIN — only `.on()` is available. */
export interface JoinSelectStage1<Parent extends AnyTable> {
  on<Child extends AnyTable>(child: Child, condition: Condition): JoinBuilder<Parent, [Child]>;
  /** Auto-join: infer condition from foreign key references. */
  on<Child extends AnyTable>(child: Child): JoinBuilder<Parent, [Child]>;
}

/** Full join builder — chain more `.on()` calls or call `.execute()`. */
export interface JoinBuilder<
  Parent extends AnyTable,
  Joined extends AnyTable[],
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> {
  on<NewChild extends AnyTable>(
    child: NewChild,
    condition: Condition,
  ): JoinBuilder<Parent, [...Joined, NewChild], ParentCols>;
  /** Auto-join: infer condition from foreign key references. */
  on<NewChild extends AnyTable>(
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

/** @internal Single-row join builder — after `.single()` on a JoinBuilder. */
export interface SingleJoinBuilder<
  Parent extends AnyTable,
  Joined extends AnyTable[],
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

/** @internal Implementation of JoinSelectStage1. */
export class JoinStage1<Parent extends AnyTable> implements JoinSelectStage1<Parent> {
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
   * Add a join. Provide an explicit condition or auto-infer from foreign keys.
   *
   * @example
   * db.leftJoin(users).on(posts, eq(posts.userId, users.id))
   */
  on<Child extends AnyTable>(
    child: Child,
    condition?: Condition,
  ): JoinBuilder<Parent, [Child]> {
    const childName = child._.name;
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

/** @internal Full JOIN builder — chains `.on()` calls, executes with nested results. */
export class JoinBuilderImpl<
  Parent extends AnyTable,
  Joined extends AnyTable[],
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
   * Add another join. Provide an explicit condition or auto-infer from foreign keys.
   */
  on<NewChild extends AnyTable>(
    child: NewChild,
    condition?: Condition,
  ): JoinBuilder<Parent, [...Joined, NewChild], ParentCols> {
    const childName = child._.name;
    const resolvedCondition = condition ?? resolveForeignKeyCondition(this.#parent, this.#parentName, child, childName);
    // SAFETY: constructor args match the interface — TypeScript can't infer the spread tuple type
    return new JoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      [...this.#joins, { table: child, name: childName, condition: resolvedCondition }],
      this.#joinType,
      this.#conditions,
      this.#selectedColumns,
    ) as JoinBuilder<Parent, [...Joined, NewChild], ParentCols>;
  }

  where(condition: Condition): JoinBuilder<Parent, Joined, ParentCols> {
    // SAFETY: constructor args match the interface
    return new JoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#joins,
      this.#joinType,
      [...this.#conditions, condition],
      this.#selectedColumns,
    ) as JoinBuilder<Parent, Joined, ParentCols>;
  }

  columns<K extends keyof InferRow<Parent>>(keys: K[]): JoinBuilder<Parent, Joined, K> {
    // SAFETY: constructor args match the interface — K extends keyof InferRow<Parent> so keys are valid
    return new JoinBuilderImpl(
      this.#client,
      this.#parent,
      this.#parentName,
      this.#joins,
      this.#joinType,
      this.#conditions,
      keys as unknown as ParentCols[],
      this.#orderByClauses,
      this.#limitValue,
      this.#offsetValue,
    ) as JoinBuilder<Parent, Joined, K>;
  }

  orderBy<K extends keyof InferRow<Parent>>(
    key: K,
    direction: "asc" | "desc" = "asc",
  ): JoinBuilder<Parent, Joined, ParentCols> {
    const column = getCol(this.#parent, key as string);
    // SAFETY: constructor args match the interface
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
    ) as JoinBuilder<Parent, Joined, ParentCols>;
  }

  limit(n: number): JoinBuilder<Parent, Joined, ParentCols> {
    // SAFETY: constructor args match the interface
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
    ) as JoinBuilder<Parent, Joined, ParentCols>;
  }

  offset(n: number): JoinBuilder<Parent, Joined, ParentCols> {
    // SAFETY: constructor args match the interface
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
    ) as JoinBuilder<Parent, Joined, ParentCols>;
  }

  single(): SingleJoinBuilder<Parent, Joined, ParentCols> {
    // SAFETY: constructor args match the interface
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
    ) as SingleJoinBuilder<Parent, Joined, ParentCols>;
  }

  toSQL(): { sql: string; params: unknown[] } {
    const allowedTables = [this.#parent, ...this.#joins.map(j => j.table)];
    validateColumnOwnership(this.#conditions, allowedTables, `SELECT from "${this.#parentName}"`);
    const parentCols = resolveColumns(
      this.#parent,
      this.#selectedColumns as unknown as string[] | null,
      this.#parentName,
    );

    const childCols: string[] = [];
    for (const join of this.#joins) {
      const entries = columnEntries(join.table);
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
      const parentEntries = columnEntries(this.#parent);
      const pkKey = findPKKey(this.#parent);
      const pkColName = getCol(this.#parent, pkKey).name;

      // Build child entry maps for each join
      const childEntryMaps: {
        name: string;
        entries: [string, ColumnDef<any, any>][];
        table: AnyTable;
      }[] = [];
      for (const j of this.#joins) {
        childEntryMaps.push({
          name: j.name,
          entries: columnEntries(j.table),
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
      if (e instanceof FlintQueryError) throw e;
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

/** The result type for joined queries. Parent fields are narrowed by `.columns()`; each joined table's data is nested under its table name. */
export type JoinResult<
  Parent extends AnyTable,
  Joined extends AnyTable[],
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> = Pick<InferRow<Parent>, ParentCols> & Record<string, unknown>;

/** @internal Single-row join builder implementation. */
export class SingleJoinBuilderImpl<
  Parent extends AnyTable,
  Joined extends AnyTable[],
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
    const column = getCol(this.#parent, key as string);
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
    const allowedTables = [this.#parent, ...this.#joins.map(j => j.table)];
    validateColumnOwnership(this.#conditions, allowedTables, `SELECT from "${this.#parentName}"`);
    const parentCols = resolveColumns(
      this.#parent,
      this.#selectedColumns as unknown as string[] | null,
      this.#parentName,
    );

    const childCols: string[] = [];
    for (const join of this.#joins) {
      const entries = columnEntries(join.table);
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

  /** @internal Returns a single parent with nested children, or null. */
  execute(): JoinResult<Parent, Joined, ParentCols> | null {
    const { sql, params } = this.toSQL();
    try {
      const allRows = this.#client.prepare(sql).all(...bind(params)) as Record<string, unknown>[];
      if (allRows.length === 0) return null;

      // Group by parent PK (same logic as JoinBuilderImpl.execute)
      const parentEntries = columnEntries(this.#parent);
      const pkKey = findPKKey(this.#parent);
      const pkColName = getCol(this.#parent, pkKey).name;

      const childEntryMaps: {
        name: string;
        entries: [string, ColumnDef<any, any>][];
        table: AnyTable;
      }[] = [];
      for (const j of this.#joins) {
        childEntryMaps.push({
          name: j.name,
          entries: columnEntries(j.table),
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
      if (e instanceof FlintQueryError) throw e;
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

/** Phase 1 of an INSERT — only `.values()` is available. */
export interface InsertStage1<T extends AnyTable> {
  values(row: InsertRow<T>): InsertBuilder<T>;
}

/** @internal Lightweight wrapper that only exposes `.values()`. */
export class InsertValuesBuilder<T extends AnyTable> implements InsertStage1<T> {
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

/** @internal ON CONFLICT strategy type. */
type OnConflictDoNothing = { mode: "nothing" };
type OnConflictDoUpdate<T extends AnyTable> = {
  mode: "update";
  target: ColumnDef<any, any> | ColumnDef<any, any>[];
  set: Partial<InferRow<T>>;
};
type OnConflictStrategy<T extends AnyTable> = OnConflictDoNothing | OnConflictDoUpdate<T>;

/** Full INSERT builder — available after `.values()` has been called. */
export class InsertBuilder<T extends AnyTable, R extends boolean = false> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #row: InsertRow<T>;
  #returning: boolean;
  #onConflict?: OnConflictStrategy<T>;

  constructor(client: DatabaseClient, tableName: string, table: T, row: InsertRow<T>, returning: R = false as R, onConflict?: OnConflictStrategy<T>) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#row = row;
    this.#returning = returning;
    this.#onConflict = onConflict;
  }

  /**
   * Return the inserted row(s) instead of void.
   *
   * @example
   * db.insert(users).values({ id: "u1", name: "Alice" }).returning()
   */
  returning(): InsertBuilder<T, true> {
    return new InsertBuilder(this.#client, this.#tableName, this.#table, this.#row, true, this.#onConflict);
  }

  /**
   * On conflict, do nothing (ignore the insert).
   *
   * @example
   * db.insert(users).values(row).onConflictDoNothing()
   */
  onConflictDoNothing(): InsertBuilder<T, R> {
    return new InsertBuilder(this.#client, this.#tableName, this.#table, this.#row, this.#returning as R, { mode: "nothing" });
  }

  /**
   * On conflict, update specified columns with the proposed values.
   *
   * @example
   * db.insert(users).values(row).onConflictDoUpdate({
   *   target: users.id,
   *   set: { name: "Alice" },
   * })
   */
  onConflictDoUpdate<C extends ColumnDef<any, any>>(
    options: { target: C | C[]; set: Partial<InferRow<T>> },
  ): InsertBuilder<T, R> {
    return new InsertBuilder(this.#client, this.#tableName, this.#table, this.#row, this.#returning as R, {
      mode: "update",
      target: options.target,
      set: options.set,
    });
  }

  toSQL(): { sql: string; params: unknown[] } {
    const entries = columnEntries(this.#table);

    // Filter out columns with defaults when value is undefined
    const inserts: [string, ColumnDef<any, any>][] = [];
    for (const [key, c] of entries) {
      const value = (this.#row as Record<string, unknown>)[key];
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
      const value = (this.#row as Record<string, unknown>)[key];
      if (value === undefined && c.__internal.hasDefaultNow) {
        return c.__internal.encode(new Date());
      }
      return c.__internal.encode(value);
    });
    let sql = `INSERT INTO ${this.#tableName} (${names}) VALUES (${placeholders})`;

    // ON CONFLICT clause
    if (this.#onConflict) {
      if (this.#onConflict.mode === "nothing") {
        sql += " ON CONFLICT DO NOTHING";
      } else {
        // Build target column(s)
        const target = this.#onConflict.target;
        const targetCols = Array.isArray(target) ? target : [target];
        const targetNames = targetCols.map((c) => c.name).join(", ");

        // Build SET clause using excluded.* for proposed values
        const setEntries = Object.entries(this.#onConflict.set);
        const setClauses = setEntries.map(([key, value]) => {
          const col = getCol(this.#table, key);
          if (value === undefined) return null;
          // Use excluded.column for the proposed value
          return `${col.name} = excluded.${col.name}`;
        }).filter(Boolean);

        if (setClauses.length > 0) {
          sql += ` ON CONFLICT (${targetNames}) DO UPDATE SET ${setClauses.join(", ")}`;
        }
      }
    }

    if (this.#returning) sql += " RETURNING *";
    return { sql, params };
  }

  execute(): R extends true ? InferRow<T>[] : void {
    const { sql, params } = this.toSQL();
    try {
      if (this.#returning) {
        const rows = this.#client.prepare(sql).all(...bind(params)) as Record<string, unknown>[];
        // SAFETY: decodeRow builds from the table's own column entries
        return rows.map((r) => decodeRow(r, this.#table)) as R extends true ? InferRow<T>[] : never;
      }
      this.#client.prepare(sql).run(...bind(params));
      // SAFETY: R is false here — TS can't narrow conditional return types at runtime
      return undefined as R extends true ? never : void;
    } catch (e) {
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

/** Phase 1 of an UPDATE — only `.set()` is available. */
export interface UpdateStage1<T extends AnyTable> {
  set(partial: Partial<InferRow<T>>): UpdateBuilder<T>;
}

/** @internal Lightweight wrapper that only exposes `.set()`. */
export class UpdateSetBuilder<T extends AnyTable> implements UpdateStage1<T> {
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

/** Full UPDATE builder — available after `.set()` has been called. */
export class UpdateBuilder<T extends AnyTable, R extends boolean = false> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #set: Partial<InferRow<T>>;
  #conditions: Condition[];
  #returning: boolean;

  constructor(
    client: DatabaseClient,
    tableName: string,
    table: T,
    set: Partial<InferRow<T>>,
    conditions: Condition[] = [],
    returning: R = false as R,
  ) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#set = set;
    this.#conditions = conditions;
    this.#returning = returning;
  }

  set(partial: Partial<InferRow<T>>): UpdateBuilder<T, R> {
    return new UpdateBuilder(
      this.#client,
      this.#tableName,
      this.#table,
      { ...this.#set, ...partial },
      this.#conditions,
      this.#returning,
    );
  }

  where(condition: Condition): UpdateBuilder<T, R> {
    return new UpdateBuilder(this.#client, this.#tableName, this.#table, this.#set, [
      ...this.#conditions,
      condition,
    ], this.#returning);
  }

  /**
   * Return the updated row(s) instead of void.
   *
   * @example
   * db.update(users).set({ name: "Bob" }).where(eq(users.id, "u1")).returning()
   */
  returning(): UpdateBuilder<T, true> {
    return new UpdateBuilder(this.#client, this.#tableName, this.#table, this.#set, this.#conditions, true);
  }

  toSQL(): { sql: string; params: unknown[] } {
    validateColumnOwnership(this.#conditions, [this.#table], `UPDATE "${this.#tableName}"`);
    const params: unknown[] = [];
    const setClauses: string[] = [];
    for (const key of Object.keys(this.#set)) {
      const col = getCol(this.#table, key);
      // onUpdate always wins — ignore user value
      if (col.__internal.hasOnUpdate) {
        setClauses.push(`${col.name} = ?`);
        params.push(col.__internal.encode(new Date()));
        continue;
      }
      setClauses.push(`${col.name} = ?`);
      params.push(col.__internal.encode((this.#set as Record<string, unknown>)[key]));
    }
    let sql = `UPDATE ${this.#tableName} SET ${setClauses.join(", ")}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    if (this.#returning) sql += " RETURNING *";
    return { sql, params };
  }

  execute(): R extends true ? InferRow<T>[] : void {
    const { sql, params } = this.toSQL();
    try {
      if (this.#returning) {
        const rows = this.#client.prepare(sql).all(...bind(params)) as Record<string, unknown>[];
        // SAFETY: decodeRow builds from the table's own column entries
        return rows.map((r) => decodeRow(r, this.#table)) as R extends true ? InferRow<T>[] : never;
      }
      this.#client.prepare(sql).run(...bind(params));
      // SAFETY: R is false here — TS can't narrow conditional return types at runtime
      return undefined as R extends true ? never : void;
    } catch (e) {
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

/** Full DELETE builder — chain `.where()` calls then `.execute()`. */
export class DeleteBuilder<T extends AnyTable, R extends boolean = false> implements Executable {
  #client: DatabaseClient;
  #tableName: string;
  #table: T;
  #conditions: Condition[];
  #returning: boolean;

  constructor(client: DatabaseClient, tableName: string, table: T, conditions: Condition[] = [], returning: R = false as R) {
    this.#client = client;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
    this.#returning = returning;
  }

  where(condition: Condition): DeleteBuilder<T, R> {
    return new DeleteBuilder(this.#client, this.#tableName, this.#table, [
      ...this.#conditions,
      condition,
    ], this.#returning);
  }

  /**
   * Return the deleted row(s) instead of void.
   *
   * @example
   * db.delete(users).where(eq(users.id, "u1")).returning()
   */
  returning(): DeleteBuilder<T, true> {
    return new DeleteBuilder(this.#client, this.#tableName, this.#table, this.#conditions, true);
  }

  toSQL(): { sql: string; params: unknown[] } {
    validateColumnOwnership(this.#conditions, [this.#table], `DELETE from "${this.#tableName}"`);
    const params: unknown[] = [];
    let sql = `DELETE FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== "1=1") sql += ` WHERE ${where}`;
    if (this.#returning) sql += " RETURNING *";
    return { sql, params };
  }

  execute(): R extends true ? InferRow<T>[] : void {
    const { sql, params } = this.toSQL();
    try {
      if (this.#returning) {
        const rows = this.#client.prepare(sql).all(...bind(params)) as Record<string, unknown>[];
        // SAFETY: decodeRow builds from the table's own column entries
        return rows.map((r) => decodeRow(r, this.#table)) as R extends true ? InferRow<T>[] : never;
      }
      this.#client.prepare(sql).run(...bind(params));
      // SAFETY: R is false here — TS can't narrow conditional return types at runtime
      return undefined as R extends true ? never : void;
    } catch (e) {
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}
