import type { Executor } from './executor';
import { SelectBuilder, InsertValuesBuilder, UpdateSetBuilder, DeleteBuilder, JoinStage1 } from './query/builder';
import type { Executable, InsertStage1, UpdateStage1, JoinSelectStage1 } from './query/builder';
import { count, countColumn, sum, avg, min, max } from './query/aggregates';
import type { AnyTable } from './schema/table';
import type { Condition } from './query/conditions';
import type { ColumnDef } from './schema/columns';

// Re-export Executable so consumers can type their own batch helpers.
export type { Executable, SelectBuilder, InsertStage1, UpdateStage1, JoinSelectStage1, JoinBuilder, SingleJoinBuilder } from './query/builder';
export type { JoinResult } from './query/builder';

/**
 * A raw SQL expression with parameters.
 */
export interface SQLExpression {
  sql: string;
  params: unknown[];
}

/**
 * Create a flint database client from an executor.
 *
 * This is the shared core — driver-specific entry points call this
 * with their executor implementation.
 *
 * @example
 * // Used internally by driver entry points:
 * import { createClient } from '../flint'
 * export function flint(details) {
 *   const executor = new BunSqliteExecutor(new Database(details.url))
 *   return createClient(executor)
 * }
 */
export function createClient(executor: Executor) {
  return {
    /**
     * Start a SELECT query — pass a table definition.
     *
     * @example
     * const rows = db.selectFrom(users).execute()
     */
    selectFrom: <T extends AnyTable>(table: T) => new SelectBuilder(executor, table._.name, table),

    /**
     * Start an INSERT — call `.values(row)` next.
     *
     * @example
     * db.insert(users).values({ id: "u1", name: "Alice" }).execute()
     */
    insert: <T extends AnyTable>(table: T): InsertStage1<T> => new InsertValuesBuilder<T>(executor, table._.name, table),

    /**
     * Start an UPDATE — call `.set(partial)` next.
     *
     * @example
     * db.update(users).set({ name: "Bob" }).where(eq(users.id, "u1")).execute()
     */
    update: <T extends AnyTable>(table: T): UpdateStage1<T> => new UpdateSetBuilder<T>(executor, table._.name, table),

    /**
     * Start a DELETE — call `.where(condition)` next.
     *
     * @example
     * db.delete(users).where(eq(users.id, "u1")).execute()
     */
    delete: <T extends AnyTable>(table: T) => new DeleteBuilder<T>(executor, table._.name, table),

    /**
     * Start a LEFT JOIN — call `.on(child)` next.
     *
     * @example
     * db.leftJoin(users).on(posts).execute()
     */
    leftJoin: <Parent extends AnyTable>(parent: Parent): JoinSelectStage1<Parent> => new JoinStage1(executor, parent, parent._.name, 'left'),

    /**
     * Start an INNER JOIN — call `.on(child)` next.
     *
     * @example
     * db.innerJoin(users).on(posts).execute()
     */
    innerJoin: <Parent extends AnyTable>(parent: Parent): JoinSelectStage1<Parent> => new JoinStage1(executor, parent, parent._.name, 'inner'),

    /**
     * Run multiple queries atomically in a single transaction.
     *
     * @example
     * db.batch([
     *   db.insert(users).values({ id: "u1", name: "Alice" }),
     *   db.insert(posts).values({ id: "p1", userId: "u1", title: "Hello" }),
     * ])
     */
    batch: (queries: Executable[]) => {
      const stmts = queries.map((q) => q.toSQL());
      return executor.transaction(async () => {
        for (const stmt of stmts) {
          await executor.run(stmt.sql, stmt.params);
        }
      });
    },

    /**
     * Count all rows in a table, optionally filtered by a condition.
     */
    count: <T extends AnyTable>(table: T, condition?: Condition) => count(executor, table, condition),

    /**
     * Count non-null values of a column, optionally filtered by a condition.
     */
    countColumn: <T extends AnyTable, C extends ColumnDef<any, any>>(table: T, column: C, condition?: Condition) =>
      countColumn(executor, table, column, condition),

    /**
     * Sum non-null values of a column, optionally filtered by a condition.
     */
    sum: <T extends AnyTable, C extends ColumnDef<any, any>>(table: T, column: C, condition?: Condition) => sum(executor, table, column, condition),

    /**
     * Average non-null values of a column, optionally filtered by a condition.
     */
    avg: <T extends AnyTable, C extends ColumnDef<any, any>>(table: T, column: C, condition?: Condition) => avg(executor, table, column, condition),

    /**
     * Find the minimum non-null value of a column, optionally filtered by a condition.
     */
    min: <T extends AnyTable, C extends ColumnDef<any, any>>(table: T, column: C, condition?: Condition) => min(executor, table, column, condition),

    /**
     * Find the maximum non-null value of a column, optionally filtered by a condition.
     */
    max: <T extends AnyTable, C extends ColumnDef<any, any>>(table: T, column: C, condition?: Condition) => max(executor, table, column, condition),

    /**
     * Execute raw SQL directly against the database.
     */
    $run(query: string, ...params: unknown[]) {
      return executor.run(query, params);
    },

    /** Direct access to the underlying executor. */
    $executor: executor,
  };
}

/**
 * Tagged template for building parameterized SQL expressions.
 *
 * @example
 * const expr = sql`name = ${"Alice"} AND age > ${18}`
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SQLExpression {
  let query = '';
  const params: unknown[] = [];
  for (let i = 0; i < strings.length; i++) {
    query += strings[i];
    if (i < values.length) {
      query += '?';
      params.push(values[i]);
    }
  }
  return { sql: query, params };
}
