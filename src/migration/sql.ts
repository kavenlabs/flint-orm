// ---------------------------------------------------------------------------
// SQL generation — converts MigrationOperations into executable SQL.
// Each operation maps to exactly one known-correct SQL statement.
// ---------------------------------------------------------------------------

import type { MigrationOperation, SerializedColumn, SerializedIndex, SerializedTable } from './types.js';

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
// Operation → SQL
// ---------------------------------------------------------------------------

function operationToSQL(op: MigrationOperation): string {
  switch (op.type) {
    case 'addTable': {
      const cols = op.table.columns.map(columnToDDL).join(',\n  ');
      let sql = `CREATE TABLE ${op.table.name} (\n  ${cols}\n)`;
      // Add table-level indexes after the CREATE TABLE
      const indexes = op.table.indexes.map((idx) => indexToSQL(idx, op.table.name));
      if (indexes.length > 0) {
        sql += ';\n' + indexes.join(';\n');
      }
      return sql;
    }

    case 'dropTable':
      return `DROP TABLE ${op.tableName}`;

    case 'renameTable':
      return `ALTER TABLE ${op.from} RENAME TO ${op.to}`;

    case 'addColumn':
      return `ALTER TABLE ${op.tableName} ADD COLUMN ${columnToDDL(op.column)}`;

    case 'dropColumn':
      return `ALTER TABLE ${op.tableName} DROP COLUMN ${op.columnName}`;

    case 'renameColumn':
      return `ALTER TABLE ${op.tableName} RENAME COLUMN ${op.from} TO ${op.to}`;

    case 'createIndex':
      return indexToSQL(op.index, op.tableName);

    case 'dropIndex':
      return `DROP INDEX ${op.indexName}`;
  }
}

// ---------------------------------------------------------------------------
// Public: generate SQL from operations
// ---------------------------------------------------------------------------

export function generateSQL(operations: MigrationOperation[]): string {
  return operations.map(operationToSQL).join(';\n') + ';';
}
