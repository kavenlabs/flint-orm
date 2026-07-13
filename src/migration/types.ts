// ---------------------------------------------------------------------------
// Migration types — the shared vocabulary between serialize, diff, and SQL gen.
// ---------------------------------------------------------------------------

/** Serialized column definition — what lives in state.json. */
export interface SerializedColumn {
  name: string;
  sqlType: 'text' | 'integer' | 'real' | 'blob';
  isPrimaryKey: boolean;
  isAutoIncrement?: boolean;
  isNotNull: boolean;
  isUnique: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
  referencesTable?: string;
  referencesColumn?: string;
  onDelete?: string;
  onUpdate?: string;
}

/** Serialized table definition — what lives in state.json. */
export interface SerializedTable {
  name: string;
  columns: SerializedColumn[];
  indexes: SerializedIndex[];
  primaryKeyColumns?: string[];
}

/** Serialized index definition. */
export interface SerializedIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

/** Full schema state — the content of state.json. */
export interface SchemaState {
  version: number;
  tables: Record<string, SerializedTable>;
}

// ---------------------------------------------------------------------------
// Migration operations — the named, pre-vetted operations.
// ---------------------------------------------------------------------------

export interface AddTableOp {
  type: 'addTable';
  table: SerializedTable;
}

export interface DropTableOp {
  type: 'dropTable';
  tableName: string;
  columns?: SerializedColumn[];
}

export interface RenameTableOp {
  type: 'renameTable';
  from: string;
  to: string;
}

export interface AddColumnOp {
  type: 'addColumn';
  tableName: string;
  column: SerializedColumn;
}

export interface DropColumnOp {
  type: 'dropColumn';
  tableName: string;
  columnName: string;
}

export interface RenameColumnOp {
  type: 'renameColumn';
  tableName: string;
  from: string;
  to: string;
}

export interface CreateIndexOp {
  type: 'createIndex';
  tableName: string;
  index: SerializedIndex;
}

export interface DropIndexOp {
  type: 'dropIndex';
  indexName: string;
}

export interface ModifyColumnOp {
  type: 'modifyColumn';
  tableName: string;
  columnName: string;
  changes: {
    isNotNull?: boolean;
    hasDefault?: boolean;
    defaultValue?: unknown;
  };
}

export interface ModifyIndexOp {
  type: 'modifyIndex';
  tableName: string;
  indexName: string;
  from: SerializedIndex;
  to: SerializedIndex;
}

export interface RebuildTableOp {
  type: 'rebuildTable';
  tableName: string;
  oldTable: SerializedTable;
  newTable: SerializedTable;
}

export type MigrationOperation =
  | AddTableOp
  | DropTableOp
  | RenameTableOp
  | AddColumnOp
  | DropColumnOp
  | RenameColumnOp
  | CreateIndexOp
  | DropIndexOp
  | ModifyColumnOp
  | ModifyIndexOp
  | RebuildTableOp;

// ---------------------------------------------------------------------------
// Migration file shape
// ---------------------------------------------------------------------------

export interface MigrationFile {
  name: string;
  operations: MigrationOperation[];
}
