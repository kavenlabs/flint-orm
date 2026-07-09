// ---------------------------------------------------------------------------
// Schema diff engine — compares two SchemaStates and produces a list of
// named MigrationOperations. This is the core of `flint generate`.
// ---------------------------------------------------------------------------

import type { SchemaState, MigrationOperation, SerializedColumn, SerializedTable, ModifyColumnOp, AddColumnOp, DropColumnOp, AddTableOp, DropTableOp } from './types.js';
import { addTable, dropTable, renameTable, addColumn, dropColumn, renameColumn, createIndex, dropIndex, modifyColumn, modifyIndex } from './operations.js';
import { select, isCancel, cancel, pc } from '../cli/ui.js';

// ---------------------------------------------------------------------------
// Topological sort — orders tables by FK dependency (independent → dependent).
// ---------------------------------------------------------------------------

function topologicalSort(tables: SerializedTable[]): SerializedTable[] {
  const deps = new Map<string, Set<string>>();
  for (const table of tables) {
    const tableDeps = new Set<string>();
    for (const col of table.columns) {
      if (col.referencesTable && col.referencesTable !== table.name) {
        tableDeps.add(col.referencesTable);
      }
    }
    deps.set(table.name, tableDeps);
  }

  const tableByName = new Map(tables.map((t) => [t.name, t]));
  const remaining = new Set(tables.map((t) => t.name));
  const sorted: SerializedTable[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining].filter((name) => {
      const d = deps.get(name)!;
      return [...d].every((dep) => !remaining.has(dep));
    });

    if (ready.length === 0) {
      const cycle = [...remaining].join(', ');
      throw new Error(`Circular foreign key dependency detected: ${cycle}`);
    }

    for (const name of ready) {
      sorted.push(tableByName.get(name)!);
      remaining.delete(name);
    }
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Diff two column definitions — returns operations for any differences.
// ---------------------------------------------------------------------------

function diffColumns(tableName: string, prevCols: SerializedColumn[], currCols: SerializedColumn[]): MigrationOperation[] {
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

  // Columns in both → check for modifications
  for (const [name, currCol] of currByName) {
    const prevCol = prevByName.get(name);
    if (!prevCol) continue;

    const changes: ModifyColumnOp['changes'] = {};
    let hasChanges = false;

    // Type change — unsafe, throw
    if (prevCol.sqlType !== currCol.sqlType) {
      throw new Error(
        `Column "${tableName}.${name}" type change (${prevCol.sqlType} → ${currCol.sqlType}) requires a table rebuild. Handle this manually.`,
      );
    }

    // PRIMARY KEY change — unsafe, throw
    if (prevCol.isPrimaryKey !== currCol.isPrimaryKey) {
      throw new Error(`Column "${tableName}.${name}" PRIMARY KEY change requires a table rebuild. Handle this manually.`);
    }

    // NOT NULL change
    if (prevCol.isNotNull !== currCol.isNotNull) {
      // Removing NOT NULL — unsafe
      if (prevCol.isNotNull && !currCol.isNotNull) {
        throw new Error(`Column "${tableName}.${name}" removing NOT NULL requires a table rebuild. Handle this manually.`);
      }
      // Adding NOT NULL — safe only if column has a DEFAULT
      if (!prevCol.isNotNull && currCol.isNotNull) {
        if (!currCol.hasDefault) {
          throw new Error(
            `Column "${tableName}.${name}" adding NOT NULL requires a DEFAULT value. Add a default: .default(value)`,
          );
        }
        changes.isNotNull = true;
        hasChanges = true;
      }
    }

    // UNIQUE change — throw (requires index manipulation)
    if (prevCol.isUnique !== currCol.isUnique) {
      if (currCol.isUnique) {
        throw new Error(
          `Column "${tableName}.${name}" adding UNIQUE requires creating a unique index. Use index(): index("idx_${tableName}_${name}").on(t.${name}).unique()`,
        );
      } else {
        throw new Error(`Column "${tableName}.${name}" removing UNIQUE requires dropping the unique index.`);
      }
    }

    // DEFAULT change
    if (prevCol.hasDefault !== currCol.hasDefault || prevCol.defaultValue !== currCol.defaultValue) {
      changes.hasDefault = currCol.hasDefault;
      changes.defaultValue = currCol.defaultValue;
      hasChanges = true;
    }

    if (hasChanges) {
      ops.push(modifyColumn(tableName, name, changes));
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Diff two table definitions
// ---------------------------------------------------------------------------

function diffTable(tableName: string, prev: SerializedTable, curr: SerializedTable): MigrationOperation[] {
  const ops: MigrationOperation[] = [];

  // Column changes
  ops.push(...diffColumns(tableName, prev.columns, curr.columns));

  // Index changes
  const prevIndexes = new Map(prev.indexes.map((i) => [i.name, i]));
  const currIndexes = new Map(curr.indexes.map((i) => [i.name, i]));

  // New indexes
  for (const [name, idx] of currIndexes) {
    if (!prevIndexes.has(name)) {
      ops.push(createIndex(tableName, idx));
    }
  }

  // Dropped indexes
  for (const [name] of prevIndexes) {
    if (!currIndexes.has(name)) {
      ops.push(dropIndex(name));
    }
  }

  // Modified indexes (columns or unique changed)
  for (const [name, currIdx] of currIndexes) {
    const prevIdx = prevIndexes.get(name);
    if (!prevIdx) continue;

    const columnsChanged = JSON.stringify(prevIdx.columns) !== JSON.stringify(currIdx.columns);
    const uniqueChanged = prevIdx.unique !== currIdx.unique;

    if (columnsChanged || uniqueChanged) {
      ops.push(modifyIndex(tableName, name, prevIdx, currIdx));
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Public: diff two schema states
// ---------------------------------------------------------------------------

export function diffSchemas(previous: SchemaState, current: SchemaState): MigrationOperation[] {
  const ops: MigrationOperation[] = [];

  const prevTables = new Map(Object.entries(previous.tables));
  const currTables = new Map(Object.entries(current.tables));

  // Tables in current but not in previous → added (topologically sorted)
  const addedTables = [...currTables.entries()].filter(([name]) => !prevTables.has(name)).map(([, table]) => table);
  const sortedAdded = topologicalSort(addedTables);
  for (const table of sortedAdded) {
    ops.push(addTable(table));
  }

  // Tables in previous but not in current → dropped (reverse topological order)
  const droppedTables = [...prevTables.entries()].filter(([name]) => !currTables.has(name)).map(([, table]) => table);
  const sortedDropped = topologicalSort(droppedTables).reverse();
  for (const table of sortedDropped) {
    ops.push(dropTable(table.name));
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

// ---------------------------------------------------------------------------
// Resolve renames — prompts user to confirm potential renames.
// ---------------------------------------------------------------------------

interface PotentialRename {
  type: 'table' | 'column';
  tableName: string;
  from: string;
  to: string;
}

export async function resolveRenames(operations: MigrationOperation[]): Promise<MigrationOperation[]> {
  // Group potential renames by the "to" entity
  const renameGroups = new Map<string, PotentialRename[]>();

  // Find table renames: dropTable + addTable with overlapping columns
  const droppedTables = operations.filter((op): op is DropTableOp => op.type === 'dropTable');
  const addedTables = operations.filter((op): op is AddTableOp => op.type === 'addTable');

  for (const dropped of droppedTables) {
    for (const added of addedTables) {
      // Check if columns overlap (simple heuristic for potential rename)
      const oldTable = droppedTables.find((t) => t.tableName === dropped.tableName);
      if (!oldTable) continue;

      // Get columns from the addTable operation that matches the dropped table
      const oldTableAddOp = operations.find(
        (op): op is AddTableOp => op.type === 'addTable' && op.table.name === dropped.tableName,
      );
      if (!oldTableAddOp) continue;

      const oldColNames = new Set(oldTableAddOp.table.columns.map((c) => c.name));
      const newColNames = added.table.columns.map((c) => c.name);
      const overlap = newColNames.filter((name) => oldColNames.has(name));

      if (overlap.length > 0) {
        const key = `table:${added.table.name}`;
        if (!renameGroups.has(key)) renameGroups.set(key, []);
        renameGroups.get(key)!.push({
          type: 'table',
          tableName: added.table.name,
          from: dropped.tableName,
          to: added.table.name,
        });
      }
    }
  }

  // Find column renames: dropColumn + addColumn in same table
  const droppedColumns = operations.filter((op): op is DropColumnOp => op.type === 'dropColumn');
  const addedColumns = operations.filter((op): op is AddColumnOp => op.type === 'addColumn');

  for (const added of addedColumns) {
    // Find all dropped columns in the same table
    const candidates = droppedColumns.filter((d) => d.tableName === added.tableName);

    if (candidates.length > 0) {
      const key = `column:${added.tableName}:${added.column.name}`;
      if (!renameGroups.has(key)) renameGroups.set(key, []);

      for (const dropped of candidates) {
        renameGroups.get(key)!.push({
          type: 'column',
          tableName: added.tableName,
          from: dropped.columnName,
          to: added.column.name,
        });
      }
    }
  }

  if (renameGroups.size === 0) {
    return operations;
  }

  // Prompt user for each group
  const resolvedOps = [...operations];
  const consumedDrops = new Set<string>(); // Track consumed drops: "type:tableName:columnName"

  for (const [, renames] of renameGroups) {
    const firstRename = renames[0]!;
    const entityLabel = firstRename.type === 'table' ? 'table' : 'column';
    const dropType = firstRename.type === 'table' ? 'dropTable' : 'dropColumn';

    // Filter out already-consumed drops from candidates
    const availableRenames = renames.filter((r) => !consumedDrops.has(`${dropType}:${r.tableName}:${r.from}`));

    // If no candidates left, this is a pure add — skip prompt
    if (availableRenames.length === 0) {
      continue;
    }

    // Build options: "add" first, then available rename candidates
    const options = [
      {
        value: 'add',
        label: firstRename.to,
        hint: firstRename.type === 'table' ? 'create table' : 'add column',
      },
      ...availableRenames.map((r) => ({
        value: `rename:${r.from}`,
        label: `${r.from} → ${r.to}`,
        hint: `rename ${entityLabel}`,
      })),
    ];

    const result = await select({
      message: `Is ${pc.bold(firstRename.to)} ${entityLabel} added or renamed?`,
      options,
    });

    if (isCancel(result)) {
      cancel('Operation cancelled.');
      process.exit(0);
    }

    if (result !== 'add') {
      // Extract the "from" name from "rename:xxx"
      const fromName = result.replace('rename:', '');
      const rename = availableRenames.find((r) => r.from === fromName);
      if (!rename) continue;

      // Mark this drop as consumed
      consumedDrops.add(`${dropType}:${rename.tableName}:${rename.from}`);

      // Replace drop + add with rename operation
      const renameOp = rename.type === 'table' ? renameTable(rename.from, rename.to) : renameColumn(rename.tableName, rename.from, rename.to);

      // Remove the drop and add operations, add the rename
      const addType = rename.type === 'table' ? 'addTable' : 'addColumn';
      const nameField = rename.type === 'table' ? 'tableName' : 'columnName';

      // Find and remove the drop operation
      const dropIdx = resolvedOps.findIndex(
        (op) => op.type === dropType && (op as DropTableOp | DropColumnOp)[nameField as keyof (DropTableOp | DropColumnOp)] === rename.from,
      );
      if (dropIdx !== -1) resolvedOps.splice(dropIdx, 1);

      // Find and remove the add operation
      const addIdx = resolvedOps.findIndex(
        (op) =>
          op.type === addType &&
          ((op as AddTableOp).table?.name === rename.to || (op as AddColumnOp).column?.name === rename.to),
      );
      if (addIdx !== -1) resolvedOps.splice(addIdx, 1);

      // Add the rename operation
      resolvedOps.push(renameOp);
    }
  }

  return resolvedOps;
}
