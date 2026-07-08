import { describe, test, expect } from "bun:test";
import {
  addTable,
  dropTable,
  renameTable,
  addColumn,
  dropColumn,
  renameColumn,
} from "../../src/migration/operations.js";

describe("addTable", () => {
  test("creates operation with table name", () => {
    const op = addTable({
      name: "users",
      columns: [],
      indexes: [],
    });

    expect(op.type).toBe("addTable");
    expect(op.table.name).toBe("users");
  });

  test("creates operation with columns", () => {
    const op = addTable({
      name: "users",
      columns: [
        { name: "id", sqlType: "text", isPrimaryKey: true, isNotNull: false, isUnique: false, hasDefault: false },
        { name: "name", sqlType: "text", isPrimaryKey: false, isNotNull: true, isUnique: false, hasDefault: false },
      ],
      indexes: [],
    });

    expect(op.table.columns).toHaveLength(2);
    expect(op.table.columns[0]!.name).toBe("id");
    expect(op.table.columns[1]!.name).toBe("name");
  });

  test("creates operation with indexes", () => {
    const op = addTable({
      name: "users",
      columns: [],
      indexes: [{ name: "idx_users_email", columns: ["email"], unique: true }],
    });

    expect(op.table.indexes).toHaveLength(1);
    expect(op.table.indexes[0]!.name).toBe("idx_users_email");
  });
});

describe("dropTable", () => {
  test("creates operation with table name", () => {
    const op = dropTable("users");

    expect(op.type).toBe("dropTable");
    expect(op.tableName).toBe("users");
  });
});

describe("renameTable", () => {
  test("creates operation with old and new names", () => {
    const op = renameTable("users", "customers");

    expect(op.type).toBe("renameTable");
    expect(op.from).toBe("users");
    expect(op.to).toBe("customers");
  });
});

describe("addColumn", () => {
  test("creates operation with column details", () => {
    const op = addColumn("users", {
      name: "email",
      sqlType: "text",
      isPrimaryKey: false,
      isNotNull: false,
      isUnique: false,
      hasDefault: false,
    });

    expect(op.type).toBe("addColumn");
    expect(op.tableName).toBe("users");
    expect(op.column.name).toBe("email");
    expect(op.column.sqlType).toBe("text");
  });

  test("creates operation with constraints", () => {
    const op = addColumn("users", {
      name: "email",
      sqlType: "text",
      isPrimaryKey: false,
      isNotNull: true,
      isUnique: true,
      hasDefault: false,
    });

    expect(op.column.isNotNull).toBe(true);
    expect(op.column.isUnique).toBe(true);
  });
});

describe("dropColumn", () => {
  test("creates operation with table and column names", () => {
    const op = dropColumn("users", "email");

    expect(op.type).toBe("dropColumn");
    expect(op.tableName).toBe("users");
    expect(op.columnName).toBe("email");
  });
});

describe("renameColumn", () => {
  test("creates operation with old and new column names", () => {
    const op = renameColumn("users", "name", "full_name");

    expect(op.type).toBe("renameColumn");
    expect(op.tableName).toBe("users");
    expect(op.from).toBe("name");
    expect(op.to).toBe("full_name");
  });
});
