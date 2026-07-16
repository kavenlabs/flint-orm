// ---------------------------------------------------------------------------
// Schema diff engine — compares two SchemaStates and produces a list of
// named MigrationOperations. This is the core of `flint generate`.
// ---------------------------------------------------------------------------

import type {
  SchemaState,
  MigrationOperation,
  SerializedColumn,
  SerializedTable,
  ModifyColumnOp,
  AddColumnOp,
  DropColumnOp,
  AddTableOp,
  DropTableOp,
} from './types';
import {
  addTable,
  dropTable,
  renameTable,
  addColumn,
  dropColumn,
  renameColumn,
  createIndex,
  dropIndex,
  modifyColumn,
  modifyIndex,
  rebuildTable,
} from './operations';

// ---------------------------------------------------------------------------
// CancellationError — thrown when user cancels an interactive prompt.
// ---------------------------------------------------------------------------

export class CancellationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CancellationError';
  }
}

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
// If any change is unsafe (requires table rebuild), returns { unsafe: true }
// so the caller can emit a rebuildTable operation instead.
// ---------------------------------------------------------------------------

interface DiffColumnsResult {
  ops: MigrationOperation[];
  unsafe: boolean;
}

function diffColumns(tableName: string, prevCols: SerializedColumn[], currCols: SerializedColumn[]): DiffColumnsResult {
  const ops: MigrationOperation[] = [];
  let unsafe = false;

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

    // Type change — unsafe (SQLite has no ALTER COLUMN TYPE)
    if (prevCol.sqlType !== currCol.sqlType) {
      unsafe = true;
    }

    // PRIMARY KEY change — unsafe
    if (prevCol.isPrimaryKey !== currCol.isPrimaryKey) {
      unsafe = true;
    }

    // AUTOINCREMENT change — unsafe (SQLite requires table rebuild)
    // Skip if prevCol lacks the field entirely (upgrade from pre-0.4.5)
    if (prevCol.isAutoIncrement !== undefined && (prevCol.isAutoIncrement ?? false) !== (currCol.isAutoIncrement ?? false)) {
      unsafe = true;
    }

    // NOT NULL change
    if (prevCol.isNotNull !== currCol.isNotNull) {
      // Removing NOT NULL — unsafe
      if (prevCol.isNotNull && !currCol.isNotNull) {
        unsafe = true;
      }
      // Adding NOT NULL — safe only if column has a DEFAULT
      if (!prevCol.isNotNull && currCol.isNotNull) {
        if (!currCol.hasDefault) {
          unsafe = true;
        } else {
          changes.isNotNull = true;
          hasChanges = true;
        }
      }
    }

    // UNIQUE change — requires index manipulation, mark unsafe
    if (prevCol.isUnique !== currCol.isUnique) {
      unsafe = true;
    }

    // DEFAULT change
    if (prevCol.hasDefault !== currCol.hasDefault || prevCol.defaultValue !== currCol.defaultValue) {
      // Removing DEFAULT — SQLite has no DROP DEFAULT syntax
      if (prevCol.hasDefault && !currCol.hasDefault) {
        unsafe = true;
      }
      // Changing or adding DEFAULT — safe
      if (!unsafe || hasChanges) {
        changes.hasDefault = currCol.hasDefault;
        changes.defaultValue = currCol.defaultValue;
        hasChanges = true;
      }
    }

    // FK target change — unsafe (SQLite requires table rebuild)
    if (prevCol.referencesTable !== currCol.referencesTable || prevCol.referencesColumn !== currCol.referencesColumn) {
      unsafe = true;
    }

    // FK add/remove — unsafe (SQLite requires table rebuild)
    const hadFk = !!prevCol.referencesTable;
    const hasFk = !!currCol.referencesTable;
    if (hadFk !== hasFk) {
      unsafe = true;
    }

    // FK action change — unsafe (SQLite requires table rebuild to change FK actions)
    if (prevCol.onDelete !== currCol.onDelete || prevCol.onUpdate !== currCol.onUpdate) {
      unsafe = true;
    }

    if (hasChanges) {
      ops.push(modifyColumn(tableName, name, changes));
    }
  }

  return { ops, unsafe };
}

// ---------------------------------------------------------------------------
// Diff two table definitions
// ---------------------------------------------------------------------------

