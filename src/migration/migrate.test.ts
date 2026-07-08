// ---------------------------------------------------------------------------
// Tests for migration runner
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrate, getMigrationStatus } from "./migrate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_MIGRATIONS_DIR = join(import.meta.dir, "../../test-migrate-temp");

function cleanup() {
  if (existsSync(TEST_MIGRATIONS_DIR)) {
    rmSync(TEST_MIGRATIONS_DIR, { recursive: true });
  }
}

function createMigration(
  folderName: string,
  operations: Array<{ type: string; [key: string]: unknown }>,
): void {
  const dir = join(TEST_MIGRATIONS_DIR, folderName);
  mkdirSync(dir, { recursive: true });

  const content = `
import { defineMigration } from "flint-orm/migration";
import { ${operations.map((op) => op.type).join(", ")} } from "flint-orm/migration/operations";

export default defineMigration({
  name: "${folderName.replace(/^\d{10}_/, "")}",
  operations: [
${operations.map((op) => `    ${op.type}(${JSON.stringify(op).slice(1, -1)}),`).join("\n")}
  ],
});
`;
  writeFileSync(join(dir, "migration.ts"), content);
}

// Simple migration that creates a users table
function createUsersMigration(timestamp: number, name = "init_users") {
  const folderName = `${timestamp}_${name}`;
  const dir = join(TEST_MIGRATIONS_DIR, folderName);
  mkdirSync(dir, { recursive: true });

  // Use relative imports so dynamic import works in tests
  const content = `
import { defineMigration } from "../../src/migration/migration.js";
import { addTable } from "../../src/migration/operations.js";

export default defineMigration({
  name: "${name}",
  operations: [
    addTable({
      name: "users",
      columns: [
        { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
        { name: "name", sqlType: "text", isPrimaryKey: false, isNotNull: true, isUnique: false, hasDefault: false },
      ],
      indexes: [],
    }),
  ],
});
`;
  writeFileSync(join(dir, "migration.ts"), content);
  return folderName;
}

// Migration that adds an email column
function createEmailMigration(timestamp: number, name = "add_email") {
  const folderName = `${timestamp}_${name}`;
  const dir = join(TEST_MIGRATIONS_DIR, folderName);
  mkdirSync(dir, { recursive: true });

  const content = `
import { defineMigration } from "../../src/migration/migration.js";
import { addColumn } from "../../src/migration/operations.js";

export default defineMigration({
  name: "${name}",
  operations: [
    addColumn("users", {
      name: "email",
      sqlType: "text",
      isPrimaryKey: false,
      isNotNull: false,
      isUnique: false,
      hasDefault: false,
    }),
  ],
});
`;
  writeFileSync(join(dir, "migration.ts"), content);
  return folderName;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("migrate", () => {
  let db: Database;

  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_MIGRATIONS_DIR, { recursive: true });
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  test("applies pending migrations in order", async () => {
    createUsersMigration(1000000001, "init_users");
    createEmailMigration(1000000002, "add_email");

    const result = await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    expect(result.applied).toEqual(["1000000001_init_users", "1000000002_add_email"]);
    expect(result.skipped).toEqual([]);

    // Verify tables were created
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'").all() as { name: string }[];
    const tableNames = tables.map((t) => t.name).sort();
    expect(tableNames).toContain("users");
    expect(tableNames).toContain("__flint_migrations");
  });

  test("skips already-applied migrations", async () => {
    createUsersMigration(1000000001, "init_users");
    createEmailMigration(1000000002, "add_email");

    // Apply first migration
    await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    // Apply again — should skip both
    const result = await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(["1000000001_init_users", "1000000002_add_email"]);
  });

  test("applies only new migrations on second run", async () => {
    createUsersMigration(1000000001, "init_users");

    // First run
    await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    // Add second migration
    createEmailMigration(1000000002, "add_email");

    // Second run — should only apply add_email
    const result = await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    expect(result.applied).toEqual(["1000000002_add_email"]);
    expect(result.skipped).toEqual(["1000000001_init_users"]);
  });

  test("dry run returns pending without executing", async () => {
    createUsersMigration(1000000001, "init_users");
    createEmailMigration(1000000002, "add_email");

    const result = await migrate(db, {
      migrationsDir: TEST_MIGRATIONS_DIR,
      dryRun: true,
    });

    expect(result.applied).toEqual(["1000000001_init_users", "1000000002_add_email"]);
    expect(result.skipped).toEqual([]);

    // Verify no tables were created (except maybe sqlite_sequence)
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    expect(tables).toHaveLength(0);
  });

  test("records applied migrations in tracking table", async () => {
    createUsersMigration(1000000001, "init_users");

    await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    const rows = db.query("SELECT name, applied_at FROM __flint_migrations ORDER BY id").all() as {
      name: string;
      applied_at: number;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("1000000001_init_users");
    expect(typeof rows[0]!.applied_at).toBe("number");
    expect(rows[0]!.applied_at).toBeGreaterThan(0);
  });

  test("handles empty migrations directory", async () => {
    const result = await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  test("handles non-existent migrations directory", async () => {
    const result = await migrate(db, { migrationsDir: "/nonexistent/path" });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  test("migration SQL creates correct schema", async () => {
    createUsersMigration(1000000001, "init_users");

    await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    // Verify the users table schema
    const columns = db.query("PRAGMA table_info('users')").all() as { name: string; type: string }[];
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("name");
  });

  test("applies migrations in chronological order", async () => {
    // Create out of order — migration runner should sort by folder name
    createEmailMigration(1000000002, "add_email");
    createUsersMigration(1000000001, "init_users");

    const result = await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    // Should apply in chronological order despite creation order
    expect(result.applied).toEqual(["1000000001_init_users", "1000000002_add_email"]);
  });

  test("getMigrationStatus returns correct status", async () => {
    createUsersMigration(1000000001, "init_users");
    createEmailMigration(1000000002, "add_email");

    // Before any migrations
    let status = getMigrationStatus(db, TEST_MIGRATIONS_DIR);
    expect(status.applied).toEqual([]);
    expect(status.pending).toHaveLength(2);

    // Apply all pending migrations
    await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    status = getMigrationStatus(db, TEST_MIGRATIONS_DIR);
    expect(status.applied).toHaveLength(2);
    expect(status.pending).toHaveLength(0);
  });
});
