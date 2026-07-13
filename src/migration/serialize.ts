// ---------------------------------------------------------------------------
// Schema serialization — converts live table() definitions into a plain JSON
// representation that can be diffed and stored in state.json.
// ---------------------------------------------------------------------------

import type { ColumnDef } from '../schema/columns.js';
import type { AnyTable } from '../schema/table.js';
import type { SchemaState, SerializedColumn, SerializedIndex, SerializedTable } from './types.js';

// ---------------------------------------------------------------------------
// Serialize a single column
// ---------------------------------------------------------------------------

function serializeColumn(col: ColumnDef<any, any>): SerializedColumn {
  const internal = col.__internal;

  const result: SerializedColumn = {
    name: col.name,
    sqlType: internal.sqlType,
    isPrimaryKey: internal.isPrimaryKey,
    isAutoIncrement: internal.isAutoIncrement ?? false,
    isNotNull: internal.isNotNull,
    isUnique: internal.isUnique,
    hasDefault: internal.hasDefault,
    defaultValue: internal.defaultValue,
  };

  if (result.isAutoIncrement && !result.isPrimaryKey) {
    throw new Error(`Column "${col.name}": autoIncrement() requires primaryKey()`);
  }

  if (internal.referencesTable && internal.referencesColumn) {
    result.referencesTable = internal.referencesTable;
    result.referencesColumn = internal.referencesColumn;
    if (internal.onDelete && internal.onDelete !== 'no action') result.onDelete = internal.onDelete;
    if (internal.onUpdate && internal.onUpdate !== 'no action') result.onUpdate = internal.onUpdate;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Serialize a single table
// ---------------------------------------------------------------------------

function serializeTable(table: AnyTable): SerializedTable {
  const tableName = table._.name;
  const columns: SerializedColumn[] = [];
  const indexes: SerializedIndex[] = [];

  for (const [key, value] of Object.entries(table)) {
    if (key === '_') continue;
    // Only process ColumnDef objects (they have __internal)
    if (value && typeof value === 'object' && '__internal' in value) {
      columns.push(serializeColumn(value as ColumnDef<any, any>));
    }
  }

  // Check for table-level index definitions
  const tableObj = table as Record<string, unknown>;
  if (tableObj.__indexes) {
    for (const idx of tableObj.__indexes as SerializedIndex[]) {
      indexes.push({
        name: idx.name,
        columns: idx.columns,
        unique: idx.unique,
      });
    }
  }

  // Check for composite primary key definition
  let primaryKeyColumns: string[] | undefined;
  if (tableObj.__primaryKey) {
    const pkDef = tableObj.__primaryKey as { columns: string[] };
    primaryKeyColumns = pkDef.columns;

    // Validate: no column should have isPrimaryKey if composite PK is defined
    for (const col of columns) {
      if (col.isPrimaryKey) {
        throw new Error(
          `Column "${col.name}" has primaryKey() but table "${tableName}" also defines a composite primaryKey(). Use one or the other.`,
        );
      }
    }
  }

  return { name: tableName, columns, indexes, primaryKeyColumns };
}

// ---------------------------------------------------------------------------
// Public: serialize a full schema
// ---------------------------------------------------------------------------

export function serializeSchema(tables: AnyTable[]): SchemaState {
  const tableMap: Record<string, SerializedTable> = {};

  for (const t of tables) {
    const serialized = serializeTable(t);
    tableMap[serialized.name] = serialized;
  }

  return {
    version: 1,
    tables: tableMap,
  };
}
