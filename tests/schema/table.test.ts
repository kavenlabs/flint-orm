import { describe, test, expect } from 'bun:test';
import { table } from '../../src/schema/table.js';
import { text, integer, boolean, json, date } from '../../src/schema/columns.js';

describe('table', () => {
  test('creates table with name', () => {
    const users = table('users', {});

    expect(users._.name).toBe('users');
  });

  test('creates table with columns', () => {
    const users = table('users', {
      id: text().primaryKey(),
      name: text().notNull(),
    });

    expect(users.id).toBeDefined();
    expect(users.name).toBeDefined();
  });

  test('column has correct SQL type', () => {
    const users = table('users', {
      id: text(),
      age: integer(),
      active: boolean(),
      data: json(),
      createdAt: date(),
    });

    expect(users.id.__internal.sqlType).toBe('text');
    expect(users.age.__internal.sqlType).toBe('integer');
    expect(users.active.__internal.sqlType).toBe('integer');
    expect(users.data.__internal.sqlType).toBe('text');
    expect(users.createdAt.__internal.sqlType).toBe('integer');
  });

  test('column has primary key constraint', () => {
    const users = table('users', {
      id: text().primaryKey(),
    });

    expect(users.id.__internal.isPrimaryKey).toBe(true);
  });

  test('column has not null constraint', () => {
    const users = table('users', {
      name: text().notNull(),
    });

    expect(users.name.__internal.isNotNull).toBe(true);
  });

  test('column has unique constraint', () => {
    const users = table('users', {
      email: text().unique(),
    });

    expect(users.email.__internal.isUnique).toBe(true);
  });

  test('column has default value', () => {
    const users = table('users', {
      name: text().default('unknown'),
    });

    expect(users.name.__internal.hasDefault).toBe(true);
  });

  test('column has auto increment', () => {
    const users = table('users', {
      id: integer().primaryKey().autoIncrement(),
    });

    expect(users.id.__internal.isAutoIncrement).toBe(true);
  });

  test('column has references', () => {
    const users = table('users', {
      id: text().primaryKey(),
    });

    const posts = table('posts', {
      userId: text().references(users.id),
    });

    expect(posts.userId.__internal.referencesTable).toBe('users');
    expect(posts.userId.__internal.referencesColumn).toBe('id');
  });
});
