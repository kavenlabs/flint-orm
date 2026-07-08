import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { introspect } from "../../src/sqlite/introspect.js";

let db: Database;

beforeAll(() => {
  db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE
    );

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      user_id TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX idx_posts_user_id ON posts(user_id);
    CREATE UNIQUE INDEX idx_users_email ON users(email);
  `);
});

afterAll(() => {
  db.close();
});

describe("introspect", () => {
  test("discovers all tables", () => {
    const schema = introspect(db);

    expect(Object.keys(schema.tables)).toContain("users");
    expect(Object.keys(schema.tables)).toContain("posts");
  });

  test("discovers columns with correct types", () => {
    const schema = introspect(db);
    const users = schema.tables["users"]!;

    const id = users.columns.find((c) => c.name === "id")!;
    expect(id.sqlType).toBe("text");
    expect(id.isPrimaryKey).toBe(true);

    const name = users.columns.find((c) => c.name === "name")!;
    expect(name.sqlType).toBe("text");
    expect(name.isNotNull).toBe(true);
  });

  test("discovers auto-increment columns", () => {
    const schema = introspect(db);
    const posts = schema.tables["posts"]!;

    const id = posts.columns.find((c) => c.name === "id")!;
    expect(id.sqlType).toBe("integer");
    expect(id.isPrimaryKey).toBe(true);
  });

  test("discovers foreign keys as column references", () => {
    const schema = introspect(db);
    const posts = schema.tables["posts"]!;

    const userId = posts.columns.find((c) => c.name === "user_id")!;
    expect(userId.referencesTable).toBe("users");
    expect(userId.referencesColumn).toBe("id");
  });

  test("discovers indexes", () => {
    const schema = introspect(db);
    const posts = schema.tables["posts"]!;

    expect(posts.indexes.length).toBeGreaterThanOrEqual(1);
    const idx = posts.indexes.find((i) => i.name === "idx_posts_user_id")!;
    expect(idx.columns).toContain("user_id");
    expect(idx.unique).toBe(false);
  });

  test("discovers unique indexes", () => {
    const schema = introspect(db);
    const users = schema.tables["users"]!;

    const idx = users.indexes.find((i) => i.name === "idx_users_email")!;
    expect(idx.unique).toBe(true);
  });

  test("discovers unique columns", () => {
    const schema = introspect(db);
    const users = schema.tables["users"]!;

    const email = users.columns.find((c) => c.name === "email")!;
    expect(email.isUnique).toBe(true);
  });
});
