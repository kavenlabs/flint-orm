// ---------------------------------------------------------------------------
// flint generate — reads the latest state.json, diffs against live table()
// definitions, writes the migration folder + new state.json.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import type { TableDef } from "../schema/table.js";
import type { SchemaState, MigrationOperation } from "./types.js";
import { serializeSchema } from "./serialize.js";
import { diffSchemas, emptyState } from "./diff.js";
import { generateSQL } from "./sql.js";

// ---------------------------------------------------------------------------
// Random word lists for migration folder names
// ---------------------------------------------------------------------------

const ADJECTIVES = [
  "amber", "azure", "blank", "brisk", "calm", "clear", "cold", "cool", "crisp", "dark",
  "deep", "dull", "dusk", "dawn", "fair", "faint", "flat", "foggy", "frost", "glad",
  "golden", "gray", "green", "gross", "happy", "harsh", "hazy", "keen", "kind", "light",
  "lively", "long", "loud", "lucky", "mild", "misty", "mossy", "neat", "noble", "odd",
  "pale", "plain", "proud", "pure", "quick", "quiet", "rare", "raw", "rich", "ripe",
  "rough", "royal", "rusty", "sharp", "sheer", "shiny", "silent", "silver", "sleek", "slim",
  "slow", "smooth", "soft", "solid", "sour", "stark", "steep", "stern", "still", "stout",
  "strict", "swift", "tall", "tame", "thin", "tidy", "tough", "vast", "vivid", "warm",
  "wild", "wise", "young",
];

const NOUNS = [
  "badger", "birch", "bison", "bloom", "brick", "brook", "cedar", "cider", "clay", "cobra",
  "coral", "crane", "creek", "crow", "deer", "delta", "dune", "eagle", "elm", "ember",
  "fern", "finch", "flint", "fox", "glacier", "gorse", "granite", "hare", "hawk", "hazel",
  "heron", "hickory", "hornet", "ivy", "jay", "jasper", "kestrel", "kite", "larch", "lea",
  "lichen", "linen", "lion", "maple", "marsh", "mink", "moss", "moth", "newt", "oak",
  "onyx", "otter", "owl", "pearl", "pine", "plume", "quail", "quartz", "rabbit", "rain",
  "raven", "ridge", "river", "robin", "rose", "sage", "salmon", "scarab", "shale", "silk",
  "skunk", "slate", "sparrow", "spice", "stone", "storm", "swift", "thorn", "tide", "tile",
  "toad", "tulip", "vale", "viper", "wasp", "willow", "wren", "yarrow",
];

// ---------------------------------------------------------------------------
// Migration folder naming — timestamp + random two words
// ---------------------------------------------------------------------------

function randomWords(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  return `${adj}_${noun}`;
}

function generateFolderName(migrationName?: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  if (migrationName) {
    return `${timestamp}_${migrationName}`;
  }
  const words = randomWords();
  return `${timestamp}_${words}`;
}

// ---------------------------------------------------------------------------
// Find the latest migration folder and read its state.json
// ---------------------------------------------------------------------------

function findLatestState(migrationsDir: string): SchemaState | null {
  if (!existsSync(migrationsDir)) return null;

  const entries = readdirSync(migrationsDir);

  // Find folders matching the pattern timestamp_words_name or timestamp_words
  const migrationFolders = entries
    .filter((e) => /^\d{10}_/.test(e))
    .sort()
    .reverse();

  for (const folder of migrationFolders) {
    const statePath = join(migrationsDir, folder, "state.json");
    if (existsSync(statePath)) {
      return JSON.parse(readFileSync(statePath, "utf-8")) as SchemaState;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Serialize an operation's argument for the migration file
// ---------------------------------------------------------------------------

function serializeOpArg(op: MigrationOperation): string {
  switch (op.type) {
    case "addTable":
      return serializeTableArg(op.table);
    case "dropTable":
      return JSON.stringify(op.tableName);
    case "renameTable":
      return `${JSON.stringify(op.from)}, ${JSON.stringify(op.to)}`;
    case "addColumn":
      return `${JSON.stringify(op.tableName)}, ${serializeColumnArg(op.column)}`;
    case "dropColumn":
      return `${JSON.stringify(op.tableName)}, ${JSON.stringify(op.columnName)}`;
    case "renameColumn":
      return `${JSON.stringify(op.tableName)}, ${JSON.stringify(op.from)}, ${JSON.stringify(op.to)}`;
    case "createIndex":
      return `${JSON.stringify(op.tableName)}, ${serializeIndexArg(op.index)}`;
    case "dropIndex":
      return JSON.stringify(op.indexName);
  }
}

function serializeColumnArg(col: import("./types.js").SerializedColumn): string {
  return JSON.stringify({
    name: col.name,
    sqlType: col.sqlType,
    isPrimaryKey: col.isPrimaryKey,
    isNotNull: col.isNotNull,
    isUnique: col.isUnique,
    hasDefault: col.hasDefault,
    defaultValue: col.defaultValue,
  });
}

function serializeIndexArg(idx: import("./types.js").SerializedIndex): string {
  return `{ name: ${JSON.stringify(idx.name)}, columns: ${JSON.stringify(idx.columns)}, unique: ${idx.unique} }`;
}

function serializeTableArg(table: import("./types.js").SerializedTable): string {
  const cols = table.columns.map((c) => serializeColumnArg(c)).join(",\n      ");
  const idxs = table.indexes.map((i) => serializeIndexArg(i)).join(",\n      ");
  let arg = `{\n      name: ${JSON.stringify(table.name)},\n      columns: [\n      ${cols}\n      ]`;
  if (table.indexes.length > 0) {
    arg += `,\n      indexes: [\n      ${idxs}\n      ]`;
  }
  arg += "\n    }";
  return arg;
}

// ---------------------------------------------------------------------------
// Public: generate a migration
// ---------------------------------------------------------------------------

export interface GenerateResult {
  folderName: string;
  operations: MigrationOperation[];
  sql: string;
  state: SchemaState;
}

export function generate(
  tables: TableDef<any>[],
  migrationsDir: string,
  migrationName?: string,
): GenerateResult {
  const previous = findLatestState(migrationsDir) ?? emptyState();
  const current = serializeSchema(tables);

  const operations = diffSchemas(previous, current);

  if (operations.length === 0) {
    throw new Error("No changes detected — schema is already up to date.");
  }

  const sql = generateSQL(operations);
  const folderName = generateFolderName(migrationName);

  // Write the migration folder
  const migrationDir = join(migrationsDir, folderName);
  mkdirSync(migrationDir, { recursive: true });

  // Write the migration file
  const uniqueOps = [...new Set(operations.map((op) => op.type))];
  const imports = uniqueOps.map((op) => `import { ${op} } from "flint-orm/migration/operations";`).join("\n");

  const operationLines = operations.map((op) => {
    const arg = serializeOpArg(op);
    return `    ${op.type}(${arg}),`;
  }).join("\n");

  const migrationContent = `// Migration: ${migrationName}
// Generated by flint generate

import { defineMigration } from "flint-orm/migration";
${imports}

export default defineMigration({
  name: "${migrationName}",
  operations: [
${operationLines}
  ],
});
`;

  writeFileSync(join(migrationDir, "migration.ts"), migrationContent);

  // Write the state snapshot
  writeFileSync(join(migrationDir, "state.json"), JSON.stringify(current, null, 2));

  return {
    folderName,
    operations,
    sql,
    state: current,
  };
}
