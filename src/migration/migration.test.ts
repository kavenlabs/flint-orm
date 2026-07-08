// ---------------------------------------------------------------------------
// Spike test: end-to-end migration generation
//
// Tests the full pipeline: serialize → diff → generate → SQL → state.json
// ---------------------------------------------------------------------------

import { test, expect, describe, afterEach, beforeAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { text, integer, boolean, real } from "../schema/columns.js";
import { table, index } from "../schema/table.js";
import type { SerializedTable } from "./types.js";
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

describe("topological sort", () => {
  // posts references users.id, comments references posts.id
  const posts = table("posts", {
    id: text("id").primaryKey(),
    userId: text("userId").notNull().references(users.id),
  });

  const comments = table("comments", {
    id: text("id").primaryKey(),
    postId: text("postId").notNull().references(posts.id),
  });

  test("addTable ops are topologically sorted (independent → dependent)", () => {
    // Define in reverse order: comments depends on posts, posts depends on users
    const curr = serializeSchema([comments, posts, users]);
    const prev = emptyState();

    const ops = diffSchemas(prev, curr);

    // All should be addTable
    expect(ops.every((op) => op.type === "addTable")).toBe(true);

    // Extract table names in order
    const tableNames = ops.map((op) => (op as any).table.name);

    // users must come before posts, posts must come before comments
    const usersIdx = tableNames.indexOf("users");
    const postsIdx = tableNames.indexOf("posts");
    const commentsIdx = tableNames.indexOf("comments");

    expect(usersIdx).toBeLessThan(postsIdx);
    expect(postsIdx).toBeLessThan(commentsIdx);
  });

  test("dropTable ops are in reverse topological order (dependent → independent)", () => {
    // All three tables exist previously, none in current
    const prev = serializeSchema([users, posts, comments]);
    const curr = emptyState();

    const ops = diffSchemas(prev, curr);

    // All should be dropTable
    expect(ops.every((op) => op.type === "dropTable")).toBe(true);

    // Extract table names in order
    const tableNames = ops.map((op) => (op as any).tableName);

    // comments must be dropped before posts, posts before users
    const usersIdx = tableNames.indexOf("users");
    const postsIdx = tableNames.indexOf("posts");
    const commentsIdx = tableNames.indexOf("comments");

    expect(commentsIdx).toBeLessThan(postsIdx);
    expect(postsIdx).toBeLessThan(usersIdx);
  });

  test("independent tables — order is stable", () => {
    const curr = serializeSchema([users, orders]);
    const prev = emptyState();

    const ops = diffSchemas(prev, curr);

    expect(ops).toHaveLength(2);
    expect(ops.every((op) => op.type === "addTable")).toBe(true);

    // Both tables should be present (order between independent tables is stable)
    const tableNames = ops.map((op) => (op as any).table.name);
    expect(tableNames).toContain("users");
    expect(tableNames).toContain("orders");
  });

  test("circular dependency throws error", () => {
    // Create tables with circular FK: a → b → a
    const tableA = table("a", {
      id: text("id").primaryKey(),
    });
    const tableB = table("b", {
      id: text("id").primaryKey(),
      aId: text("aId").references(tableA.id),
    });
    // Can't actually create circular FK with references() since it needs the target column
    // Instead, manually create a SerializedTable with circular refs
    const curr: import("./types.js").SchemaState = {
      version: 1,
      tables: {
        a: {
          name: "a",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false, referencesTable: "b", referencesColumn: "id" },
          ],
          indexes: [],
        },
        b: {
          name: "b",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false, referencesTable: "a", referencesColumn: "id" },
          ],
          indexes: [],
        },
      },
    };

    expect(() => diffSchemas(emptyState(), curr)).toThrow("Circular foreign key dependency");
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

    // Folder name matches pattern: timestamp_init_schema
    expect(result.folderName).toMatch(/^\d{10}_init_schema$/);
    expect(result.operations).toHaveLength(2);
    expect(result.sql).toContain("CREATE TABLE users");
    expect(result.sql).toContain("CREATE TABLE orders");

    // Verify folder was created
    const migrationDir = join(TEST_MIGRATIONS_DIR, result.folderName);
    expect(existsSync(migrationDir)).toBe(true);

    // Verify state.json was created
    const statePath = join(migrationDir, "state.json");
    expect(existsSync(statePath)).toBe(true);

    const state: SchemaState = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(Object.keys(state.tables)).toEqual(["users", "orders"]);
  });

  test("generates second migration with diff", () => {
    // First migration: create tables
    const first = generate([users, orders], TEST_MIGRATIONS_DIR, "init_schema");

    // Second migration: add email column to users
    const result = generate([usersV2, orders], TEST_MIGRATIONS_DIR, "add_user_email");

    // Folder name matches pattern: timestamp_add_user_email
    expect(result.folderName).toMatch(/^\d{10}_add_user_email$/);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.type).toBe("addColumn");
    expect(result.sql).toContain("ALTER TABLE users ADD COLUMN email TEXT");

    // Verify state.json reflects the new schema
    const statePath = join(TEST_MIGRATIONS_DIR, result.folderName, "state.json");
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

describe("index()", () => {
  test("table() callback attaches indexes", () => {
    const usersWithIdx = table("users", {
      id: text("id").primaryKey(),
      email: text("email"),
      name: text("name"),
    }, (t) => [
      index("idx_users_email").on(t.email).unique(),
    ]);

    const tableObj = usersWithIdx as Record<string, unknown>;
    expect(tableObj.__indexes).toBeDefined();
    expect((tableObj.__indexes as any[])).toHaveLength(1);
    expect((tableObj.__indexes as any[])[0]).toEqual({
      name: "idx_users_email",
      columns: ["email"],
      unique: true,
    });
  });

  test("table() callback with multiple indexes", () => {
    const usersWithIdx = table("users", {
      id: text("id").primaryKey(),
      email: text("email"),
      name: text("name"),
    }, (t) => [
      index("idx_users_email").on(t.email).unique(),
      index("idx_users_name").on(t.name),
    ]);

    const tableObj = usersWithIdx as Record<string, unknown>;
    expect((tableObj.__indexes as any[])).toHaveLength(2);
    expect((tableObj.__indexes as any[])[0]!.name).toBe("idx_users_email");
    expect((tableObj.__indexes as any[])[1]!.name).toBe("idx_users_name");
  });

  test("table() without callback has no indexes", () => {
    const tableObj = users as Record<string, unknown>;
    expect(tableObj.__indexes).toBeUndefined();
  });

  test("serializeSchema picks up callback indexes", () => {
    const usersWithIdx = table("users", {
      id: text("id").primaryKey(),
      email: text("email"),
    }, (t) => [
      index("idx_users_email").on(t.email).unique(),
    ]);

    const state = serializeSchema([usersWithIdx]);
    const usersTable = state.tables["users"]!;

    expect(usersTable.indexes).toHaveLength(1);
    expect(usersTable.indexes[0]).toEqual({
      name: "idx_users_email",
      columns: ["email"],
      unique: true,
    });
  });

  test("diffSchemas detects new indexes", () => {
    const withoutIdx = table("users", {
      id: text("id").primaryKey(),
      email: text("email"),
    });

    const withIdx = table("users", {
      id: text("id").primaryKey(),
      email: text("email"),
    }, (t) => [
      index("idx_users_email").on(t.email).unique(),
    ]);

    const prev = serializeSchema([withoutIdx]);
    const curr = serializeSchema([withIdx]);

    const ops = diffSchemas(prev, curr);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("createIndex");
    expect((ops[0] as any).index.name).toBe("idx_users_email");
  });

  test("generate produces CREATE INDEX SQL", () => {
    const usersWithIdx = table("users", {
      id: text("id").primaryKey(),
      email: text("email"),
    }, (t) => [
      index("idx_users_email").on(t.email).unique(),
    ]);

    const result = generate([usersWithIdx], TEST_MIGRATIONS_DIR, "with_index");

    expect(result.sql).toContain("CREATE UNIQUE INDEX idx_users_email ON users (email)");
  });
});
