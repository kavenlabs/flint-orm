// ---------------------------------------------------------------------------
// SQL generation — converts MigrationOperations into executable SQL.
// Each operation maps to exactly one known-correct SQL statement.
// ---------------------------------------------------------------------------

import type { MigrationOperation, SerializedColumn, SerializedIndex, RebuildTableOp } from './types.js';

// ---------------------------------------------------------------------------
// Column → SQL type
// ---------------------------------------------------------------------------

function sqlType(col: SerializedColumn): string {
  return col.sqlType.toUpperCase();
}

// ---------------------------------------------------------------------------
// Single column → DDL fragment
// ---------------------------------------------------------------------------

function columnToDDL(col: SerializedColumn, isCompositePK: boolean = false): string {
  const parts: string[] = [col.name, sqlType(col)];

  // Skip inline PRIMARY KEY for composite PK tables — it's emitted as a table constraint
  if (col.isPrimaryKey && !isCompositePK) parts.push('PRIMARY KEY');
  if (col.isAutoIncrement === true) parts.push('AUTOINCREMENT');
  if (col.isNotNull && !col.isPrimaryKey) parts.push('NOT NULL');
  if (col.isUnique && !col.isPrimaryKey) parts.push('UNIQUE');

  if (col.hasDefault) {
    const val = col.defaultValue;
    if (typeof val === 'string') {
      parts.push(`DEFAULT '${val.replace(/'/g, "''")}'`);
    } else if (val === null) {
      parts.push('DEFAULT NULL');
    } else {
      parts.push(`DEFAULT ${val}`);
    }
  }

  if (col.referencesTable && col.referencesColumn) {
    let fkClause = `REFERENCES ${col.referencesTable}(${col.referencesColumn})`;
    if (col.onDelete) fkClause += ` ON DELETE ${col.onDelete.toUpperCase()}`;
    if (col.onUpdate) fkClause += ` ON UPDATE ${col.onUpdate.toUpperCase()}`;
    parts.push(fkClause);
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Index → CREATE INDEX statement
// ---------------------------------------------------------------------------

function indexToSQL(idx: SerializedIndex, tableName: string): string {
  const unique = idx.unique ? 'UNIQUE ' : '';
  const cols = idx.columns.join(', ');
  return `CREATE ${unique}INDEX ${idx.name} ON ${tableName} (${cols})`;
}

// ---------------------------------------------------------------------------
// Format default value for SQL
// ---------------------------------------------------------------------------

function formatDefault(value: unknown): string {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

// ---------------------------------------------------------------------------
// Rebuild table → SQL (CREATE temp → copy → drop → rename → recreate indexes)
// ---------------------------------------------------------------------------

function rebuildTableToSQL(op: RebuildTableOp): string[] {
  const { tableName, oldTable, newTable } = op;
  const tempName = `_flint_rebuild_${tableName}`;

  const stmts: string[] = [];

  // Disable FK checks for the duration of the rebuild (transaction-scoped)
  stmts.push('PRAGMA defer_foreign_keys = 1');

  // Create temporary table with the new schema
  const isComposite = newTable.primaryKeyColumns && newTable.primaryKeyColumns.length > 0;
  const colDefs = newTable.columns.map((c) => columnToDDL(c, isComposite));
  if (isComposite) {
    colDefs.push(`PRIMARY KEY(${newTable.primaryKeyColumns!.join(', ')})`);
  }
  const cols = colDefs.join(',\n  ');
  stmts.push(`CREATE TABLE ${tempName} (\n  ${cols}\n)`);

  // Build explicit INSERT with column mapping.
  // Uses the NEW schema's column order so SQLite maps values correctly.
  // Columns only in new (added) get their DEFAULT via omitted column.
  // Columns only in old (dropped) are skipped.
  const oldColSet = new Set(oldTable.columns.map((c) => c.name));
  const insertCols: string[] = [];
  const selectExprs: string[] = [];

  for (const newCol of newTable.columns) {
    insertCols.push(newCol.name);
    if (oldColSet.has(newCol.name)) {
      // Column exists in old table — copy its value
      selectExprs.push(newCol.name);
    } else {
      // Column is new — use DEFAULT
      selectExprs.push(`DEFAULT`);
    }
  }

  stmts.push(`INSERT INTO ${tempName} (${insertCols.join(', ')}) SELECT ${selectExprs.join(', ')} FROM ${tableName}`);

  // Drop old table and rename temp to original
  stmts.push(`DROP TABLE ${tableName}`);
  stmts.push(`ALTER TABLE ${tempName} RENAME TO ${tableName}`);

  // Recreate indexes on the new table
  for (const idx of newTable.indexes) {
    stmts.push(indexToSQL(idx, tableName));
  }

  return stmts;
}

// ---------------------------------------------------------------------------
// Operation → SQL
// ---------------------------------------------------------------------------

function operationToSQL(op: MigrationOperation): string[] {
  switch (op.type) {
    case 'addTable': {
      const isComposite = op.table.primaryKeyColumns && op.table.primaryKeyColumns.length > 0;
      const colDefs = op.table.columns.map((c) => columnToDDL(c, isComposite));
      if (isComposite) {
        colDefs.push(`PRIMARY KEY(${op.table.primaryKeyColumns!.join(', ')})`);
      }
      const cols = colDefs.join(',\n  ');
      const stmts: string[] = [`CREATE TABLE ${op.table.name} (\n  ${cols}\n)`];
      for (const idx of op.table.indexes) {
        stmts.push(indexToSQL(idx, op.table.name));
      }
      return stmts;
    }

    case 'dropTable':
      return [`DROP TABLE ${op.tableName}`];

    case 'renameTable':
      return [`ALTER TABLE ${op.from} RENAME TO ${op.to}`];

    case 'addColumn':
      return [`ALTER TABLE ${op.tableName} ADD COLUMN ${columnToDDL(op.column)}`];

    case 'dropColumn':
      return [`ALTER TABLE ${op.tableName} DROP COLUMN ${op.columnName}`];

    case 'renameColumn':
      return [`ALTER TABLE ${op.tableName} RENAME COLUMN ${op.from} TO ${op.to}`];

    case 'createIndex':
      return [indexToSQL(op.index, op.tableName)];

    case 'dropIndex':
      return [`DROP INDEX ${op.indexName}`];

    case 'modifyColumn': {
      const stmts: string[] = [];
      if (op.changes.isNotNull !== undefined && op.changes.isNotNull) {
        stmts.push(`ALTER TABLE ${op.tableName} ALTER COLUMN ${op.columnName} SET NOT NULL`);
      }
      if (op.changes.hasDefault !== undefined) {
        if (op.changes.hasDefault && op.changes.defaultValue !== undefined) {
          const val = formatDefault(op.changes.defaultValue);
          stmts.push(`ALTER TABLE ${op.tableName} ALTER COLUMN ${op.columnName} SET DEFAULT ${val}`);
        } else if (!op.changes.hasDefault) {
          stmts.push(`ALTER TABLE ${op.tableName} ALTER COLUMN ${op.columnName} DROP DEFAULT`);
        }
      }
      return stmts;
    }

    case 'modifyIndex':
      return [`DROP INDEX IF EXISTS ${op.indexName}`, indexToSQL(op.to, op.tableName)];

    case 'rebuildTable':
      return rebuildTableToSQL(op);
  }
}

// ---------------------------------------------------------------------------
// Public: generate SQL from operations
// ---------------------------------------------------------------------------

export function generateSQL(operations: MigrationOperation[]): string {
  return operations.flatMap(operationToSQL).join(';\n') + ';';
}

/**
 * Generate individual SQL statements from migration operations.
 * Each operation may produce one or more statements (e.g., CREATE TABLE + indexes).
 *
 * @internal Used by the migration runner to execute statements individually.
 */
export function generateSQLStatements(operations: MigrationOperation[]): string[] {
  return operations.flatMap(operationToSQL);
}
