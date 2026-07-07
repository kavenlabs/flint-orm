#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// flint CLI — migration generation for flint-orm
// ---------------------------------------------------------------------------

import { parseArgs } from "node:util";
import { statSync, readdirSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

interface FlintConfig {
  schema: string;
  migrations: string;
}

async function loadConfig(): Promise<FlintConfig> {
  const configPath = resolve(process.cwd(), "flint.config.ts");
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
    typeof value === "object" &&
    "_" in value &&
    typeof (value as Record<string, unknown>)._ === "object" &&
    typeof ((value as Record<string, Record<string, unknown>>)._ as Record<string, unknown>).name === "string"
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
  const entries = readdirSync(folderPath).filter((e) => e.endsWith(".ts"));
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

async function cmdGenerate(
  args: ReturnType<typeof parseArgs>["values"],
  config: FlintConfig,
): Promise<void> {
  const name = typeof args.name === "string" ? args.name : "schema_change";
  const preview = args.preview === true;

  console.log(`🔍 Discovering schema from: ${config.schema}`);
  const tables = await discoverTables(config.schema);

  if (tables.length === 0) {
    console.error("❌ No table() definitions found in schema path.");
    process.exit(1);
  }

  console.log(`📦 Found ${tables.length} table(s):`);
  for (const t of tables) {
    console.log(`   - ${(t as Record<string, Record<string, unknown>>)._?.name ?? "unknown"}`);
  }

  if (preview) {
    // Dynamic import of migration functions
    const { serializeSchema } = await import("./migration/serialize.js");
    const { diffSchemas, emptyState } = await import("./migration/diff.js");
    const { generateSQL } = await import("./migration/sql.js");

    // Find latest state
    const { existsSync, readFileSync, readdirSync } = await import("node:fs");
    const migrationsDir = resolve(process.cwd(), config.migrations);
    let previousState: ReturnType<typeof emptyState> = null as any;
    if (existsSync(migrationsDir)) {
      const folders = readdirSync(migrationsDir).filter((e) => /^\d{3}_/.test(e)).sort().reverse();
      for (const folder of folders) {
        const statePath = join(migrationsDir, folder, "state.json");
        if (existsSync(statePath)) {
          previousState = JSON.parse(readFileSync(statePath, "utf-8"));
          break;
        }
      }
    }
    if (!previousState) previousState = emptyState();

    const currentState = serializeSchema(tables as any[]);
    const operations = diffSchemas(previousState, currentState);

    if (operations.length === 0) {
      console.log("\n✅ No changes detected — schema is already up to date.");
      return;
    }

    const sql = generateSQL(operations);
    console.log(`\n--- Preview: ${name} ---`);
    console.log(`   Operations: ${operations.length}`);
    console.log(`   Migrations dir: ${config.migrations}`);
    console.log(`\n--- SQL ---\n${sql}\n`);
    console.log("(dry run, no files written)");
    return;
  }

  // Dynamic import of the generate function
  const { generate } = await import("./migration/generate.js");

  try {
    const result = generate(tables as any[], resolve(process.cwd(), config.migrations), name);
    console.log(`\n✅ Migration generated: ${result.folderName}`);
    console.log(`   Operations: ${result.operations.length}`);
    console.log(`\n--- SQL Preview ---\n${result.sql}`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("No changes detected")) {
      console.log("\n✅ No changes detected — schema is already up to date.");
    } else {
      throw err;
    }
  }
}

async function cmdMigrate(
  _args: ReturnType<typeof parseArgs>["values"],
  _config: FlintConfig,
): Promise<void> {
  console.log("🚧 migrate command — not yet implemented.");
  console.log("   This will apply pending migrations to the database.");
  console.log("   Coming soon!");
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
  migrate    Apply pending migrations (stub — not yet implemented)

Options for generate:
  --name <name>     Migration name (default: "schema_change")
  --preview         Show what would be generated without writing files

Examples:
  flint generate --name init_schema
  flint generate --preview
  flint migrate
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      name: { type: "string", short: "n" },
      preview: { type: "boolean", short: "p" },
      help: { type: "boolean", short: "h" },
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
    case "generate":
      await cmdGenerate(values, config);
      break;
    case "migrate":
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
