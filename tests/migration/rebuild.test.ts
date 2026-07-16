import { describe, test, expect } from 'bun:test';
import { diffSchemas } from '../../src/migration/diff';
import { generateSQL, generateSQLStatements } from '../../src/migration/sql';
import type { SchemaState, RebuildTableOp, ModifyColumnOp } from '../../src/migration/types';

// ---------------------------------------------------------------------------
// Helper — creates a minimal SerializedTable
// ---------------------------------------------------------------------------

function table(
  name: string,
  columns: {
    name: string;
    sqlType?: string;
    isPrimaryKey?: boolean;
    isNotNull?: boolean;
    hasDefault?: boolean;
    defaultValue?: unknown;
    referencesTable?: string;
    referencesColumn?: string;
    onDelete?: string;
    onUpdate?: string;
  }[],
  indexes: { name: string; columns: string[]; unique: boolean }[] = [],
) {
  return {
    name,
    columns: columns.map((c) => ({
      name: c.name,
      sqlType: (c.sqlType ?? 'text') as 'text' | 'integer' | 'real' | 'blob',
      isPrimaryKey: c.isPrimaryKey ?? false,
      isNotNull: c.isNotNull ?? false,
      isUnique: false,
      hasDefault: c.hasDefault ?? false,
      defaultValue: c.defaultValue,
      referencesTable: c.referencesTable,
      referencesColumn: c.referencesColumn,
      onDelete: c.onDelete,
      onUpdate: c.onUpdate,
    })),
    indexes,
  };
}

// ---------------------------------------------------------------------------
// Diff tests — unsafe changes produce rebuildTable ops
// ---------------------------------------------------------------------------

describe('diff: rebuildTable on unsafe changes', () => {
  test('type change produces rebuildTable', () => {
    const from: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'id', sqlType: 'text' }]) },
    };
    const to: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'id', sqlType: 'integer' }]) },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('rebuildTable');
    const rebuild = ops[0] as RebuildTableOp;
    expect(rebuild.tableName).toBe('users');
    expect(rebuild.oldTable.columns[0]!.sqlType).toBe('text');
    expect(rebuild.newTable.columns[0]!.sqlType).toBe('integer');
  });

  test('PRIMARY KEY change produces rebuildTable', () => {
    const from: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'id', sqlType: 'text', isPrimaryKey: true }]) },
    };
    const to: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'id', sqlType: 'text', isPrimaryKey: false }]) },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('rebuildTable');
  });

  test('NOT NULL removal produces rebuildTable', () => {
    const from: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'name', sqlType: 'text', isNotNull: true }]) },
    };
    const to: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'name', sqlType: 'text', isNotNull: false }]) },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('rebuildTable');
  });

  test('DEFAULT removal produces rebuildTable', () => {
    const from: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'role', sqlType: 'text', hasDefault: true, defaultValue: 'user' }]) },
    };
    const to: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'role', sqlType: 'text', hasDefault: false }]) },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('rebuildTable');
  });

  test('FK target change produces rebuildTable', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: table('users', [{ name: 'id', sqlType: 'text' }]),
        posts: table('posts', [{ name: 'user_id', sqlType: 'text', referencesTable: 'users', referencesColumn: 'id' }]),
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: table('users', [{ name: 'id', sqlType: 'text' }]),
        posts: table('posts', [{ name: 'user_id', sqlType: 'text', referencesTable: 'admins', referencesColumn: 'id' }]),
      },
    };

    const ops = diffSchemas(from, to);

    const rebuilds = ops.filter((op) => op.type === 'rebuildTable');
    expect(rebuilds).toHaveLength(1);
    expect((rebuilds[0] as RebuildTableOp).tableName).toBe('posts');
  });

  test('FK addition produces rebuildTable', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: table('users', [{ name: 'id', sqlType: 'text' }]),
        posts: table('posts', [{ name: 'user_id', sqlType: 'text' }]),
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: table('users', [{ name: 'id', sqlType: 'text' }]),
        posts: table('posts', [{ name: 'user_id', sqlType: 'text', referencesTable: 'users', referencesColumn: 'id' }]),
      },
    };

    const ops = diffSchemas(from, to);

    const rebuilds = ops.filter((op) => op.type === 'rebuildTable');
    expect(rebuilds).toHaveLength(1);
    expect((rebuilds[0] as RebuildTableOp).tableName).toBe('posts');
  });

  test('FK action change produces rebuildTable', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: table('users', [{ name: 'id', sqlType: 'text' }]),
        posts: table('posts', [{ name: 'user_id', sqlType: 'text', referencesTable: 'users', referencesColumn: 'id', onDelete: 'cascade' }]),
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: table('users', [{ name: 'id', sqlType: 'text' }]),
        posts: table('posts', [{ name: 'user_id', sqlType: 'text', referencesTable: 'users', referencesColumn: 'id', onDelete: 'set null' }]),
      },
    };

    const ops = diffSchemas(from, to);

    const rebuilds = ops.filter((op) => op.type === 'rebuildTable');
    expect(rebuilds).toHaveLength(1);
    expect((rebuilds[0] as RebuildTableOp).tableName).toBe('posts');
  });

  test('safe changes only — no rebuild', () => {
    const from: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'role', sqlType: 'text', isNotNull: false, hasDefault: false }]) },
    };
    const to: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'role', sqlType: 'text', isNotNull: true, hasDefault: true, defaultValue: 'user' }]) },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('modifyColumn');
    expect((ops[0] as ModifyColumnOp).changes.isNotNull).toBe(true);
  });

  test('mixed safe + unsafe → rebuild wins', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: table('users', [
          { name: 'id', sqlType: 'text' },
          { name: 'role', sqlType: 'text', isNotNull: false },
        ]),
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: table('users', [
          { name: 'id', sqlType: 'integer' },
          { name: 'role', sqlType: 'text', isNotNull: true, hasDefault: true, defaultValue: 'user' },
        ]),
      },
    };

    const ops = diffSchemas(from, to);

    // Type change is unsafe → rebuild (safe NOT NULL change is absorbed)
    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('rebuildTable');
  });

  test('new table with no data — rebuild works', () => {
    const from: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'id', sqlType: 'text' }]) },
    };
    const to: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'id', sqlType: 'integer' }]) },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('rebuildTable');
    // oldTable and newTable both present
    const rebuild = ops[0] as RebuildTableOp;
    expect(rebuild.oldTable).toBeDefined();
    expect(rebuild.newTable).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SQL generation tests
