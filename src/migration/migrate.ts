// ---------------------------------------------------------------------------
// Migration runner — applies pending migrations to a database, tracking
// what's been applied in a __flint_migrations table.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Executor } from '../executor';
import type { MigrationFile, RebuildTableOp } from './types';
import { generateSQLStatements } from './sql';

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

const TRACKING_TABLE = '__flint_migrations';

async function ensureTrackingTable(executor: Executor): Promise<void> {
  await executor.run(
    `CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )`,
    [],
  );
}

async function getAppliedMigrations(executor: Executor): Promise<Set<string>> {
  const rows = (await executor.all(`SELECT name FROM ${TRACKING_TABLE} ORDER BY id`, [])) as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

async function recordMigration(executor: Executor, name: string): Promise<void> {
  await executor.run(`INSERT INTO ${TRACKING_TABLE} (name, applied_at) VALUES (?, ?)`, [name, Date.now()]);
}

// ---------------------------------------------------------------------------
// Incoming FK check — refuses rebuild if other tables reference this one.
// Queries all user tables and checks their PRAGMA foreign_key_list for
// references to the rebuild target.
// ---------------------------------------------------------------------------

async function checkIncomingForeignKeys(executor: Executor, tableName: string): Promise<void> {
  const allTables = (await executor.all(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__flint_%'`,
    [],
  )) as { name: string }[];

  const referencing: string[] = [];
  for (const { name } of allTables) {
    if (name === tableName) continue;
    const fkRows = (await executor.all(`PRAGMA foreign_key_list('${name}')`, [])) as { table: string }[];
    if (fkRows.some((fk) => fk.table === tableName)) {
      referencing.push(name);
    }
  }

  if (referencing.length > 0) {
    throw new Error(`Cannot rebuild "${tableName}" — referenced by: ${referencing.join(', ')}. ` + `Rebuild or migrate those tables first.`);
  }
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
  const migrationFolders = entries.filter((e) => /^\d{10}_/.test(e)).sort(); // Chronological order

  return migrationFolders.map((folder) => {
    const name = folder.replace(/^\d{10}_/, '');
    return {
      folderName: folder,
      name,
      path: join(migrationsDir, folder),
    };
  });
}

async function loadMigration(entry: MigrationEntry): Promise<MigrationFile> {
  const migrationPath = join(entry.path, 'migration.ts');
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
 * @param executor - The database executor (works with any driver)
 * @param options - Migration options
 * @returns Result with applied and skipped migration names
 *
 * @example
 * import { flint } from 'flint-orm/bun-sqlite';
 * import { migrate } from 'flint-orm/migration';
 *
 * const db = flint({ url: 'app.db' });
 * const result = await migrate(db.$executor, { migrationsDir: './flint' });
 * console.log(`Applied: ${result.applied.join(', ')}`);
 */
export async function migrate(executor: Executor, options: MigrateOptions): Promise<MigrateResult> {
  const { migrationsDir, dryRun = false } = options;

  // Ensure tracking table exists (skip for dry runs)
  if (!dryRun) {
    await ensureTrackingTable(executor);
  }

  // Get already-applied migrations
  const applied = dryRun ? new Set<string>() : await getAppliedMigrations(executor);

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

    // Check for incoming FKs before any rebuild operations
    for (const op of migration.operations) {
      if (op.type === 'rebuildTable') {
        await checkIncomingForeignKeys(executor, (op as RebuildTableOp).tableName);
      }
    }

    // Generate individual statements — one per operation, no split needed
    const statements = generateSQLStatements(migration.operations);

    // Execute in a transaction (use folderName for consistent tracking)
    await executor.transaction(async () => {
      for (const stmt of statements) {
        await executor.run(stmt, []);
      }
      await recordMigration(executor, entry.folderName);
    });

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
 * @param executor - The database executor (works with any driver)
 * @param migrationsDir - Path to the migrations directory
 * @returns Status object with applied and pending migrations
 */
export async function getMigrationStatus(executor: Executor, migrationsDir: string): Promise<MigrationStatus> {
  await ensureTrackingTable(executor);
  const appliedNames = await getAppliedMigrations(executor);
  const allMigrations = discoverMigrations(migrationsDir);

  return {
    applied: allMigrations.filter((m) => appliedNames.has(m.folderName)).map((m) => ({ name: m.name, folderName: m.folderName })),
    pending: allMigrations.filter((m) => !appliedNames.has(m.folderName)).map((m) => ({ name: m.name, folderName: m.folderName })),
  };
}
