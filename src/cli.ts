#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// flint CLI — migration generation for flint-orm
// ---------------------------------------------------------------------------

import { parseArgs, styleText } from 'node:util';
import { statSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AnyTable, TableDef } from './schema/table.js';
import type { SchemaState } from './migration/types.js';
import { outro, log, cancel, isCancel, select, pc, note } from './cli/ui.js';
import { CancellationError } from './migration/diff.js';
import type { RenamePrompt } from './migration/diff.js';
import type { Executor } from './executor.js';

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

interface FlintConfig {
  /** Which SQLite driver to use. */
  driver: string;
  /** Database connection details. */
  database: { url: string; authToken?: string };
  /** Path to schema file or directory. */
  schema: string;
  /** Path to migrations directory (default: ./flint). */
  migrations?: string;
}

async function loadConfig(): Promise<FlintConfig> {
  const configPath = resolve(process.cwd(), 'flint.config.ts');
  const configUrl = pathToFileURL(configPath).href;
  const mod = await import(configUrl);
  return mod.default as FlintConfig;
}

// ---------------------------------------------------------------------------
// Schema discovery — import table() exports from schema path
// ---------------------------------------------------------------------------

function isTableDef(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    '_' in value &&
    typeof (value as Record<string, unknown>)._ === 'object' &&
    typeof ((value as Record<string, Record<string, unknown>>)._ as Record<string, unknown>).name === 'string'
  );
}

async function discoverTables(schemaPath: string): Promise<unknown[]> {
  const abs = isAbsolute(schemaPath) ? schemaPath : resolve(process.cwd(), schemaPath);
  const stat = statSync(abs);

  if (stat.isFile()) {
    return importTableFile(abs);
  }

  if (stat.isDirectory()) {
    return importTableFolder(abs);
  }

  throw new Error(`Schema path does not exist: ${abs}`);
}

async function importTableFile(filePath: string): Promise<unknown[]> {
  const url = pathToFileURL(filePath).href;
  const mod = await import(url);
  const tables: unknown[] = [];

  for (const exportValue of Object.values(mod)) {
    if (isTableDef(exportValue)) {
      tables.push(exportValue);
    }
  }

  return tables;
}