function diffTable(tableName: string, prev: SerializedTable, curr: SerializedTable): MigrationOperation[] {
  const { ops: columnOps, unsafe } = diffColumns(tableName, prev.columns, curr.columns);

  // Any unsafe column change → rebuild entire table
  if (unsafe) {
    return [rebuildTable(tableName, prev, curr)];
  }

  // Composite primary key change → rebuild entire table
  const prevPK = prev.primaryKeyColumns ?? [];
  const currPK = curr.primaryKeyColumns ?? [];
  if (JSON.stringify(prevPK) !== JSON.stringify(currPK)) {
    return [rebuildTable(tableName, prev, curr)];
  }

  // All changes are safe → emit column-level ops + index changes
  const ops: MigrationOperation[] = [...columnOps];

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
    ops.push(dropTable(table.name, table.columns));
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

export type RenamePrompt = (message: string, options: { value: string; label: string; hint: string }[]) => Promise<string | symbol>;

export async function resolveRenames(
  operations: MigrationOperation[],
  options?: { interactive?: boolean; prompt?: RenamePrompt },
): Promise<MigrationOperation[]> {
  const interactive = options?.interactive ?? true;
  const prompt = options?.prompt;
  // Group potential renames by the "to" entity
  const renameGroups = new Map<string, PotentialRename[]>();

  // Find table renames: dropTable + addTable with overlapping columns
  const droppedTables = operations.filter((op): op is DropTableOp => op.type === 'dropTable');
  const addedTables = operations.filter((op): op is AddTableOp => op.type === 'addTable');

  for (const dropped of droppedTables) {
    for (const added of addedTables) {
      // Use columns embedded in the dropTable op for overlap heuristic
      const oldColNames = new Set((dropped.columns ?? []).map((c) => c.name));
      if (oldColNames.size === 0) continue;

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
    // Find dropped columns in the same table
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

  // In non-interactive mode, return operations as-is (drop + add, no rename resolution)
  if (!interactive) {
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

    // Build prompt options: "add" first, then available rename candidates
    const promptOptions = [
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

    if (!prompt) {
      continue;
    }

    const result = await prompt(`Is ${firstRename.to} ${entityLabel} added or renamed?`, promptOptions);

    if (typeof result === 'symbol') {
      throw new CancellationError('Operation cancelled.');
    }

    if (result !== 'add') {
      // Extract the "from" name from "rename:xxx"
      const fromName = result.replace('rename:', '');
      const rename = availableRenames.find((r) => r.from === fromName);
      if (!rename) {
        continue;
      }

      // Mark this drop as consumed
      consumedDrops.add(`${dropType}:${rename.tableName}:${rename.from}`);

      // Replace drop + add with rename operation
      const renameOp = rename.type === 'table' ? renameTable(rename.from, rename.to) : renameColumn(rename.tableName, rename.from, rename.to);

      // Remove the drop operation
      const dropIdx = resolvedOps.findIndex((op) => {
        if (op.type !== dropType) return false;
        if (rename.type === 'table') {
          return (op as DropTableOp).tableName === rename.from;
        }
        return (op as DropColumnOp).columnName === rename.from && (op as DropColumnOp).tableName === rename.tableName;
      });

      // Capture old columns before removing the drop op
      let oldColNames: Set<string> | undefined;
      if (dropIdx !== -1 && rename.type === 'table') {
        const dropOp = resolvedOps[dropIdx] as DropTableOp;
        oldColNames = new Set((dropOp.columns ?? []).map((c) => c.name));
        resolvedOps.splice(dropIdx, 1);
      } else if (dropIdx !== -1) {
        resolvedOps.splice(dropIdx, 1);
      }

      // Remove the add operation
      const addType = rename.type === 'table' ? 'addTable' : 'addColumn';
      const addIdx = resolvedOps.findIndex((op) => {
        if (op.type !== addType) return false;
        if (rename.type === 'table') {
          return (op as AddTableOp).table?.name === rename.to;
        }
        return (op as AddColumnOp).column?.name === rename.to && (op as AddColumnOp).tableName === rename.tableName;
      });

      // For table renames: extract new columns from the removed addTable and add them
      // as addColumn ops on the original table. The diff engine bundles all columns into
      // addTable for a "new" table, so columns that didn't exist in the dropped table
      // would be lost when we replace addTable with renameTable.
      if (rename.type === 'table' && addIdx !== -1 && oldColNames) {
        const addOp = resolvedOps[addIdx] as AddTableOp;
        for (const col of addOp.table.columns) {
          if (!oldColNames.has(col.name)) {
            resolvedOps.push(addColumn(rename.from, col));
          }
        }
      }

      if (addIdx !== -1) {
        resolvedOps.splice(addIdx, 1);
      }

      // For table renames: redirect any addColumn ops from the new name to the original.
      if (rename.type === 'table') {
        for (const op of resolvedOps) {
          if (op.type === 'addColumn' && op.tableName === rename.to) {
            op.tableName = rename.from;
          }
        }
      }

      // Add the rename operation
      resolvedOps.push(renameOp);
    }
  }

  return resolvedOps;
}
