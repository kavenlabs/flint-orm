// ---------------------------------------------------------------------------
// Tests for SQLite introspection
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { introspect } from "./introspect.js";
import type { SchemaState } from "../migration/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("introspect", () => {
  test("returns empty state for database with no tables", () => {
    const state = introspect(db);

    expect(state.version).toBe(1);
    expect(Object.keys(state.tables)).toEqual([]);
  });

  test("reads a simple table with various column types", () => {
    db.run(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        age INTEGER,
        score REAL,
        avatar BLOB
      )
    `);

    const state = introspect(db);

    expect(Object.keys(state.tables)).toEqual(["users"]);

    const users = state.tables["users"]!;
    expect(users.columns).toHaveLength(5);

    // Check column types
    const id = users.columns.find((c) => c.name === "id")!;
    expect(id.sqlType).toBe("text");
    expect(id.isPrimaryKey).toBe(true);

    const name = users.columns.find((c) => c.name === "name")!;
    expect(name.sqlType).toBe("text");
    expect(name.isNotNull).toBe(true);

    const age = users.columns.find((c) => c.name === "age")!;
    expect(age.sqlType).toBe("integer");

    const score = users.columns.find((c) => c.name === "score")!;
    expect(score.sqlType).toBe("real");

    const avatar = users.columns.find((c) => c.name === "avatar")!;
    expect(avatar.sqlType).toBe("blob");
  });

  test("reads columns with default values", () => {
    db.run(`
      CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT DEFAULT 'active',
        count INTEGER DEFAULT 0,
        ratio REAL DEFAULT 1.0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const state = introspect(db);
    const items = state.tables["items"]!;

    const status = items.columns.find((c) => c.name === "status")!;
    expect(status.hasDefault).toBe(true);
    expect(status.defaultValue).toBe("active");

    const count = items.columns.find((c) => c.name === "count")!;
    expect(count.hasDefault).toBe(true);
    expect(count.defaultValue).toBe(0);

    const ratio = items.columns.find((c) => c.name === "ratio")!;
    expect(ratio.hasDefault).toBe(true);
    expect(ratio.defaultValue).toBe(1.0);

    const created_at = items.columns.find((c) => c.name === "created_at")!;
    expect(created_at.hasDefault).toBe(true);
    // CURRENT_TIMESTAMP is stored as a SQL expression
    expect(typeof created_at.defaultValue).toBe("string");
  });

  test("reads foreign key references", () => {
    db.run(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE posts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    const state = introspect(db);
    const posts = state.tables["posts"]!;

    const userId = posts.columns.find((c) => c.name === "user_id")!;
    expect(userId.referencesTable).toBe("users");
    expect(userId.referencesColumn).toBe("id");
  });

  test("reads user-created indexes", () => {
    db.run(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT
      )
    `);
    db.run(`CREATE UNIQUE INDEX idx_users_email ON users(email)`);
    db.run(`CREATE INDEX idx_users_name ON users(name)`);

    const state = introspect(db);
    const users = state.tables["users"]!;

    expect(users.indexes).toHaveLength(2);

    const emailIdx = users.indexes.find((i) => i.name === "idx_users_email")!;
    expect(emailIdx.unique).toBe(true);
    expect(emailIdx.columns).toEqual(["email"]);

    const nameIdx = users.indexes.find((i) => i.name === "idx_users_name")!;
    expect(nameIdx.unique).toBe(false);
    expect(nameIdx.columns).toEqual(["name"]);
  });

  test("skips primary key and unique constraint auto-indexes", () => {
    db.run(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL
      )
    `);

    const state = introspect(db);
    const users = state.tables["users"]!;

    // Auto-generated indexes for PK and UNIQUE constraint should be skipped
    expect(users.indexes).toHaveLength(0);

    // But the columns should have the right flags
    const id = users.columns.find((c) => c.name === "id")!;
    expect(id.isPrimaryKey).toBe(true);

    const email = users.columns.find((c) => c.name === "email")!;
    // UNIQUE constraint creates an auto-index which we skip.
    // isUnique is only detected from explicit CREATE UNIQUE INDEX,
    // not from column-level UNIQUE constraint. This is a known limitation.
    expect(email.isUnique).toBe(false);
  });

  test("reads multiple tables", () => {
    db.run(`CREATE TABLE a (id INTEGER PRIMARY KEY, name TEXT)`);
    db.run(`CREATE TABLE b (id INTEGER PRIMARY KEY, value REAL)`);
    db.run(`CREATE TABLE c (id INTEGER PRIMARY KEY, flag BOOLEAN)`);

    const state = introspect(db);

    expect(Object.keys(state.tables).sort()).toEqual(["a", "b", "c"]);
  });

  test("excludes __flint_migrations table", () => {
    db.run(`
      CREATE TABLE __flint_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      )
    `);
    db.run(`CREATE TABLE users (id TEXT PRIMARY KEY)`);

    const state = introspect(db);

    expect(Object.keys(state.tables)).toEqual(["users"]);
    expect(state.tables["__flint_migrations"]).toBeUndefined();
  });

  test("excludes sqlite internal tables", () => {
    db.run(`CREATE TABLE users (id TEXT PRIMARY KEY)`);

    const state = introspect(db);

    // sqlite_sequence and other internal tables should not appear
    for (const name of Object.keys(state.tables)) {
      expect(name.startsWith("sqlite_")).toBe(false);
    }
  });

  test("handles column type variations", () => {
    db.run(`
      CREATE TABLE type_test (
        c1 VARCHAR(255),
        c2 CHAR(10),
        c3 INT,
        c4 BIGINT,
        c5 FLOAT,
        c6 DOUBLE,
        c7 NUMERIC,
        c8 BOOLEAN,
        c9 CLOB
      )
    `);

    const state = introspect(db);
    const cols = state.tables["type_test"]!.columns;

    expect(cols.find((c) => c.name === "c1")!.sqlType).toBe("text");
    expect(cols.find((c) => c.name === "c2")!.sqlType).toBe("text");
    expect(cols.find((c) => c.name === "c3")!.sqlType).toBe("integer");
    expect(cols.find((c) => c.name === "c4")!.sqlType).toBe("integer");
    expect(cols.find((c) => c.name === "c5")!.sqlType).toBe("real");
    expect(cols.find((c) => c.name === "c6")!.sqlType).toBe("real");
    expect(cols.find((c) => c.name === "c7")!.sqlType).toBe("text"); // NUMERIC → text
    expect(cols.find((c) => c.name === "c8")!.sqlType).toBe("text"); // BOOLEAN → text
    expect(cols.find((c) => c.name === "c9")!.sqlType).toBe("text");
  });

  test("handles composite indexes", () => {
    db.run(`
      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    db.run(`CREATE INDEX idx_orders_user_status ON orders(user_id, status)`);

    const state = introspect(db);
    const orders = state.tables["orders"]!;

    expect(orders.indexes).toHaveLength(1);
    expect(orders.indexes[0]!.columns).toEqual(["user_id", "status"]);
  });
});
