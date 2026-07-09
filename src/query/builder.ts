import type { ColumnDef } from '../schema/columns';
import type { Condition } from './conditions';
import { compileConditions, eq } from './conditions';
import type { AnyTable, InferRow, InsertRow } from '../schema/table';
import { FlintValidationError, FlintQueryError } from '../errors';
import type { Executor } from '../executor';

// -----------------------------------------------------------------------
// Type helpers
// -----------------------------------------------------------------------

/**
 * Narrow a row type to specific columns using a mapped type.
 * Unlike Pick, TypeScript eagerly evaluates { [K in C]: T[K] } to a concrete
 * shape in hover info: { id: string; name: string } instead of Pick<...>.
 */
export type NarrowRow<T, C extends keyof T> = { [K in C]: T[K] };

/**
 * Force TypeScript to expand intersection/mapped types into a flat object
 * in hover info: Prettify<{ id: string } & { name: string }> → { id: string; name: string }.
 */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** @internal Get a column by key from a table definition. */
function getCol(tbl: AnyTable, key: string): ColumnDef<any, any> {
  const col = (tbl as Record<string, ColumnDef<any, any>>)[key];
  if (!col) throw new FlintValidationError(`Column "${key}" not found in table`);
  return col;
}

/** @internal Get column entries from a table (filters out `._` and `__indexes`). */
function columnEntries(tbl: AnyTable): [string, ColumnDef<any, any>][] {
  return Object.entries(tbl).filter(([k]) => k !== '_' && k !== '__indexes') as [string, ColumnDef<any, any>][];
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
): NarrowRow<InferRow<T>, C> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const col = getCol(tbl, key as string);
    out[key as string] = col.__internal.decode(raw[col.name]);
  }
  // SAFETY: built from the table's own columns, filtered to the requested keys
  return out as NarrowRow<InferRow<T>, C>;
}

/** @internal Find the primary key TS key of a table. */
function findPKKey(tbl: AnyTable): string {
  for (const [key, col] of columnEntries(tbl)) {
    if (col.__internal.isPrimaryKey) return key;
  }
  throw new FlintValidationError('Table has no primary key column');
}

/** @internal Resolve a join condition from foreign key references. */
function resolveForeignKeyCondition(parent: AnyTable, parentName: string, child: AnyTable, childName: string): Condition {
  for (const [, col] of columnEntries(child)) {
    if (col.__internal.referencesTable === parentName && col.__internal.referencesColumn) {
      // Find the parent column that matches the referenced column name
      const parentCol = getCol(parent, col.__internal.referencesColumn);
      if (parentCol) {
        return eq(parentCol, col);
      }
    }
  }
  throw new FlintValidationError(
    `No foreign key reference found from "${childName}" to "${parentName}". Use .references() on the child table or provide an explicit condition.`,
  );
}

/** @internal Extract all column references from a condition tree. */
function extractColumns(cond: Condition): ColumnDef<any, any>[] {
  switch (cond.type) {
    case 'eq':
      return [cond.column];
    case 'eqColumn':
      return [cond.left, cond.right];
    case 'in':
    case 'notIn':
    case 'isNull':
    case 'isNotNull':
    case 'like':
    case 'glob':
    case 'between':
      return [cond.column];
    case 'and':
    case 'or':
      return cond.conditions.flatMap(extractColumns);
    default:
      return [];
  }
}

/** @internal Validate that all columns in conditions belong to the allowed tables. */
function validateColumnOwnership(conditions: Condition[], allowedTables: AnyTable[], context: string): void {
  const allowedColumns = new Set(allowedTables.flatMap((t) => columnEntries(t).map(([, c]) => c)));
  for (const cond of conditions) {
    const cols = extractColumns(cond);
    for (const col of cols) {
      if (!allowedColumns.has(col)) {
        throw new FlintValidationError(
          `Column "${col.name}" does not belong to ${context}. ` + `Check that you're using a column from the queried table, not a different table.`,
        );
      }
    }
  }
}

/** @internal Resolve column list SQL from selected columns or all entries. */
function resolveColumns<T extends AnyTable>(table: T, selectedColumns: string[] | null, prefix?: string): string {
  if (selectedColumns) {
    return selectedColumns
      .map((k) => {
        const name = getCol(table, k).name;
        return prefix ? `${prefix}.${name}` : name;
      })
      .join(', ');
  }
  const entries = columnEntries(table);
  return entries.map(([, c]) => (prefix ? `${prefix}.${c.name}` : c.name)).join(', ');
}

/** Anything that can produce SQL — used by `db.batch()`. */
export interface Executable {
  toSQL(): { sql: string; params: unknown[] };
}

/** @internal Anything that can run SQL. */

/** @internal */
type JoinType = 'left' | 'inner';

// SELECT builders
/** Phase 1 of a SELECT — only `.from()` is available. */
export interface SelectStage1 {
  from<U extends AnyTable>(table: U): SelectBuilder<U>;
}

/** @internal Lightweight wrapper that only exposes `.from()`. */
export class SelectFromBuilder implements SelectStage1 {
  #executor: Executor;
  #conditions: Condition[];

  constructor(executor: Executor, conditions: Condition[] = []) {
    this.#executor = executor;
    this.#conditions = conditions;
  }

