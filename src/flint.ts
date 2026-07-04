// ---------------------------------------------------------------------------
// flint() — factory function that returns a plain db object.
// No classes, no `new`. Just a function call.
// ---------------------------------------------------------------------------

import { Database } from "bun:sqlite";
import { SelectBuilder, InsertBuilder, UpdateBuilder, DeleteBuilder } from "./query/builder";
import type { TableDef } from "./schema/table";

// ---------------------------------------------------------------------------
// Connection details
// ---------------------------------------------------------------------------

export interface ConnectionDetails {
  /** SQLite filename (e.g. "app.db") or file: URL */
  url: string;
}

// ---------------------------------------------------------------------------
// flint() factory
// ---------------------------------------------------------------------------

export function flint(details: ConnectionDetails) {
  // For now, only bun:sqlite. Future: libsql support.
  const client = new Database(details.url);

  return {
    /** Start a SELECT query — call .from(table) next. */
    select: () => new SelectBuilder(client, "", null as any),

    /** Start an INSERT — call .values(row) next. */
    insert: <T extends TableDef<any>>(table: T) => new InsertBuilder<T>(client, (table as any)._.name, table),

    /** Start an UPDATE — call .set(partial) next. */
    update: <T extends TableDef<any>>(table: T) => new UpdateBuilder<T>(client, (table as any)._.name, table),

    /** Start a DELETE — call .where(condition) next. */
    delete: <T extends TableDef<any>>(table: T) => new DeleteBuilder<T>(client, (table as any)._.name, table),

    /** Run multiple queries in a transaction. */
    batch: (queries: (() => void)[]) => {
      const tx = client.transaction(() => {
        for (const query of queries) query();
      });
      tx();
    },

    /** Direct access to the underlying client (escape hatch). */
    $client: client,
  };
}

// ---------------------------------------------------------------------------
// sql tagged template — raw SQL expressions (basic implementation)
// ---------------------------------------------------------------------------

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
