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

  if (!existsSync(configPath)) {
    note(
      `Could not find ${pc.bold('flint.config.ts')} in the current directory.\n\n` +
        `Create one with:\n\n` +
        `  ${pc.dim("import { defineConfig } from 'flint-orm/config';")}\n` +
        `  ${pc.dim('export default defineConfig({')}\n` +
        `  ${pc.dim("  driver: 'bun-sqlite',")}\n` +
        `  ${pc.dim("  database: { url: './app.db' },")}\n` +
        `  ${pc.dim("  schema: './db',")}\n` +
        `  ${pc.dim('});')}\n`,
      'Missing config'
    );
    process.exit(1);
  }

  const configUrl = pathToFileURL(configPath).href;
  const mod = await import(configUrl);
  const config = mod.default as FlintConfig | undefined;

  if (!config || typeof config !== 'object') {
    note(
      `${pc.bold('flint.config.ts')} does not export a config object.\n\n` +
        `Make sure it has a default export:\n\n` +
        `  ${pc.dim('export default defineConfig({ ... })')}\n`,
      'Invalid config'
    );
    process.exit(1);
  }

  const missing: string[] = [];
  if (!config.driver) missing.push('driver');
  if (!config.database) missing.push('database');
  if (!config.schema) missing.push('schema');

  if (missing.length > 0) {
    note(
      `${pc.bold('flint.config.ts')} is missing required fields: ${pc.bold(missing.join(', '))}\n\n` +
        `A valid config looks like:\n\n` +
        `  ${pc.dim('export default defineConfig({')}\n` +
        `  ${pc.dim("  driver: 'bun-sqlite',")}\n` +
        `  ${pc.dim("  database: { url: './app.db' },")}\n` +
        `  ${pc.dim("  schema: './db',")}\n` +
        `  ${pc.dim('});')}\n`,
      'Invalid config'
    );
    process.exit(1);
  }

  return config;
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

  if (!existsSync(abs)) {
    note(
      `Schema path ${pc.bold(abs)} does not exist.\n\n` +
        `Check the ${pc.bold('schema')} field in your ${pc.bold('flint.config.ts')}.`,
      'Schema not found'
    );
    process.exit(1);
  }

  const stat = statSync(abs);

  if (stat.isFile()) {
    return importTableFile(abs);
  }

  if (stat.isDirectory()) {
    return importTableFolder(abs);
  }

  note(
    `Schema path ${pc.bold(abs)} is not a file or directory.`,
    'Invalid schema path'
  );
  process.exit(1);
}

async function importTableFile(filePath: string): Promise<unknown[]> {
  const url = pathToFileURL(filePath).href;
  let mod: Record<string, unknown>;

  try {
    mod = await import(url);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    note(
      `Could not load schema file ${pc.bold(filePath)}:\n\n` +
        `  ${pc.dim(msg)}\n\n` +
        `Make sure the file exports table() definitions.`,
      'Schema import error'
    );
    process.exit(1);
  }

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
          try {
            previousState = JSON.parse(readFileSync(statePath, 'utf-8'));
          } catch {
            note(
              `Could not parse ${pc.bold(statePath)}.\n\n` +
                `The file may be corrupted. Delete it and run ${pc.bold('flint generate')} again.`,
              'Invalid state file'
            );
            process.exit(1);
          }
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
      const msg = err instanceof Error ? err.message : String(err);
      note(`Migration generation failed:\n\n  ${pc.dim(msg)}`, 'Error');
      process.exit(1);
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

  const DRIVER_PACKAGES: Record<string, string> = {
    'better-sqlite3': 'better-sqlite3',
    libsql: '@libsql/client',
    'libsql-web': '@libsql/client',
    turso: '@tursodatabase/database',
    'turso-sync': '@tursodatabase/sync',
  };

  try {
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const pkg = DRIVER_PACKAGES[config.driver];

    if (pkg && (msg.includes('Cannot find module') || msg.includes('ERR_MODULE_NOT_FOUND') || msg.includes('not found'))) {
      const installCmd = pkg === '@libsql/client' ? 'npm install @libsql/client' : `npm install ${pkg}`;
      note(
        `Driver "${config.driver}" is not installed.\n\n` +
          `Install it with:\n\n` +
          `  ${pc.dim(installCmd)}\n`,
        'Missing driver'
      );
    } else {
      note(`Failed to load driver "${config.driver}":\n\n  ${pc.dim(msg)}`, 'Error');
    }
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
    const msg = err instanceof Error ? err.message : String(err);
    note(msg || 'An unexpected error occurred.', 'Error');
  }
  process.exit(1);
});
