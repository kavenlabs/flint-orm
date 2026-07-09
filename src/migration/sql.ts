// ---------------------------------------------------------------------------
// SQL generation — converts MigrationOperations into executable SQL.
// Each operation maps to exactly one known-correct SQL statement.
// ---------------------------------------------------------------------------

import type { MigrationOperation, SerializedColumn, SerializedIndex } from './types.js';

// ---------------------------------------------------------------------------
// Column → SQL type
// ---------------------------------------------------------------------------

function sqlType(col: SerializedColumn): string {
  return col.sqlType.toUpperCase();
}

// ---------------------------------------------------------------------------
// Single column → DDL fragment
// ---------------------------------------------------------------------------

function columnToDDL(col: SerializedColumn): string {
  const parts: string[] = [col.name, sqlType(col)];

  if (col.isPrimaryKey) parts.push('PRIMARY KEY');
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
    parts.push(`REFERENCES ${col.referencesTable}(${col.referencesColumn})`);
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
// Operation → SQL
// ---------------------------------------------------------------------------

function operationToSQL(op: MigrationOperation): string[] {
  switch (op.type) {
    case 'addTable': {
      const cols = op.table.columns.map(columnToDDL).join(',\n  ');
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

    case 'modifyIndex': {
      const unique = op.to.unique ? 'UNIQUE ' : '';
      const columns = op.to.columns.join(', ');
      return [`DROP INDEX IF EXISTS ${op.indexName}`, `CREATE ${unique}INDEX ${op.indexName} ON ${op.tableName} (${columns})`];
    }
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