// ---------------------------------------------------------------------------

describe('SQL: rebuildTable', () => {
  test('generates correct rebuild SQL', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: table('users', [
          { name: 'id', sqlType: 'text' },
          { name: 'name', sqlType: 'text' },
        ]),
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: table('users', [
          { name: 'id', sqlType: 'integer' },
          { name: 'name', sqlType: 'text' },
        ]),
      },
    };

    const ops = diffSchemas(from, to);
    const sql = generateSQL(ops);

    expect(sql).toContain('PRAGMA defer_foreign_keys = 1');
    expect(sql).toContain('CREATE TABLE _flint_rebuild_users');
    expect(sql).toContain('INSERT INTO _flint_rebuild_users (id, name) SELECT id, name FROM users');
    expect(sql).toContain('DROP TABLE users');
    expect(sql).toContain('ALTER TABLE _flint_rebuild_users RENAME TO users');
  });

  test('rebuild with indexes recreates them', () => {
    const from: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'id', sqlType: 'text' }], [{ name: 'idx_users_id', columns: ['id'], unique: false }]) },
    };
    const to: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'id', sqlType: 'integer' }], [{ name: 'idx_users_id', columns: ['id'], unique: false }]) },
    };

    const ops = diffSchemas(from, to);
    const sql = generateSQL(ops);

    expect(sql).toContain('CREATE INDEX idx_users_id ON users (id)');
  });

  test('rebuild with FK preserves constraints', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: table('users', [{ name: 'id', sqlType: 'text' }]),
        posts: table('posts', [{ name: 'user_id', sqlType: 'text', referencesTable: 'users', referencesColumn: 'id', onDelete: 'cascade' }]),
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: table('users', [{ name: 'id', sqlType: 'text' }]),
        posts: table('posts', [{ name: 'user_id', sqlType: 'text', referencesTable: 'users', referencesColumn: 'id', onDelete: 'set null' }]),
      },
    };

    const ops = diffSchemas(from, to);
    const sql = generateSQL(ops);

    expect(sql).toContain('REFERENCES users(id)');
    expect(sql).toContain('ON DELETE SET NULL');
  });

  test('statements are individually executable', () => {
    const from: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'id', sqlType: 'text' }]) },
    };
    const to: SchemaState = {
      version: 1,
      tables: { users: table('users', [{ name: 'id', sqlType: 'integer' }]) },
    };

    const ops = diffSchemas(from, to);
    const stmts = generateSQLStatements(ops);

    // Each statement should be a valid SQL string
    for (const stmt of stmts) {
      expect(typeof stmt).toBe('string');
      expect(stmt.length).toBeGreaterThan(0);
    }

    // Should have: PRAGMA, CREATE TABLE, INSERT, DROP, ALTER (at minimum)
    expect(stmts.length).toBeGreaterThanOrEqual(5);
  });
});