async function importTableFolder(folderPath: string): Promise<unknown[]> {
  const entries = readdirSync(folderPath).filter((e) => e.endsWith('.ts'));
  const tables: unknown[] = [];

  for (const entry of entries) {
    const filePath = join(folderPath, entry);
    const discovered = await importTableFile(filePath);
    tables.push(...discovered);
  }

  return tables;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdGenerate(args: ReturnType<typeof parseArgs>['values'], config: FlintConfig): Promise<void> {
  const name = typeof args.name === 'string' ? args.name : undefined;
  const preview = args.preview === true;
  const promptRename: RenamePrompt = (message, options) => select({ message: pc.bold(message), options }) as Promise<string | symbol>;

  log.info(`Discovering schema from: ${config.schema}`);
  const tables = await discoverTables(config.schema);

  if (tables.length === 0) {
    cancel('No table() definitions found in schema path.');
    process.exit(1);
  }

  log.info(`Found ${tables.length} table(s): ${tables.map((t) => (t as Record<string, Record<string, unknown>>)._?.name ?? 'unknown').join(', ')}`);

  if (preview) {
    // Dynamic import of migration functions
    const { serializeSchema } = await import('./migration/serialize.js');
    const { diffSchemas, emptyState, resolveRenames } = await import('./migration/diff.js');
    const { generateSQL } = await import('./migration/sql.js');

    // Find latest state
    const migrationsDir = resolve(process.cwd(), config.migrations ?? './flint');
    let previousState: SchemaState | null = null;
    if (existsSync(migrationsDir)) {
      const folders = readdirSync(migrationsDir)
        .filter((e) => /^\d{10}_/.test(e))
        .sort()
        .reverse();
      for (const folder of folders) {
        const statePath = join(migrationsDir, folder, 'state.json');
        if (existsSync(statePath)) {
          previousState = JSON.parse(readFileSync(statePath, 'utf-8'));
          break;
        }
      }
    }
    if (!previousState) previousState = emptyState();

    const currentState = serializeSchema(tables as AnyTable[]);
    const rawOps = diffSchemas(previousState, currentState);

    if (rawOps.length === 0) {
      outro('Schema is already up to date.');
      return;
    }

    // Resolve renames interactively
    const operations = await resolveRenames(rawOps, { interactive: true, prompt: promptRename });

    const sql = generateSQL(operations);
    log.info(`Operations: ${operations.length}`);
    note(sql, 'SQL', { format: (text) => styleText('dim', text) });
    log.info('(dry run, no files written)');
    return;
  }

  // Dynamic import of the generate function
  const { generate } = await import('./migration/generate.js');

  try {
    const migrationsDir = resolve(process.cwd(), config.migrations ?? './flint');
    const result = await generate(tables as TableDef<any>[], migrationsDir, {
      name,
      interactive: true,
      prompt: promptRename,
    });
    log.info(`Operations: ${result.operations.length}`);
    note(result.sql, 'SQL', { format: (text) => styleText('dim', text) });
    log.success(`Migration generated: ${migrationsDir}/${result.folderName}`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('No changes detected')) {
      outro('Schema is already up to date.');
    } else {
      throw err;
    }
  }
}

async function cmdMigrate(args: ReturnType<typeof parseArgs>['values'], config: FlintConfig): Promise<void> {
  const { migrate, getMigrationStatus } = await import('./migration/migrate.js');

  const migrationsDir = resolve(process.cwd(), config.migrations ?? './flint');
  const dryRun = args['dry-run'] === true;
  const statusOnly = args.status === true;

  // Dynamically create executor based on configured driver
  const isLocalDriver = config.driver === 'bun-sqlite' || config.driver === 'better-sqlite3';
  const dbUrl = isLocalDriver ? resolve(process.cwd(), config.database.url) : config.database.url;

  let executor: Executor;

  switch (config.driver) {
    case 'bun-sqlite': {
      const { BunSqliteExecutor } = await import('./drivers/bun-sqlite');
      const { Database } = await import('bun:sqlite');
      executor = new BunSqliteExecutor(new Database(dbUrl));
      break;
    }
    case 'better-sqlite3': {
      const { BetterSqlite3Executor } = await import('./drivers/better-sqlite3');
      const Database = (await import('better-sqlite3')).default;
      executor = new BetterSqlite3Executor(new Database(dbUrl));
      break;
    }
    case 'libsql': {
      const { LibsqlExecutor } = await import('./drivers/libsql');
      const { createClient: createLibsqlClient } = await import('@libsql/client');
      executor = new LibsqlExecutor(createLibsqlClient({ url: dbUrl, authToken: config.database.authToken }));
      break;
    }
    case 'libsql-web': {
      const { LibsqlWebExecutor } = await import('./drivers/libsql-web');
      const { createClient: createLibsqlWebClient } = await import('@libsql/client/web');
      executor = new LibsqlWebExecutor(createLibsqlWebClient({ url: dbUrl, authToken: config.database.authToken }));
      break;
    }
    case 'turso-sync': {
      const { TursoSyncExecutor } = await import('./drivers/turso-sync');
      const { connect } = await import('@tursodatabase/sync');
      const db = await connect({ path: dbUrl, authToken: config.database.authToken });
      executor = new TursoSyncExecutor(db);
      break;
    }
    case 'turso': {
      const { TursoExecutor } = await import('./drivers/turso');
      const { connect } = await import('@tursodatabase/database');
      const db = await connect(dbUrl);
      executor = new TursoExecutor(db);
      break;
    }
    default:
      cancel(`Unsupported driver: ${config.driver}`);
      process.exit(1);
  }

  try {
    if (statusOnly) {
      const status = await getMigrationStatus(executor, migrationsDir);

      if (status.applied.length === 0 && status.pending.length === 0) {
        outro('No migrations found.');
        return;
      }

      if (status.applied.length > 0) {
        log.info('Applied migrations:');
        for (const m of status.applied) {
          log.success(`${m.name} (${m.folderName})`);
        }
      }

      if (status.pending.length > 0) {
        log.warn('Pending migrations:');
        for (const m of status.pending) {
          log.message(`  ○ ${m.name} (${m.folderName})`);
        }
      }

      log.info(`${status.applied.length} applied, ${status.pending.length} pending`);
      return;
    }

    const result = await migrate(executor, {
      migrationsDir,
      dryRun,
    });

    if (result.applied.length === 0) {
      outro('No pending migrations — database is up to date.');
    } else {
      log.info(`${dryRun ? 'Would apply' : 'Applied'} ${result.applied.length} migration(s):`);
      for (const appliedName of result.applied) {
        log.success(appliedName);
      }
    }

    if (result.skipped.length > 0 && !dryRun) {
      log.info(`Skipped ${result.skipped.length} already applied migration(s)`);
    }
  } finally {
    executor.close();
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  log.message(`
Usage:
  flint <command> [options]

Commands:
  generate   Generate a new migration from schema changes
  migrate    Apply pending migrations to the database

Options for generate:
  --name <name>     Migration name (optional)
  --preview         Show what would be generated without writing files

Options for migrate:
  --status          Show applied and pending migrations
  --dry-run         Show what would be applied without executing
  --name <name>     Apply only the named migration

Examples:
  flint generate --name init_schema
  flint generate --preview
  flint migrate
  flint migrate --status
  flint migrate --dry-run
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      name: { type: 'string', short: 'n' },
      preview: { type: 'boolean', short: 'p' },
      help: { type: 'boolean', short: 'h' },
      status: { type: 'boolean', short: 's' },
      'dry-run': { type: 'boolean', short: 'd' },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    printHelp();
    process.exit(0);
  }

  const command = positionals[0];
  const config = await loadConfig();

  switch (command) {
    case 'generate':
      await cmdGenerate(values, config);
      break;
    case 'migrate':
      await cmdMigrate(values, config);
      break;
    default:
      cancel(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  if (isCancel(err) || err instanceof CancellationError) {
    cancel('Operation cancelled.');
  } else {
    cancel(err.message ?? 'An error occurred');
  }
  process.exit(1);
});
