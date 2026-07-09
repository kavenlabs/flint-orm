import { describe, test, expect } from 'bun:test';
import { diffSchemas } from '../../src/migration/diff.js';
import type { SchemaState, AddTableOp, DropTableOp, AddColumnOp, DropColumnOp, ModifyColumnOp, ModifyIndexOp } from '../../src/migration/types.js';

describe('diffSchema', () => {
  test('detects added table', () => {
    const from: SchemaState = { version: 1, tables: {} };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [{ name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false }],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('addTable');
    expect((ops[0] as AddTableOp).table.name).toBe('users');
  });

  test('detects dropped table', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [{ name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false }],
          indexes: [],
        },
      },
    };
    const to: SchemaState = { version: 1, tables: {} };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('dropTable');
    expect((ops[0] as DropTableOp).tableName).toBe('users');
  });

  test('detects added column', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [{ name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false }],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('addColumn');
    expect((ops[0] as AddColumnOp).column.name).toBe('email');
  });

  test('detects dropped column', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [{ name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false }],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('dropColumn');
    expect((ops[0] as DropColumnOp).columnName).toBe('email');
  });

  test('detects added index', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('createIndex');
  });

  test('detects dropped index', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('dropIndex');
  });

  test('returns empty array for identical schemas', () => {
    const schema: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [{ name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false }],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(schema, schema);

    expect(ops).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Column modification detection
  // ---------------------------------------------------------------------------

  test('detects NOT NULL addition with default', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: true, defaultValue: '' },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: true, isUnique: false, hasDefault: true, defaultValue: '' },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('modifyColumn');
    expect((ops[0] as ModifyColumnOp).columnName).toBe('email');
    expect((ops[0] as ModifyColumnOp).changes.isNotNull).toBe(true);
  });

  test('throws on NOT NULL addition without default', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: true, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    expect(() => diffSchemas(from, to)).toThrow('adding NOT NULL requires a DEFAULT value');
  });

  test('throws on NOT NULL removal', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: true, isUnique: false, hasDefault: true, defaultValue: '' },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: true, defaultValue: '' },
          ],
          indexes: [],
        },
      },
    };

    expect(() => diffSchemas(from, to)).toThrow('removing NOT NULL requires a table rebuild');
  });

  test('throws on type change', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'age', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'age', sqlType: 'integer', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    expect(() => diffSchemas(from, to)).toThrow('type change');
  });

  test('throws on PRIMARY KEY change', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [{ name: 'id', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false }],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [{ name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false }],
          indexes: [],
        },
      },
    };

    expect(() => diffSchemas(from, to)).toThrow('PRIMARY KEY change');
  });

  test('throws on UNIQUE addition', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: true, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    expect(() => diffSchemas(from, to)).toThrow('adding UNIQUE requires creating a unique index');
  });

  test('throws on UNIQUE removal', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: true, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    expect(() => diffSchemas(from, to)).toThrow('removing UNIQUE requires dropping the unique index');
  });

  test('detects DEFAULT addition', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'status', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'status', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: true, defaultValue: 'active' },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('modifyColumn');
    expect((ops[0] as ModifyColumnOp).changes.hasDefault).toBe(true);
    expect((ops[0] as ModifyColumnOp).changes.defaultValue).toBe('active');
  });

  test('throws on DEFAULT removal', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'status', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: true, defaultValue: 'active' },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'status', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    expect(() => diffSchemas(from, to)).toThrow('removing DEFAULT requires a table rebuild');
  });

  test('detects DEFAULT value change', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'status', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: true, defaultValue: 'old' },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'status', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: true, defaultValue: 'new' },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('modifyColumn');
    expect((ops[0] as ModifyColumnOp).changes.defaultValue).toBe('new');
  });

  // ---------------------------------------------------------------------------
  // Index modification detection
  // ---------------------------------------------------------------------------

  test('detects index column list change', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'name', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [{ name: 'idx_users_email', columns: ['email'], unique: false }],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'name', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [{ name: 'idx_users_email', columns: ['email', 'name'], unique: false }],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('modifyIndex');
    expect((ops[0] as ModifyIndexOp).indexName).toBe('idx_users_email');
    expect((ops[0] as ModifyIndexOp).to.columns).toEqual(['email', 'name']);
  });

  test('detects index unique flag change', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [{ name: 'idx_users_email', columns: ['email'], unique: false }],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('modifyIndex');
    expect((ops[0] as ModifyIndexOp).to.unique).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Rename detection (now produces drop + add, renames resolved via interactive prompts)
  // ---------------------------------------------------------------------------

  test('produces drop + add for column rename candidates', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'name', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'full_name', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    // Should produce drop + add (rename resolved via interactive prompts)
    expect(ops).toHaveLength(2);
    expect(ops.some((op) => op.type === 'dropColumn')).toBe(true);
    expect(ops.some((op) => op.type === 'addColumn')).toBe(true);
  });

  test('produces drop + add for table rename candidates', () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        accounts: {
          name: 'accounts',
          columns: [
            { name: 'id', sqlType: 'text', isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: 'email', sqlType: 'text', isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    // Should produce drop + add (rename resolved via interactive prompts)
    expect(ops).toHaveLength(2);
    expect(ops.some((op) => op.type === 'dropTable')).toBe(true);
    expect(ops.some((op) => op.type === 'addTable')).toBe(true);
  });
});