  from<U extends AnyTable>(table: U): SelectBuilder<U> {
    return new SelectBuilder(this.#executor, table._.name, table, this.#conditions);
  }
}

/**
 * Full SELECT builder — available after `.from()`.
 * Returns `InferRow<T>[]` (all columns) from `execute()`.
 * Call `.columns()` to narrow — returns a `NarrowedSelectBuilder`.
 */
export class SelectBuilder<T extends AnyTable> implements Executable {
  #executor: Executor;
  #tableName: string;
  #table: T;
  #conditions: Condition[];
  #selectedColumns: (keyof InferRow<T>)[] | null;
  #orderByClauses: { column: ColumnDef<any, any>; direction: 'asc' | 'desc' }[];
  #limitValue: number | null;
  #offsetValue: number | null;
  #distinct: boolean;

  constructor(
    executor: Executor,
    tableName: string,
    table: T,
    conditions: Condition[] = [],
    selectedColumns: (keyof InferRow<T>)[] | null = null,
    orderByClauses: { column: ColumnDef<any, any>; direction: 'asc' | 'desc' }[] = [],
    limitValue: number | null = null,
    offsetValue: number | null = null,
    distinct: boolean = false,
  ) {
    this.#executor = executor;
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
  where(condition: Condition): SelectBuilder<T> {
    return new SelectBuilder(
      this.#executor,
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
   * Returns a `NarrowedSelectBuilder` with a clean `{ id: string; name: string }` return type.
   *
   * @example
   * db.select().from(users).columns(["id", "name"]).execute()
   * // ^? { id: string; name: string }[]
   */
  columns<K extends keyof InferRow<T>>(keys: K[]): NarrowedSelectBuilder<T, K> {
    return new NarrowedSelectBuilder(
      this.#executor,
      this.#tableName,
      this.#table,
      this.#conditions,
      keys,
      this.#orderByClauses,
      this.#limitValue,
      this.#offsetValue,
      this.#distinct,
    );
  }

  /** Return a single row or null instead of an array. Adds `LIMIT 1` to the SQL. */
  single(): SingleSelectBuilder<T> {
    return new SingleSelectBuilder(
      this.#executor,
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
  distinct(): SelectBuilder<T> {
    return new SelectBuilder(
      this.#executor,
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

  /** Add an ORDER BY clause. Multiple calls stack. */
  orderBy<K extends keyof InferRow<T>>(key: K, direction: 'asc' | 'desc' = 'asc'): SelectBuilder<T> {
    const column = getCol(this.#table, key as string);
    return new SelectBuilder(
      this.#executor,
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
  limit(n: number): SelectBuilder<T> {
    return new SelectBuilder(
      this.#executor,
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
  offset(n: number): SelectBuilder<T> {
    return new SelectBuilder(
      this.#executor,
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
    const distinct = this.#distinct ? 'DISTINCT ' : '';
    let sql = `SELECT ${distinct}${cols} FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== '1=1') sql += ` WHERE ${where}`;
    if (this.#orderByClauses.length > 0) {
      const orderClauses = this.#orderByClauses.map((o) => `${o.column.name} ${o.direction.toUpperCase()}`).join(', ');
      sql += ` ORDER BY ${orderClauses}`;
    }
    if (this.#limitValue !== null) sql += ` LIMIT ${this.#limitValue}`;
    if (this.#offsetValue !== null) sql += ` OFFSET ${this.#offsetValue}`;
    return { sql, params };
  }

  /** Execute the query and return all matching rows. */
  async execute(): Promise<InferRow<T>[]> {
    const { sql, params } = this.toSQL();
    try {
      const rows = await this.#executor.all(sql, params);
      const records = rows as Record<string, unknown>[];
      if (this.#selectedColumns) {
        return records.map((r) => decodeSelectedRow(r, this.#table, this.#selectedColumns!)) as InferRow<T>[];
      }
      return records.map((r) => decodeRow(r, this.#table));
    } catch (e) {
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

/**
 * Narrowed SELECT builder — after `.columns()` has been called.
 * Returns `NarrowRow<InferRow<T>, C>[]` from `execute()` — a clean
 * `{ id: string; name: string }` shape, no Pick wrapper.
 */
export class NarrowedSelectBuilder<T extends AnyTable, C extends keyof InferRow<T>> implements Executable {
  #executor: Executor;
  #tableName: string;
  #table: T;
  #conditions: Condition[];
  #selectedColumns: C[];
  #orderByClauses: { column: ColumnDef<any, any>; direction: 'asc' | 'desc' }[];
  #limitValue: number | null;
  #offsetValue: number | null;
  #distinct: boolean;

  constructor(
    executor: Executor,
    tableName: string,
    table: T,
    conditions: Condition[],
    selectedColumns: C[],
    orderByClauses: { column: ColumnDef<any, any>; direction: 'asc' | 'desc' }[],
    limitValue: number | null,
    offsetValue: number | null,
    distinct: boolean,
  ) {
    this.#executor = executor;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
    this.#orderByClauses = orderByClauses;
    this.#limitValue = limitValue;
    this.#offsetValue = offsetValue;
    this.#distinct = distinct;
  }

  where(condition: Condition): NarrowedSelectBuilder<T, C> {
    return new NarrowedSelectBuilder(
      this.#executor,
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

  distinct(): NarrowedSelectBuilder<T, C> {
    return new NarrowedSelectBuilder(
      this.#executor,
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

  single(): NarrowedSingleSelectBuilder<T, C> {
    return new NarrowedSingleSelectBuilder(
      this.#executor,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      this.#orderByClauses,
      this.#offsetValue,
      this.#distinct,
    );
  }

  orderBy<K extends keyof InferRow<T>>(key: K, direction: 'asc' | 'desc' = 'asc'): NarrowedSelectBuilder<T, C> {
    const column = getCol(this.#table, key as string);
    return new NarrowedSelectBuilder(
      this.#executor,
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

  limit(n: number): NarrowedSelectBuilder<T, C> {
    return new NarrowedSelectBuilder(
      this.#executor,
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

  offset(n: number): NarrowedSelectBuilder<T, C> {
    return new NarrowedSelectBuilder(
      this.#executor,
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
    const distinct = this.#distinct ? 'DISTINCT ' : '';
    let sql = `SELECT ${distinct}${cols} FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== '1=1') sql += ` WHERE ${where}`;
    if (this.#orderByClauses.length > 0) {
      const orderClauses = this.#orderByClauses.map((o) => `${o.column.name} ${o.direction.toUpperCase()}`).join(', ');
      sql += ` ORDER BY ${orderClauses}`;
    }
    if (this.#limitValue !== null) sql += ` LIMIT ${this.#limitValue}`;
    if (this.#offsetValue !== null) sql += ` OFFSET ${this.#offsetValue}`;
    return { sql, params };
  }

  /** Execute the query and return narrowed rows. */
  async execute(): Promise<Prettify<NarrowRow<InferRow<T>, C>>[]> {
    const { sql, params } = this.toSQL();
    try {
      const rows = await this.#executor.all(sql, params);
      return (rows as Record<string, unknown>[]).map((r) => decodeSelectedRow(r, this.#table, this.#selectedColumns));
    } catch (e) {
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

/**
 * Single-row SELECT builder — after `.single()` on a `SelectBuilder`.
 * Returns `InferRow<T> | null` from `execute()`.
 */
export class SingleSelectBuilder<T extends AnyTable> implements Executable {
  #executor: Executor;
  #tableName: string;
  #table: T;
  #conditions: Condition[];
  #selectedColumns: (keyof InferRow<T>)[] | null;
  #orderByClauses: { column: ColumnDef<any, any>; direction: 'asc' | 'desc' }[];
  #offsetValue: number | null;
  #distinct: boolean;

  constructor(
    executor: Executor,
    tableName: string,
    table: T,
    conditions: Condition[],
    selectedColumns: (keyof InferRow<T>)[] | null = null,
    orderByClauses: { column: ColumnDef<any, any>; direction: 'asc' | 'desc' }[] = [],
    offsetValue: number | null = null,
    distinct: boolean = false,
  ) {
    this.#executor = executor;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
    this.#orderByClauses = orderByClauses;
    this.#offsetValue = offsetValue;
    this.#distinct = distinct;
  }

  where(condition: Condition): SingleSelectBuilder<T> {
    return new SingleSelectBuilder(
      this.#executor,
      this.#tableName,
      this.#table,
      [...this.#conditions, condition],
      this.#selectedColumns,
      this.#orderByClauses,
      this.#offsetValue,
      this.#distinct,
    );
  }

  orderBy<K extends keyof InferRow<T>>(key: K, direction: 'asc' | 'desc' = 'asc'): SingleSelectBuilder<T> {
    const column = getCol(this.#table, key as string);
    return new SingleSelectBuilder(
      this.#executor,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      [...this.#orderByClauses, { column, direction }],
      this.#offsetValue,
      this.#distinct,
    );
  }

  offset(n: number): SingleSelectBuilder<T> {
    return new SingleSelectBuilder(
      this.#executor,
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
    const distinct = this.#distinct ? 'DISTINCT ' : '';
    let sql = `SELECT ${distinct}${cols} FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== '1=1') sql += ` WHERE ${where}`;
    if (this.#orderByClauses.length > 0) {
      const orderClauses = this.#orderByClauses.map((o) => `${o.column.name} ${o.direction.toUpperCase()}`).join(', ');
      sql += ` ORDER BY ${orderClauses}`;
    }
    sql += ' LIMIT 1';
    if (this.#offsetValue !== null) sql += ` OFFSET ${this.#offsetValue}`;
    return { sql, params };
  }

  /** Returns a single row or null, never throws on empty results. */
  async execute(): Promise<InferRow<T> | null> {
    const { sql, params } = this.toSQL();
    try {
      const row = await this.#executor.get(sql, params);
      if (!row) return null;
      const record = row as Record<string, unknown>;
      if (this.#selectedColumns) {
        return decodeSelectedRow(record, this.#table, this.#selectedColumns) as InferRow<T>;
      }
      return decodeRow(record, this.#table);
    } catch (e) {
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

/**
 * Narrowed single-row SELECT builder — after `.single()` on a `NarrowedSelectBuilder`.
 * Returns `NarrowRow<InferRow<T>, C> | null` from `execute()`.
 */
export class NarrowedSingleSelectBuilder<T extends AnyTable, C extends keyof InferRow<T>> implements Executable {
  #executor: Executor;
  #tableName: string;
  #table: T;
  #conditions: Condition[];
  #selectedColumns: C[];
  #orderByClauses: { column: ColumnDef<any, any>; direction: 'asc' | 'desc' }[];
  #offsetValue: number | null;
  #distinct: boolean;

  constructor(
    executor: Executor,
    tableName: string,
    table: T,
    conditions: Condition[],
    selectedColumns: C[],
    orderByClauses: { column: ColumnDef<any, any>; direction: 'asc' | 'desc' }[],
    offsetValue: number | null,
    distinct: boolean,
  ) {
    this.#executor = executor;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
    this.#selectedColumns = selectedColumns;
    this.#orderByClauses = orderByClauses;
    this.#offsetValue = offsetValue;
    this.#distinct = distinct;
  }

  where(condition: Condition): NarrowedSingleSelectBuilder<T, C> {
    return new NarrowedSingleSelectBuilder(
      this.#executor,
      this.#tableName,
      this.#table,
      [...this.#conditions, condition],
      this.#selectedColumns,
      this.#orderByClauses,
      this.#offsetValue,
      this.#distinct,
    );
  }

  orderBy<K extends keyof InferRow<T>>(key: K, direction: 'asc' | 'desc' = 'asc'): NarrowedSingleSelectBuilder<T, C> {
    const column = getCol(this.#table, key as string);
    return new NarrowedSingleSelectBuilder(
      this.#executor,
      this.#tableName,
      this.#table,
      this.#conditions,
      this.#selectedColumns,
      [...this.#orderByClauses, { column, direction }],
      this.#offsetValue,
      this.#distinct,
    );
  }

  offset(n: number): NarrowedSingleSelectBuilder<T, C> {
    return new NarrowedSingleSelectBuilder(
      this.#executor,
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
    const distinct = this.#distinct ? 'DISTINCT ' : '';
    let sql = `SELECT ${distinct}${cols} FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== '1=1') sql += ` WHERE ${where}`;
    if (this.#orderByClauses.length > 0) {
      const orderClauses = this.#orderByClauses.map((o) => `${o.column.name} ${o.direction.toUpperCase()}`).join(', ');
      sql += ` ORDER BY ${orderClauses}`;
    }
    sql += ' LIMIT 1';
    if (this.#offsetValue !== null) sql += ` OFFSET ${this.#offsetValue}`;
    return { sql, params };
  }

  /** Returns a single narrowed row or null. */
  async execute(): Promise<Prettify<NarrowRow<InferRow<T>, C>> | null> {
    const { sql, params } = this.toSQL();
    try {
      const row = await this.#executor.get(sql, params);
      if (!row) return null;
      return decodeSelectedRow(row as Record<string, unknown>, this.#table, this.#selectedColumns);
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
export interface JoinBuilder<Parent extends AnyTable, Joined extends AnyTable[], ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>> {
  on<NewChild extends AnyTable>(child: NewChild, condition: Condition): JoinBuilder<Parent, [...Joined, NewChild], ParentCols>;
  /** Auto-join: infer condition from foreign key references. */
  on<NewChild extends AnyTable>(child: NewChild): JoinBuilder<Parent, [...Joined, NewChild], ParentCols>;
  columns<K extends keyof InferRow<Parent>>(keys: K[]): JoinBuilder<Parent, Joined, K>;
  where(condition: Condition): JoinBuilder<Parent, Joined, ParentCols>;
  orderBy<K extends keyof InferRow<Parent>>(key: K, direction?: 'asc' | 'desc'): JoinBuilder<Parent, Joined, ParentCols>;
  limit(n: number): JoinBuilder<Parent, Joined, ParentCols>;
  offset(n: number): JoinBuilder<Parent, Joined, ParentCols>;
  single(): SingleJoinBuilder<Parent, Joined, ParentCols>;
  toSQL(): { sql: string; params: unknown[] };
  execute(): Promise<JoinResult<Parent, Joined, ParentCols>[]>;
}

/** @internal Single-row join builder — after `.single()` on a JoinBuilder. */
export interface SingleJoinBuilder<
  Parent extends AnyTable,
  Joined extends AnyTable[],
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> {
  where(condition: Condition): SingleJoinBuilder<Parent, Joined, ParentCols>;
  orderBy<K extends keyof InferRow<Parent>>(key: K, direction?: 'asc' | 'desc'): SingleJoinBuilder<Parent, Joined, ParentCols>;
  offset(n: number): SingleJoinBuilder<Parent, Joined, ParentCols>;
  toSQL(): { sql: string; params: unknown[] };
  execute(): Promise<JoinResult<Parent, Joined, ParentCols> | null>;
}

/** @internal Implementation of JoinSelectStage1. */
export class JoinStage1<Parent extends AnyTable> implements JoinSelectStage1<Parent> {
  #executor: Executor;
  #parent: Parent;
  #parentName: string;
  #joinType: JoinType;

  constructor(executor: Executor, parent: Parent, parentName: string, joinType: JoinType) {
    this.#executor = executor;
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
  on<Child extends AnyTable>(child: Child, condition?: Condition): JoinBuilder<Parent, [Child]> {
    const childName = child._.name;
    const resolvedCondition = condition ?? resolveForeignKeyCondition(this.#parent, this.#parentName, child, childName);
    return new JoinBuilderImpl(
      this.#executor,
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
  #executor: Executor;
  #parent: Parent;
  #parentName: string;
  #joins: JoinClause[];
  #joinType: JoinType;
  #conditions: Condition[];
  #selectedColumns: ParentCols[] | null;
  #orderByClauses: { column: ColumnDef<any, any>; direction: 'asc' | 'desc' }[];
  #limitValue: number | null;
  #offsetValue: number | null;

  constructor(
    executor: Executor,
    parent: Parent,
    parentName: string,
    joins: JoinClause[],
    joinType: JoinType,
    conditions: Condition[] = [],
    selectedColumns: ParentCols[] | null = null,
    orderByClauses: { column: ColumnDef<any, any>; direction: 'asc' | 'desc' }[] = [],
    limitValue: number | null = null,
    offsetValue: number | null = null,
  ) {
    this.#executor = executor;
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
  on<NewChild extends AnyTable>(child: NewChild, condition?: Condition): JoinBuilder<Parent, [...Joined, NewChild], ParentCols> {
    const childName = child._.name;
    const resolvedCondition = condition ?? resolveForeignKeyCondition(this.#parent, this.#parentName, child, childName);
    // SAFETY: constructor args match the interface — TypeScript can't infer the spread tuple type
    return new JoinBuilderImpl(
      this.#executor,
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
      this.#executor,
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
      this.#executor,
      this.#parent,
      this.#parentName,
      this.#joins,
      this.#joinType,
      this.#conditions,
      keys as unknown as ParentCols[],
      this.#orderByClauses,
      this.#limitValue,
      this.#offsetValue,
    ) as unknown as JoinBuilder<Parent, Joined, K>;
  }

  orderBy<K extends keyof InferRow<Parent>>(key: K, direction: 'asc' | 'desc' = 'asc'): JoinBuilder<Parent, Joined, ParentCols> {
    const column = getCol(this.#parent, key as string);
    // SAFETY: constructor args match the interface
    return new JoinBuilderImpl(
      this.#executor,
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
      this.#executor,
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
      this.#executor,
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
      this.#executor,
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
    const allowedTables = [this.#parent, ...this.#joins.map((j) => j.table)];
    validateColumnOwnership(this.#conditions, allowedTables, `SELECT from "${this.#parentName}"`);
    const parentCols = resolveColumns(this.#parent, this.#selectedColumns as unknown as string[] | null, this.#parentName);

    const childCols: string[] = [];
    for (const join of this.#joins) {
      const entries = columnEntries(join.table);
      for (const [, c] of entries) {
        childCols.push(`${join.name}.${c.name} AS ${join.name}_${c.name}`);
      }
    }

    const joinKeyword = this.#joinType === 'left' ? 'LEFT JOIN' : 'INNER JOIN';
    const joinClauses: string[] = [];
    const joinParams: unknown[] = [];
    for (const join of this.#joins) {
      const joinOn = compileConditions([join.condition], joinParams);
      joinClauses.push(`${joinKeyword} ${join.name} ON ${joinOn}`);
    }

    const whereParams: unknown[] = [];
    const where = compileConditions(this.#conditions, whereParams);

    let sql = `SELECT ${parentCols}${childCols.length ? ', ' + childCols.join(', ') : ''} FROM ${this.#parentName} ${joinClauses.join(' ')}`;
    if (where !== '1=1') sql += ` WHERE ${where}`;
    if (this.#orderByClauses.length > 0) {
      const orderClauses = this.#orderByClauses.map((o) => `${o.column.name} ${o.direction.toUpperCase()}`).join(', ');
      sql += ` ORDER BY ${orderClauses}`;
    }
    if (this.#limitValue !== null) sql += ` LIMIT ${this.#limitValue}`;
    if (this.#offsetValue !== null) sql += ` OFFSET ${this.#offsetValue}`;

    return { sql, params: [...joinParams, ...whereParams] };
  }

  async execute(): Promise<JoinResult<Parent, Joined, ParentCols>[]> {
    const { sql, params } = this.toSQL();
    try {
      const rows = await this.#executor.all(sql, params);
      return this.#decodeJoinRows(rows as Record<string, unknown>[]);
    } catch (e) {
      if (e instanceof FlintQueryError) throw e;
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }

  /** @internal Decode flat joined rows into nested result. */
  #decodeJoinRows(rows: Record<string, unknown>[]): JoinResult<Parent, Joined, ParentCols>[] {
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

    const grouped = new Map<unknown, { parent: Record<string, unknown>; children: Record<string, unknown>[][] }>();

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
        if (this.#joinType === 'left' && !hasNonNullChild) return;
        group.children[i]!.push(childRow);
      });
    }

    const result: JoinResult<Parent, Joined, ParentCols>[] = [];
    for (const { parent, children } of grouped.values()) {
      const decodedParent = this.#selectedColumns ? decodeSelectedRow(parent, this.#parent, this.#selectedColumns) : decodeRow(parent, this.#parent);

      const nested: Record<string, unknown> = { ...decodedParent };
      childEntryMaps.forEach((childMap, i) => {
        nested[childMap.name] = children[i]!.map((c) => decodeRow(c, childMap.table));
      });

      result.push(nested as JoinResult<Parent, Joined, ParentCols>);
    }

    return result;
  }
}

/** The result type for joined queries. Parent fields are narrowed by `.columns()`; each joined table's data is nested under its table name. */
export type JoinResult<
  Parent extends AnyTable,
  _Joined extends AnyTable[],
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> = Prettify<Pick<InferRow<Parent>, ParentCols>> & Record<string, unknown>;

/** @internal Single-row join builder implementation. */
export class SingleJoinBuilderImpl<
  Parent extends AnyTable,
  Joined extends AnyTable[],
  ParentCols extends keyof InferRow<Parent> = keyof InferRow<Parent>,
> implements Executable {
  #executor: Executor;
  #parent: Parent;
  #parentName: string;
  #joins: JoinClause[];
  #joinType: JoinType;
  #conditions: Condition[];
  #selectedColumns: ParentCols[] | null;
  #orderByClauses: { column: ColumnDef<any, any>; direction: 'asc' | 'desc' }[];
  #offsetValue: number | null;

  constructor(
    executor: Executor,
    parent: Parent,
    parentName: string,
    joins: JoinClause[],
    joinType: JoinType,
    conditions: Condition[],
    selectedColumns: ParentCols[] | null = null,
    orderByClauses: { column: ColumnDef<any, any>; direction: 'asc' | 'desc' }[] = [],
    offsetValue: number | null = null,
  ) {
    this.#executor = executor;
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
      this.#executor,
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

  orderBy<K extends keyof InferRow<Parent>>(key: K, direction: 'asc' | 'desc' = 'asc'): SingleJoinBuilderImpl<Parent, Joined, ParentCols> {
    const column = getCol(this.#parent, key as string);
    return new SingleJoinBuilderImpl(
      this.#executor,
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
      this.#executor,
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
    const allowedTables = [this.#parent, ...this.#joins.map((j) => j.table)];
    validateColumnOwnership(this.#conditions, allowedTables, `SELECT from "${this.#parentName}"`);
    const parentCols = resolveColumns(this.#parent, this.#selectedColumns as unknown as string[] | null, this.#parentName);

    const childCols: string[] = [];
    for (const join of this.#joins) {
      const entries = columnEntries(join.table);
      for (const [, c] of entries) {
        childCols.push(`${join.name}.${c.name} AS ${join.name}_${c.name}`);
      }
    }

    const joinKeyword = this.#joinType === 'left' ? 'LEFT JOIN' : 'INNER JOIN';
    const joinClauses: string[] = [];
    const joinParams: unknown[] = [];
    for (const join of this.#joins) {
      const joinOn = compileConditions([join.condition], joinParams);
      joinClauses.push(`${joinKeyword} ${join.name} ON ${joinOn}`);
    }

    const whereParams: unknown[] = [];
    const where = compileConditions(this.#conditions, whereParams);

    let sql = `SELECT ${parentCols}${childCols.length ? ', ' + childCols.join(', ') : ''} FROM ${this.#parentName} ${joinClauses.join(' ')}`;
    if (where !== '1=1') sql += ` WHERE ${where}`;
    if (this.#orderByClauses.length > 0) {
      const orderClauses = this.#orderByClauses.map((o) => `${o.column.name} ${o.direction.toUpperCase()}`).join(', ');
      sql += ` ORDER BY ${orderClauses}`;
    }
    sql += ' LIMIT 1';
    if (this.#offsetValue !== null) sql += ` OFFSET ${this.#offsetValue}`;

    return { sql, params: [...joinParams, ...whereParams] };
  }

  /** @internal Returns a single parent with nested children, or null. */
  async execute(): Promise<JoinResult<Parent, Joined, ParentCols> | null> {
    const { sql, params } = this.toSQL();
    try {
      const rows = await this.#executor.all(sql, params);
      const records = rows as Record<string, unknown>[];
      if (records.length === 0) return null;
      return this.#decodeJoinRow(records);
    } catch (e) {
      if (e instanceof FlintQueryError) throw e;
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }

  /** @internal Decode flat joined rows into a single nested result. */
  #decodeJoinRow(rows: Record<string, unknown>[]): JoinResult<Parent, Joined, ParentCols> | null {
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

    const grouped = new Map<unknown, { parent: Record<string, unknown>; children: Record<string, unknown>[][] }>();

    for (const r of rows) {
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
        if (this.#joinType === 'left' && !hasNonNullChild) return;
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
  }
}

/** Phase 1 of an INSERT — only `.values()` is available. */
export interface InsertStage1<T extends AnyTable> {
  values(row: InsertRow<T>): InsertBuilder<T>;
  values(rows: InsertRow<T>[]): InsertBuilder<T>;
}

/** @internal Lightweight wrapper that only exposes `.values()`. */
export class InsertValuesBuilder<T extends AnyTable> implements InsertStage1<T> {
  #executor: Executor;
  #tableName: string;
  #table: T;

  constructor(executor: Executor, tableName: string, table: T) {
    this.#executor = executor;
    this.#tableName = tableName;
    this.#table = table;
  }

  values(row: InsertRow<T>): InsertBuilder<T>;
  values(rows: InsertRow<T>[]): InsertBuilder<T>;
  values(rowOrRows: InsertRow<T> | InsertRow<T>[]): InsertBuilder<T> {
    return new InsertBuilder(this.#executor, this.#tableName, this.#table, rowOrRows);
  }
}

/** @internal ON CONFLICT strategy type. */
type OnConflictDoNothing = { mode: 'nothing' };
type OnConflictDoUpdate<T extends AnyTable> = {
  mode: 'update';
  target: ColumnDef<any, any> | ColumnDef<any, any>[];
  set: Partial<InferRow<T>>;
};
type OnConflictStrategy<T extends AnyTable> = OnConflictDoNothing | OnConflictDoUpdate<T>;

/** Full INSERT builder — available after `.values()` has been called. */
export class InsertBuilder<T extends AnyTable, R extends boolean = false, K extends keyof InferRow<T> = keyof InferRow<T>> implements Executable {
  #executor: Executor;
  #tableName: string;
  #table: T;
  #rows: InsertRow<T>[];
  #returning: boolean | K[];
  #onConflict?: OnConflictStrategy<T>;

  constructor(
    executor: Executor,
    tableName: string,
    table: T,
    rowOrRows: InsertRow<T> | InsertRow<T>[],
    returning: boolean | K[] = false,
    onConflict?: OnConflictStrategy<T>,
  ) {
    this.#executor = executor;
    this.#tableName = tableName;
    this.#table = table;
    this.#rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    this.#returning = returning;
    this.#onConflict = onConflict;
  }

  /**
   * Return the inserted row(s) instead of void.
   * Pass an array of column names to narrow the result shape.
   *
   * @example
   * db.insert(users).values({ id: "u1", name: "Alice" }).returning()
   * db.insert(users).values({ id: "u1", name: "Alice" }).returning(["id", "name"])
   */
  returning(): InsertBuilder<T, true>;
  returning<NewK extends keyof InferRow<T>>(keys: NewK[]): InsertBuilder<T, true, NewK>;
  returning(keys?: (keyof InferRow<T>)[]): InsertBuilder<T, true, keyof InferRow<T>> {
    return new InsertBuilder(this.#executor, this.#tableName, this.#table, this.#rows, keys ?? true, this.#onConflict);
  }

  /**
   * On conflict, do nothing (ignore the insert).
   *
   * @example
   * db.insert(users).values(row).onConflictDoNothing()
   */
  onConflictDoNothing(): InsertBuilder<T, R, K> {
    return new InsertBuilder(this.#executor, this.#tableName, this.#table, this.#rows, this.#returning, { mode: 'nothing' });
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
  onConflictDoUpdate<C extends ColumnDef<any, any>>(options: { target: C | C[]; set: Partial<InferRow<T>> }): InsertBuilder<T, R, K> {
    return new InsertBuilder(this.#executor, this.#tableName, this.#table, this.#rows, this.#returning, {
      mode: 'update',
      target: options.target,
      set: options.set,
    });
  }

  toSQL(): { sql: string; params: unknown[] } {
    const entries = columnEntries(this.#table);

    // Determine which columns to insert (skip defaults/autoincrement when undefined in ALL rows)
    const inserts: [string, ColumnDef<any, any>][] = [];
    for (const [key, c] of entries) {
      const allUndefined = this.#rows.every((row) => (row as Record<string, unknown>)[key] === undefined);
      if (allUndefined && (c.__internal.hasDefault || c.__internal.isAutoIncrement)) {
        continue;
      }
      inserts.push([key, c]);
    }

    if (inserts.length === 0) {
      // All columns have defaults — insert with defaults only
      const allDefault = entries.filter(([, c]) => c.__internal.hasDefault || c.__internal.isAutoIncrement || c.__internal.hasDefaultNow);
      const names = allDefault.map(([, c]) => c.name).join(', ');
      const placeholders = allDefault.map(() => 'DEFAULT').join(', ');
      return {
        sql: `INSERT INTO ${this.#tableName} (${names}) VALUES (${placeholders})`,
        params: [],
      };
    }

    const names = inserts.map(([, c]) => c.name).join(', ');
    const placeholderRow = inserts.map(() => '?').join(', ');
    const allPlaceholders = this.#rows.map(() => `(${placeholderRow})`).join(', ');

    const params: unknown[] = [];
    for (const row of this.#rows) {
      for (const [key, c] of inserts) {
        const value = (row as Record<string, unknown>)[key];
        if (value === undefined && c.__internal.hasDefaultNow) {
          params.push(c.__internal.encode(new Date()));
        } else {
          params.push(c.__internal.encode(value));
        }
      }
    }

    let sql = `INSERT INTO ${this.#tableName} (${names}) VALUES ${allPlaceholders}`;

    // ON CONFLICT clause
    if (this.#onConflict) {
      if (this.#onConflict.mode === 'nothing') {
        sql += ' ON CONFLICT DO NOTHING';
      } else {
        // Build target column(s)
        const target = this.#onConflict.target;
        const targetCols = Array.isArray(target) ? target : [target];
        const targetNames = targetCols.map((c) => c.name).join(', ');

        // Build SET clause using excluded.* for proposed values
        const setEntries = Object.entries(this.#onConflict.set);
        const setClauses = setEntries
          .map(([key, value]) => {
            const col = getCol(this.#table, key);
            if (value === undefined) return null;
            // Use excluded.column for the proposed value
            return `${col.name} = excluded.${col.name}`;
          })
          .filter(Boolean);

        if (setClauses.length > 0) {
          sql += ` ON CONFLICT (${targetNames}) DO UPDATE SET ${setClauses.join(', ')}`;
        }
      }
    }

    if (this.#returning) {
      if (Array.isArray(this.#returning)) {
        const cols = this.#returning.map((k) => getCol(this.#table, k as string).name).join(', ');
        sql += ` RETURNING ${cols}`;
      } else {
        sql += ' RETURNING *';
      }
    }
    return { sql, params };
  }

  async execute(): Promise<R extends true ? Prettify<NarrowRow<InferRow<T>, K>>[] : void> {
    const { sql, params } = this.toSQL();
    try {
      if (this.#returning) {
        const rows = await this.#executor.all(sql, params);
        const records = rows as Record<string, unknown>[];
        if (Array.isArray(this.#returning)) {
          return records.map((r) => decodeSelectedRow(r, this.#table, this.#returning as (keyof InferRow<T>)[])) as unknown as R extends true
            ? Prettify<NarrowRow<InferRow<T>, K>>[]
            : never;
        }
        return records.map((r) => decodeRow(r, this.#table)) as unknown as R extends true ? Prettify<NarrowRow<InferRow<T>, K>>[] : never;
      }
      await this.#executor.run(sql, params);
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
  #executor: Executor;
  #tableName: string;
  #table: T;

  constructor(executor: Executor, tableName: string, table: T) {
    this.#executor = executor;
    this.#tableName = tableName;
    this.#table = table;
  }

  set(partial: Partial<InferRow<T>>): UpdateBuilder<T> {
    return new UpdateBuilder(this.#executor, this.#tableName, this.#table, partial);
  }
}

/** Full UPDATE builder — available after `.set()` has been called. */
export class UpdateBuilder<T extends AnyTable, R extends boolean = false, K extends keyof InferRow<T> = keyof InferRow<T>> implements Executable {
  #executor: Executor;
  #tableName: string;
  #table: T;
  #set: Partial<InferRow<T>>;
  #conditions: Condition[];
  #returning: boolean | K[];

  constructor(
    executor: Executor,
    tableName: string,
    table: T,
    set: Partial<InferRow<T>>,
    conditions: Condition[] = [],
    returning: boolean | K[] = false,
  ) {
    this.#executor = executor;
    this.#tableName = tableName;
    this.#table = table;
    this.#set = set;
    this.#conditions = conditions;
    this.#returning = returning;
  }

  set(partial: Partial<InferRow<T>>): UpdateBuilder<T, R, K> {
    return new UpdateBuilder(this.#executor, this.#tableName, this.#table, { ...this.#set, ...partial }, this.#conditions, this.#returning);
  }

  where(condition: Condition): UpdateBuilder<T, R, K> {
    return new UpdateBuilder(this.#executor, this.#tableName, this.#table, this.#set, [...this.#conditions, condition], this.#returning);
  }

  /**
   * Return the updated row(s) instead of void.
   * Pass an array of column names to narrow the result shape.
   *
   * @example
   * db.update(users).set({ name: "Bob" }).where(eq(users.id, "u1")).returning()
   * db.update(users).set({ name: "Bob" }).where(eq(users.id, "u1")).returning(["id", "name"])
   */
  returning(): UpdateBuilder<T, true>;
  returning<NewK extends keyof InferRow<T>>(keys: NewK[]): UpdateBuilder<T, true, NewK>;
  returning(keys?: (keyof InferRow<T>)[]): UpdateBuilder<T, true, keyof InferRow<T>> {
    return new UpdateBuilder(this.#executor, this.#tableName, this.#table, this.#set, this.#conditions, keys ?? true);
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
    let sql = `UPDATE ${this.#tableName} SET ${setClauses.join(', ')}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== '1=1') sql += ` WHERE ${where}`;
    if (this.#returning) {
      if (Array.isArray(this.#returning)) {
        const cols = this.#returning.map((k) => getCol(this.#table, k as string).name).join(', ');
        sql += ` RETURNING ${cols}`;
      } else {
        sql += ' RETURNING *';
      }
    }
    return { sql, params };
  }

  async execute(): Promise<R extends true ? Prettify<NarrowRow<InferRow<T>, K>>[] : void> {
    const { sql, params } = this.toSQL();
    try {
      if (this.#returning) {
        const rows = await this.#executor.all(sql, params);
        const records = rows as Record<string, unknown>[];
        if (Array.isArray(this.#returning)) {
          return records.map((r) => decodeSelectedRow(r, this.#table, this.#returning as (keyof InferRow<T>)[])) as unknown as R extends true
            ? Prettify<NarrowRow<InferRow<T>, K>>[]
            : never;
        }
        return records.map((r) => decodeRow(r, this.#table)) as unknown as R extends true ? Prettify<NarrowRow<InferRow<T>, K>>[] : never;
      }
      await this.#executor.run(sql, params);
      return undefined as R extends true ? never : void;
    } catch (e) {
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}

/** Full DELETE builder — chain `.where()` calls then `.execute()`. */
export class DeleteBuilder<T extends AnyTable, R extends boolean = false, K extends keyof InferRow<T> = keyof InferRow<T>> implements Executable {
  #executor: Executor;
  #tableName: string;
  #table: T;
  #conditions: Condition[];
  #returning: boolean | K[];

  constructor(executor: Executor, tableName: string, table: T, conditions: Condition[] = [], returning: boolean | K[] = false) {
    this.#executor = executor;
    this.#tableName = tableName;
    this.#table = table;
    this.#conditions = conditions;
    this.#returning = returning;
  }

  where(condition: Condition): DeleteBuilder<T, R, K> {
    return new DeleteBuilder(this.#executor, this.#tableName, this.#table, [...this.#conditions, condition], this.#returning);
  }

  /**
   * Return the deleted row(s) instead of void.
   * Pass an array of column names to narrow the result shape.
   *
   * @example
   * db.delete(users).where(eq(users.id, "u1")).returning()
   * db.delete(users).where(eq(users.id, "u1")).returning(["id", "name"])
   */
  returning(): DeleteBuilder<T, true>;
  returning<NewK extends keyof InferRow<T>>(keys: NewK[]): DeleteBuilder<T, true, NewK>;
  returning(keys?: (keyof InferRow<T>)[]): DeleteBuilder<T, true, keyof InferRow<T>> {
    return new DeleteBuilder(this.#executor, this.#tableName, this.#table, this.#conditions, keys ?? true);
  }

  toSQL(): { sql: string; params: unknown[] } {
    validateColumnOwnership(this.#conditions, [this.#table], `DELETE from "${this.#tableName}"`);
    const params: unknown[] = [];
    let sql = `DELETE FROM ${this.#tableName}`;
    const where = compileConditions(this.#conditions, params);
    if (where !== '1=1') sql += ` WHERE ${where}`;
    if (this.#returning) {
      if (Array.isArray(this.#returning)) {
        const cols = this.#returning.map((k) => getCol(this.#table, k as string).name).join(', ');
        sql += ` RETURNING ${cols}`;
      } else {
        sql += ' RETURNING *';
      }
    }
    return { sql, params };
  }

  async execute(): Promise<R extends true ? Prettify<NarrowRow<InferRow<T>, K>>[] : void> {
    const { sql, params } = this.toSQL();
    try {
      if (this.#returning) {
        const rows = await this.#executor.all(sql, params);
        const records = rows as Record<string, unknown>[];
        if (Array.isArray(this.#returning)) {
          return records.map((r) => decodeSelectedRow(r, this.#table, this.#returning as (keyof InferRow<T>)[])) as unknown as R extends true
            ? Prettify<NarrowRow<InferRow<T>, K>>[]
            : never;
        }
        return records.map((r) => decodeRow(r, this.#table)) as unknown as R extends true ? Prettify<NarrowRow<InferRow<T>, K>>[] : never;
      }
      await this.#executor.run(sql, params);
      return undefined as R extends true ? never : void;
    } catch (e) {
      throw new FlintQueryError(`Failed to execute query: ${sql}`, e as Error);
    }
  }
}
