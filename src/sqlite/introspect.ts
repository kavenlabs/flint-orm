// ---------------------------------------------------------------------------
// SQLite introspection — reads the live database schema and returns a
// SchemaState that can be diffed against code-defined tables.
// ---------------------------------------------------------------------------

import type { Database } from 'bun:sqlite';
import type { SchemaState, SerializedTable, SerializedColumn, SerializedIndex } from '../migration/types.js';

// ---------------------------------------------------------------------------
// Column type normalization — map SQLite type strings to canonical types
// ---------------------------------------------------------------------------

const TEXT_TYPES = new Set(['text', 'varchar', 'character', 'char', 'clob', 'native character', 'nvarchar', 'nchar', 'nyclob', 'numeric']);

const INTEGER_TYPES = new Set(['integer', 'int', 'smallint', 'tinyint', 'bigint', 'unsigned big int', 'int2', 'int8', 'mediumint']);

const REAL_TYPES = new Set(['real', 'float', 'double', 'double precision', 'decimal']);

function normalizeType(rawType: string): 'text' | 'integer' | 'real' | 'blob' {
  const t = rawType.toLowerCase().trim();
  // Handle types with size like VARCHAR(255)
  const base = t.replace(/\(.*\)/, '').trim();

  if (INTEGER_TYPES.has(base)) return 'integer';
  if (REAL_TYPES.has(base)) return 'real';
  if (TEXT_TYPES.has(base)) return 'text';
  if (base === 'blob') return 'blob';
  // Default to text for unknown types
  return 'text';
}

// ---------------------------------------------------------------------------
// Parse default value from PRAGMA table_info
// ---------------------------------------------------------------------------

function parseDefault(dfltValue: unknown): { hasDefault: boolean; defaultValue?: unknown } {
  if (dfltValue === null || dfltValue === undefined) {
    return { hasDefault: false };
  }

  const raw = String(dfltValue);

  // NULL
  if (raw.toUpperCase() === 'NULL') {
    return { hasDefault: true, defaultValue: null };
  }

  // Integer
  if (/^-?\d+$/.test(raw)) {
    return { hasDefault: true, defaultValue: Number(raw) };
  }

  // Real
  if (/^-?\d+\.\d+$/.test(raw)) {
    return { hasDefault: true, defaultValue: Number(raw) };
  }

  // String (strip quotes)
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return { hasDefault: true, defaultValue: raw.slice(1, -1) };
  }

  // Expression (e.g. CURRENT_TIMESTAMP, (abs(random()) % 1000000000) + 1000000000)
  // Store as-is — it's a SQL expression
  return { hasDefault: true, defaultValue: raw };
}

// ---------------------------------------------------------------------------
// Introspect a single table's columns
// ---------------------------------------------------------------------------

function introspectColumns(
  client: Database,
  tableName: string,
): { columns: SerializedColumn[]; indexRows: { name: string; unique: number; origin: string }[] } {
  const rows = client.query(`PRAGMA table_info('${tableName}')`).all() as {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }[];

  // Get FK info for this table
  const fkRows = client.query(`PRAGMA foreign_key_list('${tableName}')`).all() as {
    id: number;
    seq: number;
    table: string;
    from: string;
    to: string;
    on_update: string;
    on_delete: string;
    match: string;
  }[];

  // Get index info (needed to detect UNIQUE constraints from autoindexes)
  const indexRows = client.query(`PRAGMA index_list('${tableName}')`).all() as {
    seq: number;
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }[];

  // Build FK map: column name → { referencesTable, referencesColumn }
  const fkMap = new Map<string, { referencesTable: string; referencesColumn: string }>();
  for (const fk of fkRows) {
    fkMap.set(fk.from, { referencesTable: fk.table, referencesColumn: fk.to });
  }

  // Build set of columns with UNIQUE constraint
  // Check both autoindexes (origin "u" for UNIQUE constraint) and explicit indexes (origin "c" for CREATE INDEX)
  const uniqueColumns = new Set<string>();
  for (const idx of indexRows) {
    if (idx.unique === 1 && (idx.origin === 'u' || idx.origin === 'c')) {
      // Get the column name for this unique index
      const colInfo = client.query(`PRAGMA index_info('${idx.name}')`).all() as { name: string }[];
      if (colInfo.length === 1) {
        uniqueColumns.add(colInfo[0]!.name);
      }
    }
  }

  const columns = rows.map((row) => {
    const fk = fkMap.get(row.name);
    const { hasDefault, defaultValue } = parseDefault(row.dflt_value);

    const col: SerializedColumn = {
      name: row.name,
      sqlType: normalizeType(row.type),
      isPrimaryKey: row.pk === 1,
      isNotNull: row.notnull === 1,
      isUnique: uniqueColumns.has(row.name),
      hasDefault,
      defaultValue,
    };

    if (fk) {
      col.referencesTable = fk.referencesTable;
      col.referencesColumn = fk.referencesColumn;
    }

    return col;
  });

  return { columns, indexRows };
}

// ---------------------------------------------------------------------------
// Introspect a single table's indexes
// ---------------------------------------------------------------------------

function introspectIndexes(client: Database, indexRows: { name: string; unique: number; origin: string }[]): SerializedIndex[] {
  const indexes: SerializedIndex[] = [];

  for (const idx of indexRows) {
    // Skip auto-generated indexes (sqlite_autoindex_ prefix)
    // These are created by PRIMARY KEY and UNIQUE constraints
    if (idx.name.startsWith('sqlite_autoindex_')) continue;

    // Get index columns
    const colRows = client.query(`PRAGMA index_info('${idx.name}')`).all() as {
      seqno: number;
      cid: number;
      name: string;
    }[];

    const columns = colRows.map((c) => c.name);

    indexes.push({
      name: idx.name,
      columns,
      unique: idx.unique === 1,
    });
  }

  return indexes;
}

// ---------------------------------------------------------------------------
// Public: introspect a database
// ---------------------------------------------------------------------------

/**
 * Read the live database schema and return a SchemaState.
 *
 * This reads tables, columns, indexes, and foreign key references from
 * the SQLite database using PRAGMAs.
 *
 * @param client - The bun:sqlite Database instance
 * @returns SchemaState representing the live database schema
 *
 * @example
 * import { Database } from "bun:sqlite";
 * import { introspect } from "flint-orm/sqlite/introspect";
 *
 * const client = new Database("app.db");
 * const state = introspect(client);
 */
export function introspect(client: Database): SchemaState {
  // Get all user tables (exclude internal tables)
  const tableRows = client
    .query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__flint_migrations'`)
    .all() as { name: string }[];

  const tables: Record<string, SerializedTable> = {};

  for (const { name } of tableRows) {
    const { columns, indexRows } = introspectColumns(client, name);
    const indexes = introspectIndexes(client, indexRows);

    tables[name] = {
      name,
      columns,
      indexes,
    };
  }

  return {
    version: 1,
    tables,
  };
}
