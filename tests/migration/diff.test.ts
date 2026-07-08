import { describe, test, expect } from "bun:test";
import { diffSchemas } from "../../src/migration/diff.js";
import type { SchemaState, AddTableOp, DropTableOp, AddColumnOp, DropColumnOp } from "../../src/migration/types.js";

describe("diffSchema", () => {
  test("detects added table", () => {
    const from: SchemaState = { version: 1, tables: {} };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("addTable");
    expect((ops[0] as AddTableOp).table.name).toBe("users");
  });

  test("detects dropped table", () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = { version: 1, tables: {} };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("dropTable");
    expect((ops[0] as DropTableOp).tableName).toBe("users");
  });

  test("detects added column", () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: "email", sqlType: "text", isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("addColumn");
    expect((ops[0] as AddColumnOp).column.name).toBe("email");
  });

  test("detects dropped column", () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: "email", sqlType: "text", isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("dropColumn");
    expect((ops[0] as DropColumnOp).columnName).toBe("email");
  });

  test("detects renamed column", () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: "name", sqlType: "text", isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: "full_name", sqlType: "text", isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    // Should detect as drop + add (no rename detection yet)
    expect(ops.length).toBeGreaterThanOrEqual(2);
  });

  test("detects added index", () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: "email", sqlType: "text", isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: "email", sqlType: "text", isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [{ name: "idx_users_email", columns: ["email"], unique: true }],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("createIndex");
  });

  test("detects dropped index", () => {
    const from: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: "email", sqlType: "text", isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [{ name: "idx_users_email", columns: ["email"], unique: true }],
        },
      },
    };
    const to: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
            { name: "email", sqlType: "text", isPrimaryKey: false, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(from, to);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("dropIndex");
  });

  test("returns empty array for identical schemas", () => {
    const schema: SchemaState = {
      version: 1,
      tables: {
        users: {
          name: "users",
          columns: [
            { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
          ],
          indexes: [],
        },
      },
    };

    const ops = diffSchemas(schema, schema);

    expect(ops).toHaveLength(0);
  });
});
