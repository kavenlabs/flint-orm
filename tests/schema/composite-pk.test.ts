import { describe, test, expect } from 'bun:test';
import { table, primaryKey, index } from '../../src/schema/table.js';
import { text } from '../../src/schema/columns.js';
import { serializeSchema } from '../../src/migration/serialize.js';
import { diffSchemas } from '../../src/migration/diff.js';
import { generateSQL } from '../../src/migration/sql.js';
import type { SchemaState } from '../../src/migration/types.js';

// ---------------------------------------------------------------------------
// Schema definition tests
// ---------------------------------------------------------------------------

describe('primaryKey() builder', () => {
  test('creates composite primary key on table', () => {
    const userRoles = table(
      'user_roles',
      {
        userId: text('user_id'),
        roleId: text('role_id'),
      },
      (t) => [primaryKey().on(t.userId, t.roleId)],
    );

    const tableObj = userRoles as Record<string, unknown>;
    expect(tableObj.__primaryKey).toEqual({ columns: ['user_id', 'role_id'] });
  });

  test('creates composite primary key with three columns', () => {
    const memberships = table(
      'memberships',
      {
        orgId: text('org_id'),
        userId: text('user_id'),
        role: text('role'),
      },
      (t) => [primaryKey().on(t.orgId, t.userId, t.role)],
    );

    const tableObj = memberships as Record<string, unknown>;
    expect(tableObj.__primaryKey).toEqual({ columns: ['org_id', 'user_id', 'role'] });
  });

  test('can coexist with regular indexes', () => {
    const userRoles = table(
      'user_roles',
      {
        userId: text('user_id'),
        roleId: text('role_id'),
      },
      (t) => [primaryKey().on(t.userId, t.roleId), index('idx_role').on(t.roleId)],
    );

    const tableObj = userRoles as Record<string, unknown>;
    expect(tableObj.__primaryKey).toEqual({ columns: ['user_id', 'role_id'] });
    expect(tableObj.__indexes).toHaveLength(1);
  });

  test('throws when no columns provided', () => {
    const builder = primaryKey();
    expect(() => builder.build()).toThrow('primaryKey() has no columns');
  });

  test('throws when mixing column-level and composite PK', () => {
    expect(() =>
      table(
        'user_roles',
        {
          userId: text('user_id').primaryKey(),
          roleId: text('role_id'),
        },
        (t) => [primaryKey().on(t.userId, t.roleId)],
      ),
    ).toThrow('also defines a composite primaryKey');
  });
});

// ---------------------------------------------------------------------------
// Serialization tests
// ---------------------------------------------------------------------------

describe('serialize: composite primary key', () => {
  test('serializes composite PK into primaryKeyColumns', () => {
    const userRoles = table(
      'user_roles',
      {
        userId: text('user_id'),
        roleId: text('role_id'),
      },
      (t) => [primaryKey().on(t.userId, t.roleId)],
    );

    const state = serializeSchema([userRoles]);
    const serialized = state.tables['user_roles']!;

    expect(serialized.primaryKeyColumns).toEqual(['user_id', 'role_id']);
    // Individual columns should NOT have isPrimaryKey
    expect(serialized.columns[0]!.isPrimaryKey).toBe(false);
    expect(serialized.columns[1]!.isPrimaryKey).toBe(false);
  });

  test('single-column PK still uses isPrimaryKey', () => {
    const users = table('users', {
      id: text('id').primaryKey(),
    });

    const state = serializeSchema([users]);
    const serialized = state.tables['users']!;

    expect(serialized.primaryKeyColumns).toBeUndefined();
    expect(serialized.columns[0]!.isPrimaryKey).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SQL generation tests
// ---------------------------------------------------------------------------

describe('SQL: composite primary key', () => {
  test('generates table-level PRIMARY KEY constraint', () => {
    const userRoles = table(
      'user_roles',
      {
        userId: text('user_id'),
        roleId: text('role_id'),
      },
      (t) => [primaryKey().on(t.userId, t.roleId)],
    );

    const state = serializeSchema([userRoles]);
    const ops = diffSchemas({ version: 1, tables: {} }, state);
    const sql = generateSQL(ops);

    expect(sql).toContain('PRIMARY KEY(user_id, role_id)');
    expect(sql).not.toMatch(/user_id.*TEXT PRIMARY KEY/);
    expect(sql).not.toMatch(/role_id.*TEXT PRIMARY KEY/);
  });

  test('generates correct SQL for three-column composite PK', () => {
    const memberships = table(
      'memberships',
      {
        orgId: text('org_id'),
        userId: text('user_id'),
        role: text('role'),
      },
      (t) => [primaryKey().on(t.orgId, t.userId, t.role)],
    );

    const state = serializeSchema([memberships]);
    const ops = diffSchemas({ version: 1, tables: {} }, state);
    const sql = generateSQL(ops);

    expect(sql).toContain('PRIMARY KEY(org_id, user_id, role)');
  });
});

// ---------------------------------------------------------------------------
// Diff tests
// ---------------------------------------------------------------------------

describe('diff: composite primary key changes', () => {
  test('adding composite PK triggers rebuildTable', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        user_roles: {
          name: 'user_roles',
          columns: [
            { name: 'user_id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'role_id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        user_roles: {
          name: 'user_roles',
          columns: [
            { name: 'user_id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'role_id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
          primaryKeyColumns: ['user_id', 'role_id'],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('rebuildTable');
  });

  test('changing composite PK columns triggers rebuildTable', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        user_roles: {
          name: 'user_roles',
          columns: [
            { name: 'user_id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'role_id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
          primaryKeyColumns: ['user_id'],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        user_roles: {
          name: 'user_roles',
          columns: [
            { name: 'user_id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'role_id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
          primaryKeyColumns: ['user_id', 'role_id'],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('rebuildTable');
  });

  test('no rebuild when composite PK is unchanged', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        user_roles: {
          name: 'user_roles',
          columns: [
            { name: 'user_id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'role_id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
          primaryKeyColumns: ['user_id', 'role_id'],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        user_roles: {
          name: 'user_roles',
          columns: [
            { name: 'user_id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'role_id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
          primaryKeyColumns: ['user_id', 'role_id'],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(0);
  });
});
