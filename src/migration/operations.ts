// ---------------------------------------------------------------------------
// Named operation builders — each returns a MigrationOperation.
// These are the only way to create operations; no raw object literals.
// ---------------------------------------------------------------------------

import type {
  AddTableOp,
  DropTableOp,
  RenameTableOp,
  AddColumnOp,
  DropColumnOp,
  RenameColumnOp,
  CreateIndexOp,
  DropIndexOp,
  SerializedColumn,
  SerializedIndex,
  SerializedTable,
} from './types.js';

export function addTable(table: Omit<SerializedTable, 'indexes'> & { indexes?: SerializedIndex[] }): AddTableOp {
  return { type: 'addTable', table: { ...table, indexes: table.indexes ?? [] } };
}

export function dropTable(tableName: string): DropTableOp {
  return { type: 'dropTable', tableName };
}

export function renameTable(from: string, to: string): RenameTableOp {
  return { type: 'renameTable', from, to };
}

export function addColumn(tableName: string, column: SerializedColumn): AddColumnOp {
  return { type: 'addColumn', tableName, column };
}

export function dropColumn(tableName: string, columnName: string): DropColumnOp {
  return { type: 'dropColumn', tableName, columnName };
}

export function renameColumn(tableName: string, from: string, to: string): RenameColumnOp {
  return { type: 'renameColumn', tableName, from, to };
}

export function createIndex(tableName: string, index: SerializedIndex): CreateIndexOp {
  return { type: 'createIndex', tableName, index };
}

export function dropIndex(indexName: string): DropIndexOp {
  return { type: 'dropIndex', indexName };
}
