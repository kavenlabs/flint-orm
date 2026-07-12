import { describe, test, expect, beforeEach } from 'bun:test';
import { connect } from '@tursodatabase/database';
import { TursoExecutor } from '../../src/drivers/turso';
import { createClient } from '../../src/flint';
import { text, integer, date } from '../../src/schema/columns';
import { snakeCase } from '../../src/schema/table';
import { eq } from '../../src/query/conditions';
import type { JoinResult } from '../../src/flint';
import type { InferRow, InsertRow } from '../../src/schema/table';

const users = snakeCase.table('test_users', {
  id: integer().autoIncrement().primaryKey(),
  name: text().notNull(),
  email: text().unique(),
  age: integer(),
  createdAt: date().defaultNow(),
});

const posts = snakeCase.table('test_posts', {
  id: integer().autoIncrement().primaryKey(),
  userId: integer().references(users.id),
  title: text().notNull(),
});

let db: Awaited<ReturnType<typeof connect>>;
let executor: TursoExecutor;
let client: ReturnType<typeof createClient>;

beforeEach(async () => {
  db = await connect(':memory:');
  executor = new TursoExecutor(db);
  client = createClient(executor);

  await db.run(`
    CREATE TABLE test_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      age INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(`
    CREATE TABLE test_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES test_users(id),
      title TEXT NOT NULL
    )
  `);
});

describe('TursoExecutor', () => {
  test('all() returns rows', async () => {
    await client.insert(users).values({ name: 'Alice', email: 'alice@test.com', age: 30 }).execute();
    const rows = await client.selectFrom(users).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Alice');
  });

  test('get() returns single row', async () => {
    await client.insert(users).values({ name: 'Bob', email: 'bob@test.com', age: 25 }).execute();
    const row = await client.selectFrom(users).where(eq(users.name, 'Bob')).single().execute();
    expect(row).not.toBeNull();
    expect(row!.name).toBe('Bob');
  });

  test('get() returns null for no match', async () => {
    const row = await client.selectFrom(users).where(eq(users.name, 'nobody')).single().execute();
    expect(row).toBeNull();
  });

  test('transaction() commits', async () => {
    await client.batch([
      client.insert(users).values({ name: 'Dave', age: 40 } as InsertRow<typeof users>),
      client.insert(users).values({ name: 'Eve', age: 45 } as InsertRow<typeof users>),
    ]);
    const rows = await client.selectFrom(users).execute();
    expect(rows).toHaveLength(2);
  });

  test('transaction() rolls back on error', async () => {
    try {
      await executor.transaction(async () => {
        await executor.run("INSERT INTO test_users (name, email, age, created_at) VALUES ('Frank', 'frank@test.com', 50, 6000)", []);
        throw new Error('rollback');
      });
    } catch {
      // expected
    }
    const rows = await executor.all('SELECT * FROM test_users', []);
    expect(rows).toHaveLength(0);
  });
});

describe('query builder via executor', () => {
  beforeEach(async () => {
    await client.insert(users).values({ name: 'Alice', email: 'alice@test.com', age: 30 }).execute();
    await client.insert(users).values({ name: 'Bob', email: 'bob@test.com', age: 25 }).execute();
    await client.insert(posts).values({ userId: 1, title: 'Hello World' }).execute();
  });

  test('select all', async () => {
    const rows = await client.selectFrom(users).execute();
    expect(rows).toHaveLength(2);
  });

  test('select with where', async () => {
    const rows = await client.selectFrom(users).where(eq(users.name, 'Alice')).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Alice');
  });

  test('select single', async () => {
    const row = await client.selectFrom(users).where(eq(users.name, 'Alice')).single().execute();
    expect(row).not.toBeNull();
    expect(row!.name).toBe('Alice');
  });

  test('select single returns null', async () => {
    const row = await client.selectFrom(users).where(eq(users.name, 'nobody')).single().execute();
    expect(row).toBeNull();
  });

  test('select with columns', async () => {
    const rows = await client.selectFrom(users).columns(['id', 'name']).execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBeDefined();
    expect(rows[0]!.name).toBeDefined();
  });

  test('insert single row', async () => {
    await client.insert(users).values({ name: 'Charlie', email: 'charlie@test.com', age: 35 }).execute();
    const rows = await client.selectFrom(users).execute();
    expect(rows).toHaveLength(3);
  });

  test('insert multiple rows', async () => {
    await client
      .insert(users)
      .values([
        { name: 'Charlie', email: 'charlie@test.com', age: 35 },
        { name: 'Dave', email: 'dave@test.com', age: 40 },
      ])
      .execute();
    const rows = await client.selectFrom(users).execute();
    expect(rows).toHaveLength(4);
  });

  test('insert returning', async () => {
    const inserted = await client.insert(users).values({ name: 'Charlie', email: 'charlie@test.com', age: 35 }).returning().execute();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.name).toBe('Charlie');
  });

  test('update', async () => {
    await client.update(users).set({ name: 'Alice Updated' }).where(eq(users.name, 'Alice')).execute();
    const row = await client.selectFrom(users).where(eq(users.name, 'Alice Updated')).single().execute();
    expect(row).not.toBeNull();
  });

  test('delete', async () => {
    await client.delete(users).where(eq(users.name, 'Alice')).execute();
    const rows = await client.selectFrom(users).execute();
    expect(rows).toHaveLength(1);
  });

  test('count aggregate', async () => {
    const total = await client.count(users);
    expect(total).toBe(2);
  });

  test('count with condition', async () => {
    const count = await client.count(users, eq(users.name, 'Alice'));
    expect(count).toBe(1);
  });

  test('order by', async () => {
    const rows = await client.selectFrom(users).orderBy('name', 'desc').execute();
    expect(rows[0]!.name).toBe('Bob');
    expect(rows[1]!.name).toBe('Alice');
  });

  test('limit and offset', async () => {
    const rows = await client.selectFrom(users).orderBy('id', 'asc').limit(1).offset(1).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Bob');
  });

  test('distinct', async () => {
    await client.insert(users).values({ name: 'Alice2', email: 'alice2@test.com', age: 30 }).execute();
    const rows = await client.selectFrom(users).columns(['age']).distinct().execute();
    expect(rows).toHaveLength(2); // ages: 30, 25
  });
});

describe('join via executor', () => {
  type PostRow = InferRow<typeof posts>;
  type JoinRow = JoinResult<typeof users, [typeof posts]> & { test_posts: PostRow[] };

  beforeEach(async () => {
    await client.insert(users).values({ name: 'Alice', email: 'alice@test.com', age: 30 }).execute();
    await client.insert(posts).values({ userId: 1, title: 'Post 1' }).execute();
    await client.insert(posts).values({ userId: 1, title: 'Post 2' }).execute();
  });

  test('left join', async () => {
    const rows = (await client.leftJoin(users).on(posts).execute()) as JoinRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.test_posts).toHaveLength(2);
    expect(rows[0]!.test_posts[0]!.title).toBe('Post 1');
    expect(rows[0]!.name).toBe('Alice');
  });

  test('left join with where', async () => {
    const rows = (await client.leftJoin(users).on(posts).where(eq(users.name, 'Alice')).execute()) as JoinRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.test_posts).toHaveLength(2);
  });
});
