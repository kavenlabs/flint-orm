// ---------------------------------------------------------------------------
// Spike test: end-to-end migration generation
//
// Tests the full pipeline: serialize → diff → generate → SQL → state.json
// ---------------------------------------------------------------------------

import { test, expect, describe, afterEach, beforeAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { text, integer, boolean, real } from "../schema/columns.js";
import { table } from "../schema/table.js";
import { serializeSchema } from "./serialize.js";
import { diffSchemas, emptyState } from "./diff.js";
import { generateSQL } from "./sql.js";
import { generate } from "./generate.js";
import type { SchemaState } from "./types.js";

// ── Test tables ────────────────────────────────────────────────────────────

const users = table("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull(),
});

const orders = table("orders", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  total: integer("total").notNull(),
});

// Tables with a new column (simulates schema evolution)
const usersV2 = table("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull(),
  email: text("email"),
});

// ── Helpers ────────────────────────────────────────────────────────────────

const TEST_MIGRATIONS_DIR = join(import.meta.dir, "../../test-migrations");

function cleanup() {
  if (existsSync(TEST_MIGRATIONS_DIR)) {
    rmSync(TEST_MIGRATIONS_DIR, { recursive: true });
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("serialize", () => {
  test("serializes a single table correctly", () => {
    const state = serializeSchema([users]);

    expect(state.version).toBe(1);
    expect(Object.keys(state.tables)).toEqual(["users"]);

    const usersTable = state.tables["users"]!;
    expect(usersTable.columns).toHaveLength(3);

    const idCol = usersTable.columns.find((c) => c.name === "id")!;
    expect(idCol.sqlType).toBe("text");
    expect(idCol.isPrimaryKey).toBe(true);
    expect(idCol.isNotNull).toBe(false);

    const nameCol = usersTable.columns.find((c) => c.name === "name")!;
    expect(nameCol.isNotNull).toBe(true);
  });

  test("serializes multiple tables", () => {
    const state = serializeSchema([users, orders]);

    expect(Object.keys(state.tables)).toEqual(["users", "orders"]);
    expect(state.tables["users"]!.columns).toHaveLength(3);
    expect(state.tables["orders"]!.columns).toHaveLength(3);
  });
});

describe("diff", () => {
  test("detects new tables", () => {
    const prev = emptyState();
    const curr = serializeSchema([users]);

    const ops = diffSchemas(prev, curr);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("addTable");
    expect((ops[0] as any).table.name).toBe("users");
  });

  test("detects dropped tables", () => {
    const prev = serializeSchema([users, orders]);
    const curr = serializeSchema([users]);

    const ops = diffSchemas(prev, curr);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("dropTable");
    expect((ops[0] as any).tableName).toBe("orders");
  });

  test("detects new columns", () => {
    const prev = serializeSchema([users]);
    const curr = serializeSchema([usersV2]);

    const ops = diffSchemas(prev, curr);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("addColumn");
    expect((ops[0] as any).tableName).toBe("users");
    expect((ops[0] as any).column.name).toBe("email");
  });

  test("detects no changes", () => {
    const prev = serializeSchema([users]);
    const curr = serializeSchema([users]);

    const ops = diffSchemas(prev, curr);

    expect(ops).toHaveLength(0);
  });

  test("detects multiple changes", () => {
    const prev = serializeSchema([users]);
    const curr = serializeSchema([usersV2, orders]);

    const ops = diffSchemas(prev, curr);

    // Should detect: addColumn to users, addTable orders
    expect(ops.length).toBeGreaterThanOrEqual(2);
    const types = ops.map((op) => op.type);
    expect(types).toContain("addColumn");
    expect(types).toContain("addTable");
  });
});

describe("sql generation", () => {
  test("generates CREATE TABLE for addTable", () => {
    const prev = emptyState();
    const curr = serializeSchema([users]);
    const ops = diffSchemas(prev, curr);
    const sql = generateSQL(ops);

    expect(sql).toContain("CREATE TABLE users");
    expect(sql).toContain("id TEXT PRIMARY KEY");
    expect(sql).toContain("name TEXT NOT NULL");
    expect(sql).toContain("active INTEGER NOT NULL");
  });

  test("generates ALTER TABLE ADD COLUMN", () => {
    const prev = serializeSchema([users]);
    const curr = serializeSchema([usersV2]);
    const ops = diffSchemas(prev, curr);
    const sql = generateSQL(ops);

    expect(sql).toContain("ALTER TABLE users ADD COLUMN email TEXT");
  });

  test("generates DROP TABLE", () => {
    const prev = serializeSchema([users, orders]);
    const curr = serializeSchema([users]);
    const ops = diffSchemas(prev, curr);
    const sql = generateSQL(ops);

    expect(sql).toContain("DROP TABLE orders");
  });
});

describe("generate (end-to-end)", () => {
  beforeAll(() => {
    cleanup();
    mkdirSync(TEST_MIGRATIONS_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
    mkdirSync(TEST_MIGRATIONS_DIR, { recursive: true });
  });

  test("generates first migration from empty state", () => {
    const result = generate([users, orders], TEST_MIGRATIONS_DIR, "init_schema");

    expect(result.sequence).toBe(1);
    expect(result.folderName).toBe("001_init_schema");
    expect(result.operations).toHaveLength(2);
    expect(result.sql).toContain("CREATE TABLE users");
    expect(result.sql).toContain("CREATE TABLE orders");

    // Verify folder was created
    const migrationDir = join(TEST_MIGRATIONS_DIR, "001_init_schema");
    expect(existsSync(migrationDir)).toBe(true);

    // Verify state.json was created
    const statePath = join(migrationDir, "state.json");
    expect(existsSync(statePath)).toBe(true);

    const state: SchemaState = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(Object.keys(state.tables)).toEqual(["users", "orders"]);
  });

  test("generates second migration with diff", () => {
    // First migration: create tables
    generate([users, orders], TEST_MIGRATIONS_DIR, "init_schema");

    // Second migration: add email column to users
    const result = generate([usersV2, orders], TEST_MIGRATIONS_DIR, "add_user_email");

    expect(result.sequence).toBe(2);
    expect(result.folderName).toBe("002_add_user_email");
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.type).toBe("addColumn");
    expect(result.sql).toContain("ALTER TABLE users ADD COLUMN email TEXT");

    // Verify state.json reflects the new schema
    const statePath = join(TEST_MIGRATIONS_DIR, "002_add_user_email", "state.json");
    const state: SchemaState = JSON.parse(readFileSync(statePath, "utf-8"));
    const usersCols = state.tables["users"]!.columns;
    expect(usersCols.map((c) => c.name)).toContain("email");
  });

  test("throws when no changes detected", () => {
    generate([users], TEST_MIGRATIONS_DIR, "init_schema");

    expect(() => {
      generate([users], TEST_MIGRATIONS_DIR, "no_changes");
    }).toThrow("No changes detected");
  });
});
