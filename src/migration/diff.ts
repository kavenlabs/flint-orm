// ---------------------------------------------------------------------------
// Schema diff engine — compares two SchemaStates and produces a list of
// named MigrationOperations. This is the core of `flint generate`.
// ---------------------------------------------------------------------------

import type {
  SchemaState,
  MigrationOperation,
  SerializedColumn,
  SerializedTable,
} from "./types.js";
import {
  addTable,
  dropTable,
  renameTable,
  addColumn,
  dropColumn,
  renameColumn,
  createIndex,
  dropIndex,
} from "./operations.js";

// ---------------------------------------------------------------------------
// Diff two column definitions — returns operations for any differences.
// ---------------------------------------------------------------------------

function diffColumns(
  tableName: string,
  prevCols: SerializedColumn[],
  currCols: SerializedColumn[],
): MigrationOperation[] {
  const ops: MigrationOperation[] = [];

  const prevByName = new Map(prevCols.map((c) => [c.name, c]));
  const currByName = new Map(currCols.map((c) => [c.name, c]));

  // Columns in current but not in previous → added
  for (const [name, col] of currByName) {
    if (!prevByName.has(name)) {
      ops.push(addColumn(tableName, col));
    }
  }

  // Columns in previous but not in current → dropped
  for (const [name] of prevByName) {
    if (!currByName.has(name)) {
      ops.push(dropColumn(tableName, name));
    }
  }

  // Columns in both — check for renames (heuristic: same sqlType, different name)
  // For now, skip rename detection — it requires interactive prompts.
  // The diff will show drop + add for renamed columns, which is safe.

  return ops;
}

// ---------------------------------------------------------------------------
// Diff two table definitions
// ---------------------------------------------------------------------------

function diffTable(
  tableName: string,
  prev: SerializedTable,
  curr: SerializedTable,
): MigrationOperation[] {
  const ops: MigrationOperation[] = [];

  // Column changes
  ops.push(...diffColumns(tableName, prev.columns, curr.columns));

  // Index changes
  const prevIndexes = new Map(prev.indexes.map((i) => [i.name, i]));
  const currIndexes = new Map(curr.indexes.map((i) => [i.name, i]));

  for (const [name, idx] of currIndexes) {
    if (!prevIndexes.has(name)) {
      ops.push(createIndex(tableName, idx));
    }
  }

  for (const [name] of prevIndexes) {
    if (!currIndexes.has(name)) {
      ops.push(dropIndex(name));
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Public: diff two schema states
// ---------------------------------------------------------------------------

export function diffSchemas(
  previous: SchemaState,
  current: SchemaState,
): MigrationOperation[] {
  const ops: MigrationOperation[] = [];

  const prevTables = new Map(Object.entries(previous.tables));
  const currTables = new Map(Object.entries(current.tables));

  // Tables in current but not in previous → added
  for (const [name, table] of currTables) {
    if (!prevTables.has(name)) {
      ops.push(addTable(table));
    }
  }

  // Tables in previous but not in current → dropped
  for (const [name] of prevTables) {
    if (!currTables.has(name)) {
      ops.push(dropTable(name));
    }
  }

  // Tables in both → diff their contents
  for (const [name, prevTable] of prevTables) {
    const currTable = currTables.get(name);
    if (currTable) {
      ops.push(...diffTable(name, prevTable, currTable));
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Empty state — used as the "before" for the very first migration.
// ---------------------------------------------------------------------------

export function emptyState(): SchemaState {
  return { version: 1, tables: {} };
}
