// -----------------------------------------------------------------------
// flint() — factory function that returns a plain db object.
// No classes, no `new`. Just a function call.
// -----------------------------------------------------------------------

import { Database } from "bun:sqlite";
import {
  SelectFromBuilder,
  InsertValuesBuilder,
  UpdateSetBuilder,
  DeleteBuilder,
  JoinStage1,
} from "./query/builder";
import type { Executable, SelectStage1, InsertStage1, UpdateStage1, JoinSelectStage1 } from "./query/builder";
import type { TableDef } from "./schema/table";

// Re-export Executable so consumers can type their own batch helpers.
export type { Executable, SelectStage1, InsertStage1, UpdateStage1, JoinSelectStage1, JoinBuilder, SingleJoinBuilder } from "./query/builder";
export type { JoinResult } from "./query/builder";

// -----------------------------------------------------------------------
// Connection details
// -----------------------------------------------------------------------

export interface ConnectionDetails {
  /** SQLite filename (e.g. "app.db") or file: URL */
  url: string;
}

// -----------------------------------------------------------------------
// flint() factory
// -----------------------------------------------------------------------

export function flint(details: ConnectionDetails) {
  // For now, only bun:sqlite. Future: libsql support.
  const client = new Database(details.url);

  return {
    /**
     * Start a SELECT query — call .from(table) next.
     * Returns SelectStage1: only .from() is available until a table is supplied.
     */
    select: (): SelectStage1 => new SelectFromBuilder(client),

    /** Start an INSERT — call .values(row) next. */
    insert: <T extends TableDef<any>>(table: T): InsertStage1<T> =>
      new InsertValuesBuilder<T>(client, (table as any)._.name, table),

    /** Start an UPDATE — call .set(partial) next. */
    update: <T extends TableDef<any>>(table: T): UpdateStage1<T> =>
      new UpdateSetBuilder<T>(client, (table as any)._.name, table),

    /** Start a DELETE — call .where(condition) next. */
    delete: <T extends TableDef<any>>(table: T) =>
      new DeleteBuilder<T>(client, (table as any)._.name, table),

    /**
     * LEFT JOIN — call .on(condition) next.
     * Returns rows from the left table, with matching right table data
     * (or null values if no match). One-to-many produces nested arrays.
     */
    leftJoin: <Parent extends TableDef<any>>(parent: Parent): JoinSelectStage1<Parent> =>
      new JoinStage1(client, parent, (parent as any)._.name, "left"),

    /**
     * INNER JOIN — call .on(condition) next.
     * Returns only rows where both tables have matching data.
     * One-to-many produces nested arrays.
     */
    innerJoin: <Parent extends TableDef<any>>(parent: Parent): JoinSelectStage1<Parent> =>
      new JoinStage1(client, parent, (parent as any)._.name, "inner"),

    /**
     * Run multiple queries atomically in a single transaction.
     * Each query must be an Executable (anything with a .toSQL() method).
     * .toSQL() is called internally — callers don't need to wrap anything.
     *
     * Current impl: bun:sqlite's transaction(). Future: libsql's native batch().
     */
    batch: (queries: Executable[]) => {
      const stmts = queries.map((q) => q.toSQL());
      const tx = client.transaction(() => {
        for (const { sql, params } of stmts) {
          client.prepare(sql).run(...(params as any));
        }
      });
      tx();
    },

    /** Direct access to the underlying client (escape hatch). */
    $client: client,
  };
}

// -----------------------------------------------------------------------
// sql tagged template — raw SQL expressions (basic implementation)
// -----------------------------------------------------------------------

export interface SQLExpression {
  sql: string;
  params: unknown[];
}

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
