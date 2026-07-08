import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrate, getMigrationStatus } from "../../src/migration/migrate.js";

const TEST_MIGRATIONS_DIR = join(import.meta.dir, "../../test-migrate-temp");

function cleanup() {
  if (existsSync(TEST_MIGRATIONS_DIR)) {
    rmSync(TEST_MIGRATIONS_DIR, { recursive: true });
  }
}

function createMigration(timestamp: number, name: string, content: string) {
  const folderName = `${timestamp}_${name}`;
  const dir = join(TEST_MIGRATIONS_DIR, folderName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "migration.ts"), content);
  return folderName;
}

function createUsersMigration(timestamp: number) {
  return createMigration(
    timestamp,
    "init_users",
    `
import { defineMigration } from "../../src/migration/migration.js";
import { addTable } from "../../src/migration/operations.js";

export default defineMigration({
  name: "init_users",
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
`
  );
}

function createEmailMigration(timestamp: number) {
  return createMigration(
    timestamp,
    "add_email",
    `
import { defineMigration } from "../../src/migration/migration.js";
import { addColumn } from "../../src/migration/operations.js";

export default defineMigration({
  name: "add_email",
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
`
  );
}

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
    createUsersMigration(1000000001);
    createEmailMigration(1000000002);

    const result = await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    expect(result.applied).toEqual(["1000000001_init_users", "1000000002_add_email"]);
    expect(result.skipped).toEqual([]);
  });

  test("skips already-applied migrations", async () => {
    createUsersMigration(1000000001);
    createEmailMigration(1000000002);

    await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    const result = await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(["1000000001_init_users", "1000000002_add_email"]);
  });

  test("applies only new migrations on second run", async () => {
    createUsersMigration(1000000001);

    await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    createEmailMigration(1000000002);

    const result = await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    expect(result.applied).toEqual(["1000000002_add_email"]);
    expect(result.skipped).toEqual(["1000000001_init_users"]);
  });

  test("dry run returns pending without executing", async () => {
    createUsersMigration(1000000001);
    createEmailMigration(1000000002);

    const result = await migrate(db, {
      migrationsDir: TEST_MIGRATIONS_DIR,
      dryRun: true,
    });

    expect(result.applied).toEqual(["1000000001_init_users", "1000000002_add_email"]);
    expect(result.skipped).toEqual([]);

    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    expect(tables).toHaveLength(0);
  });

  test("records applied migrations in tracking table", async () => {
    createUsersMigration(1000000001);

    await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    const rows = db.query("SELECT name, applied_at FROM __flint_migrations ORDER BY id").all() as {
      name: string;
      applied_at: number;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("1000000001_init_users");
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
    createUsersMigration(1000000001);

    await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    const columns = db.query("PRAGMA table_info('users')").all() as { name: string; type: string }[];
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("name");
  });

  test("applies migrations in chronological order", async () => {
    createEmailMigration(1000000002);
    createUsersMigration(1000000001);

    const result = await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    expect(result.applied).toEqual(["1000000001_init_users", "1000000002_add_email"]);
  });
});

describe("getMigrationStatus", () => {
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

  test("returns empty status before any migrations", () => {
    createUsersMigration(1000000001);

    const status = getMigrationStatus(db, TEST_MIGRATIONS_DIR);

    expect(status.applied).toEqual([]);
    expect(status.pending).toHaveLength(1);
  });

  test("returns correct status after migrations", async () => {
    createUsersMigration(1000000001);
    createEmailMigration(1000000002);

    await migrate(db, { migrationsDir: TEST_MIGRATIONS_DIR });

    const status = getMigrationStatus(db, TEST_MIGRATIONS_DIR);

    expect(status.applied).toHaveLength(2);
    expect(status.pending).toHaveLength(0);
  });
});
