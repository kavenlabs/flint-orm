#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// flint CLI — migration generation for flint-orm
// ---------------------------------------------------------------------------

import { parseArgs } from 'node:util';
import { statSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AnyTable, TableDef } from './schema/table.js';
import type { SchemaState } from './migration/types.js';

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

interface FlintConfig {
  /** Path to the SQLite database file. */
  url: string;
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

  console.log(`🔍 Discovering schema from: ${config.schema}`);
  const tables = await discoverTables(config.schema);

  if (tables.length === 0) {
    console.error('❌ No table() definitions found in schema path.');
    process.exit(1);
  }

  console.log(`📦 Found ${tables.length} table(s):`);
  for (const t of tables) {
    console.log(`   - ${(t as Record<string, Record<string, unknown>>)._?.name ?? 'unknown'}`);
  }

  if (preview) {
    // Dynamic import of migration functions
    const { serializeSchema } = await import('./migration/serialize.js');
    const { diffSchemas, emptyState } = await import('./migration/diff.js');
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
    const operations = diffSchemas(previousState, currentState);

    if (operations.length === 0) {
      console.log('\n✅ No changes detected — schema is already up to date.');
      return;
    }

    const sql = generateSQL(operations);
    const previewLabel = name ? `${name}` : 'unnamed';
    console.log(`\n--- Preview: ${previewLabel} ---`);
    console.log(`   Operations: ${operations.length}`);
    console.log(`   Migrations dir: ${config.migrations}`);
    console.log(`\n--- SQL ---\n${sql}\n`);
    console.log('(dry run, no files written)');
    return;
  }

  // Dynamic import of the generate function
  const { generate } = await import('./migration/generate.js');

  try {
    const result = generate(tables as TableDef<any>[], resolve(process.cwd(), (config.migrations ?? './flint') as string), name);
    console.log(`\n✅ Migration generated: ${result.folderName}`);
    console.log(`   Operations: ${result.operations.length}`);
    console.log(`\n--- SQL Preview ---\n${result.sql}`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('No changes detected')) {
      console.log('\n✅ No changes detected — schema is already up to date.');
    } else {
      throw err;
    }
  }
}

async function cmdMigrate(args: ReturnType<typeof parseArgs>['values'], config: FlintConfig): Promise<void> {
  const { Database } = await import('bun:sqlite');
  const { migrate, getMigrationStatus } = await import('./migration/migrate.js');

  const migrationsDir = resolve(process.cwd(), config.migrations ?? './flint');
  const dryRun = args['dry-run'] === true;
  const statusOnly = args.status === true;
  const name = typeof args.name === 'string' ? args.name : undefined;

  // Open database from config
  const dbUrl = resolve(process.cwd(), config.url);
  const db = new Database(dbUrl);

  try {
    if (statusOnly) {
      const status = getMigrationStatus(db, migrationsDir);

      if (status.applied.length === 0 && status.pending.length === 0) {
        console.log('✅ No migrations found.');
        return;
      }

      if (status.applied.length > 0) {
        console.log('\n📋 Applied migrations:');
        for (const m of status.applied) {
          console.log(`   ✓ ${m.name} (${m.folderName})`);
        }
      }

      if (status.pending.length > 0) {
        console.log('\n⏳ Pending migrations:');
        for (const m of status.pending) {
          console.log(`   ○ ${m.name} (${m.folderName})`);
        }
      }

      console.log(`\n   ${status.applied.length} applied, ${status.pending.length} pending`);
      return;
    }

    const result = await migrate(db, {
      migrationsDir,
      dryRun,
    });

    if (result.applied.length === 0) {
      console.log('\n✅ No pending migrations — database is up to date.');
    } else {
      console.log(`\n🚀 ${dryRun ? 'Would apply' : 'Applied'} ${result.applied.length} migration(s):`);
      for (const name of result.applied) {
        console.log(`   ✓ ${name}`);
      }
    }

    if (result.skipped.length > 0 && !dryRun) {
      console.log(`\n⏭  Skipped ${result.skipped.length} already applied migration(s)`);
    }
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
flint — migration CLI for flint-orm

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
      console.error(`❌ Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
