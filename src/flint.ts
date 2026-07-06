// flint() factory
import { Database, type SQLQueryBindings } from "bun:sqlite";
import {
  SelectFromBuilder,
  InsertValuesBuilder,
  UpdateSetBuilder,
  DeleteBuilder,
  JoinStage1,
} from "./query/builder";
import type { Executable, SelectStage1, InsertStage1, UpdateStage1, JoinSelectStage1 } from "./query/builder";
import { count, countColumn, sum, avg, min, max } from "./query/aggregates";
import type { AnyTable } from "./schema/table";
import type { Condition } from "./query/conditions";
import type { ColumnDef } from "./schema/columns";

// Re-export Executable so consumers can type their own batch helpers.
export type { Executable, SelectStage1, InsertStage1, UpdateStage1, JoinSelectStage1, JoinBuilder, SingleJoinBuilder } from "./query/builder";
export type { JoinResult } from "./query/builder";

// Connection details
export interface ConnectionDetails {
  /** Connection details for the SQLite database. */
  url: string;
}

/**
 * Create a flint database client.
 *
 * @example
 * const db = flint({ url: "app.db" });
 */
export function flint(details: ConnectionDetails) {
  // For now, only bun:sqlite. Future: libsql support.
  const client = new Database(details.url);

  return {
    /**
     * Start a SELECT query — call `.from(table)` next.
     *
     * @example
     * const rows = db.select().from(users).execute()
     */
    select: (): SelectStage1 => new SelectFromBuilder(client),

    /**
     * Start an INSERT — call `.values(row)` next.
     *
     * @example
     * db.insert(users).values({ id: "u1", name: "Alice" }).execute()
     */
    insert: <T extends AnyTable>(table: T): InsertStage1<T> =>
      new InsertValuesBuilder<T>(client, table._.name, table),

    /**
     * Start an UPDATE — call `.set(partial)` next.
     *
     * @example
     * db.update(users).set({ name: "Bob" }).where(eq(users.id, "u1")).execute()
     */
    update: <T extends AnyTable>(table: T): UpdateStage1<T> =>
      new UpdateSetBuilder<T>(client, table._.name, table),

    /**
     * Start a DELETE — call `.where(condition)` next.
     *
     * @example
     * db.delete(users).where(eq(users.id, "u1")).execute()
     */
    delete: <T extends AnyTable>(table: T) =>
      new DeleteBuilder<T>(client, table._.name, table),

    /**
     * Start a LEFT JOIN — call `.on(child)` next.
     *
     * @example
     * db.leftJoin(users).on(posts).execute()
     */
    leftJoin: <Parent extends AnyTable>(parent: Parent): JoinSelectStage1<Parent> =>
      new JoinStage1(client, parent, parent._.name, "left"),

    /**
     * Start an INNER JOIN — call `.on(child)` next.
     *
     * @example
     * db.innerJoin(users).on(posts).execute()
     */
    innerJoin: <Parent extends AnyTable>(parent: Parent): JoinSelectStage1<Parent> =>
      new JoinStage1(client, parent, parent._.name, "inner"),

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
      const tx = client.transaction(() => {
        for (const { sql, params } of stmts) {
          client.prepare(sql).run(...(params as SQLQueryBindings[]));
        }
      });
      tx();
    },

    /**
     * Count all rows in a table, optionally filtered by a condition.
     *
     * @example
     * db.count(users)
     */
    count: <T extends AnyTable>(table: T, condition?: Condition) =>
      count(client, table, condition),

    /**
     * Count non-null values of a column, optionally filtered by a condition.
     *
     * @example
     * db.countColumn(users, users.email)
     */
    countColumn: <T extends AnyTable, C extends ColumnDef<any, any>>(table: T, column: C, condition?: Condition) =>
      countColumn(client, table, column, condition),

    /**
     * Sum non-null values of a column, optionally filtered by a condition.
     *
     * @example
     * db.sum(orders, orders.amount)
     */
    sum: <T extends AnyTable, C extends ColumnDef<any, any>>(table: T, column: C, condition?: Condition) =>
      sum(client, table, column, condition),

    /**
     * Average non-null values of a column, optionally filtered by a condition.
     *
     * @example
     * db.avg(users, users.age)
     */
    avg: <T extends AnyTable, C extends ColumnDef<any, any>>(table: T, column: C, condition?: Condition) =>
      avg(client, table, column, condition),

    /**
     * Find the minimum non-null value of a column, optionally filtered by a condition.
     *
     * @example
     * db.min(users, users.age)
     */
    min: <T extends AnyTable, C extends ColumnDef<any, any>>(table: T, column: C, condition?: Condition) =>
      min(client, table, column, condition),

    /**
     * Find the maximum non-null value of a column, optionally filtered by a condition.
     *
     * @example
     * db.max(users, users.age)
     */
    max: <T extends AnyTable, C extends ColumnDef<any, any>>(table: T, column: C, condition?: Condition) =>
      max(client, table, column, condition),

    /**
     * Execute raw SQL directly and return all matching rows.
     *
     * @example
     * db.raw("SELECT * FROM users WHERE id = ?", ["u1"])
     */
    raw: <T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] => {
      return client.prepare(sql).all(...((params ?? []) as SQLQueryBindings[])) as T[];
    },

    /** Direct access to the underlying `bun:sqlite` client. */
    $client: client,
  };
}

/** A raw SQL expression with parameters. */
export interface SQLExpression {
  sql: string;
  params: unknown[];
}

/**
 * Tagged template for building parameterized SQL expressions.
 *
 * @example
 * const expr = sql`name = ${"Alice"} AND age > ${18}`
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SQLExpression {
  let sql = "";
  const params: unknown[] = [];
  for (let i = 0; i < strings.length; i++) {
    sql += strings[i];
    if (i < values.length) {
      sql += "?";
      params.push(values[i]);
    }
  }
  return { sql, params };
}
