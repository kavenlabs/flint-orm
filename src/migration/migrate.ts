// ---------------------------------------------------------------------------
// Migration runner — applies pending migrations to a database, tracking
// what's been applied in a __flint_migrations table.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { MigrationFile } from "./types.js";
import { generateSQL } from "./sql.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrateOptions {
  /** Path to the migrations directory. */
  migrationsDir: string;
  /** Dry run — show what would be applied without executing. */
  dryRun?: boolean;
}

export interface MigrateResult {
  /** Names of migrations that were applied. */
  applied: string[];
  /** Names of migrations that were skipped (already applied). */
  skipped: string[];
}

// ---------------------------------------------------------------------------
// Migration tracking table
// ---------------------------------------------------------------------------

const TRACKING_TABLE = "__flint_migrations";

function ensureTrackingTable(client: Database): void {
  client.run(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);
}

function getAppliedMigrations(client: Database): Set<string> {
  const rows = client.query(`SELECT name FROM ${TRACKING_TABLE} ORDER BY id`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function recordMigration(client: Database, name: string): void {
  client.prepare(`INSERT INTO ${TRACKING_TABLE} (name, applied_at) VALUES (?, ?)`).run(name, Date.now());
}

// ---------------------------------------------------------------------------
// Migration file discovery and loading
// ---------------------------------------------------------------------------

interface MigrationEntry {
  /** Folder name (e.g., "1234567890_init_schema") */
  folderName: string;
  /** Migration name (e.g., "init_schema") */
  name: string;
  /** Absolute path to the migration folder */
  path: string;
}

function discoverMigrations(migrationsDir: string): MigrationEntry[] {
  if (!existsSync(migrationsDir)) return [];

  const entries = readdirSync(migrationsDir);
  const migrationFolders = entries
    .filter((e) => /^\d{10}_/.test(e))
    .sort(); // Chronological order

  return migrationFolders.map((folder) => {
    // Extract name: everything after the timestamp prefix
    const name = folder.replace(/^\d{10}_/, "");
    return {
      folderName: folder,
      name,
      path: join(migrationsDir, folder),
    };
  });
}

async function loadMigration(entry: MigrationEntry): Promise<MigrationFile> {
  const migrationPath = join(entry.path, "migration.ts");
  if (!existsSync(migrationPath)) {
    throw new Error(`Migration file not found: ${migrationPath}`);
  }

  const url = pathToFileURL(migrationPath).href;
  const mod = await import(url);
  const migration = mod.default as MigrationFile;

  if (!migration || !migration.operations || !Array.isArray(migration.operations)) {
    throw new Error(`Invalid migration file: ${migrationPath}`);
  }

  return migration;
}

// ---------------------------------------------------------------------------
// Public: apply pending migrations
// ---------------------------------------------------------------------------

/**
 * Apply pending migrations to a database.
 *
 * Reads the migrations directory, filters out already-applied migrations,
 * and applies the remaining ones in order within transactions.
 *
 * @param client - The bun:sqlite Database instance
 * @param options - Migration options
 * @returns Result with applied and skipped migration names
 *
 * @example
 * import { Database } from "bun:sqlite";
 * import { migrate } from "flint-orm/migration";
 *
 * const client = new Database("app.db");
 * const result = migrate(client, { migrationsDir: "./flint" });
 * console.log(`Applied: ${result.applied.join(", ")}`);
 */
export async function migrate(
  client: Database,
  options: MigrateOptions,
): Promise<MigrateResult> {
  const { migrationsDir, dryRun = false } = options;

  // Ensure tracking table exists (skip for dry runs)
  if (!dryRun) {
    ensureTrackingTable(client);
  }

  // Get already-applied migrations
  const applied = dryRun ? new Set<string>() : getAppliedMigrations(client);

  // Discover all migration folders
  const allMigrations = discoverMigrations(migrationsDir);

  // Filter to pending only (use folderName for consistent tracking)
  const pending = allMigrations.filter((m) => !applied.has(m.folderName));

  if (pending.length === 0) {
    return { applied: [], skipped: allMigrations.map((m) => m.folderName) };
  }

  if (dryRun) {
    return {
      applied: pending.map((m) => m.folderName),
      skipped: allMigrations.filter((m) => applied.has(m.folderName)).map((m) => m.folderName),
    };
  }

  // Load and apply each pending migration
  const newlyApplied: string[] = [];

  for (const entry of pending) {
    const migration = await loadMigration(entry);
    const sql = generateSQL(migration.operations);

    // Split SQL by semicolons and execute each statement
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Execute in a transaction (use folderName for consistent tracking)
    const tx = client.transaction(() => {
      for (const stmt of statements) {
        client.run(stmt);
      }
      recordMigration(client, entry.folderName);
    });

    tx();
    newlyApplied.push(entry.folderName);
  }

  return {
    applied: newlyApplied,
    skipped: allMigrations.filter((m) => applied.has(m.folderName)).map((m) => m.folderName),
  };
}

// ---------------------------------------------------------------------------
// Public: get migration status (applied vs pending)
// ---------------------------------------------------------------------------

export interface MigrationStatus {
  /** Applied migration names with their timestamps. */
  applied: { name: string; folderName: string }[];
  /** Pending migration names. */
  pending: { name: string; folderName: string }[];
}

/**
 * Get the status of migrations — which are applied and which are pending.
 *
 * @param client - The bun:sqlite Database instance
 * @param migrationsDir - Path to the migrations directory
 * @returns Status object with applied and pending migrations
 */
export function getMigrationStatus(
  client: Database,
  migrationsDir: string,
): MigrationStatus {
  ensureTrackingTable(client);
  const appliedNames = getAppliedMigrations(client);
  const allMigrations = discoverMigrations(migrationsDir);

  return {
    applied: allMigrations
      .filter((m) => appliedNames.has(m.folderName))
      .map((m) => ({ name: m.name, folderName: m.folderName })),
    pending: allMigrations
      .filter((m) => !appliedNames.has(m.folderName))
      .map((m) => ({ name: m.name, folderName: m.folderName })),
  };
}
