# Flint ORM — API Reference

A type-safe, driver-agnostic SQLite ORM for JavaScript. One schema, any driver.

## Installation

```bash
bun add flint-orm
# or
npm install flint-orm
```

## Quick Start

```ts
import { flint } from 'flint-orm/bun-sqlite';
import { table, text, integer, date } from 'flint-orm/table';
import { eq } from 'flint-orm/expressions';

// Define schema
const users = table('users', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().unique(),
  age: integer(),
  createdAt: date().defaultNow(),
});

// Connect
const db = flint({ url: './app.db' });

// Query
const user = await db.select().from(users).where(eq(users.id, 'u1')).single().execute();
// { id: "u1", name: "Alice", email: "alice@example.com", age: 30, createdAt: Date }
```

---

## Config

Create `flint.config.ts` in your project root:

```ts
import { defineConfig } from 'flint-orm/config';

export default defineConfig({
  driver: 'bun-sqlite', // 'bun-sqlite' | 'better-sqlite3' | 'libsql' | 'libsql-web' | 'turso' | 'turso-sync'
  database: {
    url: './app.db',
    authToken: '...', // for libsql/libsql-web/turso-sync only
  },
  schema: './src/schema',
  migrations: './flint',
});
```

---

## Schema

### `table(name, columns, indexFn?)`

Define a table. Columns live as direct properties. SQL metadata is under `._`.

```ts
import { table, text, integer, boolean, index } from 'flint-orm/table';

const users = table('users', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().unique(),
  active: boolean().default(true),
  age: integer(),
});
```

### `snakeCase.table(name, columns, indexFn?)`

Auto-converts camelCase keys to snake_case SQL names.

```ts
import { snakeCase, text } from 'flint-orm/table';

const users = snakeCase.table('users', {
  id: text().primaryKey(), // SQL: id
  firstName: text().notNull(), // SQL: first_name
  createdAt: text(), // SQL: created_at
});
```

### Column Types

| Function    | TS Type   | SQLite Storage     | Notes                                   |
| ----------- | --------- | ------------------ | --------------------------------------- |
| `text()`    | `string`  | TEXT               |                                         |
| `integer()` | `number`  | INTEGER            | Supports `.autoIncrement()`             |
| `boolean()` | `boolean` | INTEGER (0/1)      | Encodes/decodes automatically           |
| `json<T>()` | `T`       | TEXT (JSON)        | Generic, encodes/decodes automatically  |
| `real()`    | `number`  | REAL               |                                         |
| `date()`    | `Date`    | INTEGER (epoch ms) | Supports `.defaultNow()`, `.onUpdateTimestamp()` |

### Column Modifiers

Every column supports chaining:

```ts
text()
  .primaryKey() // PRIMARY KEY
  .notNull() // NOT NULL
  .unique() // UNIQUE
  .default('hello') // DEFAULT 'hello'
  .defaultFn(() => new Date()) // DEFAULT (computed at insert)
  .references(otherColumn); // REFERENCES
```

**Integer-only:**

```ts
integer().autoIncrement(); // AUTOINCREMENT
```

**Date-only:**

```ts
date()
  .defaultNow() // DEFAULT (current epoch ms)
  .onUpdateTimestamp(); // Always set to now on UPDATE
```

### `InferRow<T>`

Derives the row type from a table definition.

```ts
import type { InferRow } from 'flint-orm/table';

type UserRow = InferRow<typeof users>;
// { id: string; name: string; email: string | null; active: boolean; age: number | null; createdAt: Date }
```

### `InsertRow<T>`

Row type for INSERT. Columns with defaults or autoIncrement are optional.

```ts
import type { InsertRow } from 'flint-orm/table';

type UserInsert = InsertRow<typeof users>;
// { id: string; name: string; email?: string; active?: boolean; age?: number; createdAt?: Date }
```

---

## Indexes

### `index(name).on(columns).unique()`

Define indexes via the table callback. Chainable API.

```ts
const users = table(
  'users',
  {
    id: text().primaryKey(),
    email: text(),
    name: text(),
  },
  (t) => [index('idx_users_email').on(t.email).unique(), index('idx_users_name').on(t.name)],
);
```

---

## Query Builder

All `execute()` methods return `Promise<T>` — always `await` regardless of driver.

### `db.select().from(table)`

Start a SELECT query. Two-phase: `.from()` is required before anything else.

```ts
await db.select().from(users).execute();
// SELECT * FROM users
```

### `.columns(keys)`

Narrow which columns appear in the result.

```ts
await db.select().from(users).columns(['id', 'name']).execute();
// SELECT id, name FROM users
// Returns: { id: string; name: string }[]
```

### `.where(condition)`

Filter rows.

```ts
await db.select().from(users).where(eq(users.active, true)).execute();
// SELECT * FROM users WHERE active = 1
```

### `.single()`

Return one row or null instead of an array. Adds `LIMIT 1`.

```ts
await db.select().from(users).where(eq(users.id, 'u1')).single().execute();
// SELECT * FROM users WHERE id = ? LIMIT 1
// Returns: UserRow | null
```

### `.orderBy(key, direction?)`

Sort results. Default direction is `"asc"`.

```ts
await db.select().from(users).orderBy('name', 'desc').execute();
// SELECT * FROM users ORDER BY name DESC
```

### `.limit(n)`

Limit the number of results.

```ts
await db.select().from(users).limit(10).execute();
// SELECT * FROM users LIMIT 10
```

### `.offset(n)`

Skip N rows.

```ts
await db.select().from(users).limit(10).offset(20).execute();
// SELECT * FROM users LIMIT 10 OFFSET 20
```

### `.distinct()`

Return unique rows.

```ts
await db.select().from(users).columns(['name']).distinct().execute();
// SELECT DISTINCT name FROM users
```

---

### `db.insert(table).values(row)`

Insert one or more rows. Two-phase: `.values()` is required before `.execute()`.

```ts
// Single row
await db.insert(users).values({ id: 'u1', name: 'Alice', email: 'alice@example.com' }).execute();

// Multiple rows
await db
  .insert(users)
  .values([
    { id: 'u1', name: 'Alice' },
    { id: 'u2', name: 'Bob' },
  ])
  .execute();
```

### `.returning()`

Return the inserted row(s) instead of void. Pass an array to narrow which columns are returned.

```ts
const user = await db.insert(users).values({ id: 'u1', name: 'Alice' }).returning().execute();
// Returns: { id: string; name: string; ... }[]

const user = await db.insert(users).values({ id: 'u1', name: 'Alice' }).returning(['id', 'name']).execute();
// Returns: { id: string; name: string }[]
```

### `.onConflictDoNothing()`

Skip the insert if a row with the same primary key already exists.

```ts
await db.insert(users).values({ id: 'u1', name: 'Alice' }).onConflictDoNothing().execute();
```

### `.onConflictDoUpdate()`

Update specific columns when a row with the same primary key already exists (upsert).

```ts
await db
  .insert(users)
  .values({ id: 'u1', name: 'Alice' })
  .onConflictDoUpdate({
    target: users.id,
    set: { name: 'Alice Updated' },
  })
  .execute();
```

---

### `db.update(table).set(partial).where(condition)`

Update rows. Two-phase: `.set()` is required before `.execute()`.

```ts
await db.update(users).set({ name: 'Bob' }).where(eq(users.id, 'u1')).execute();
```

Multiple `.set()` calls merge:

```ts
await db.update(users).set({ name: 'Bob' }).set({ email: 'bob@example.com' }).where(eq(users.id, 'u1')).execute();
```

### `.returning()`

Return the updated row(s) instead of void.

```ts
const updated = await db.update(users).set({ name: 'Bob' }).where(eq(users.id, 'u1')).returning().execute();
// Returns: { id: string; name: string; ... }[]
```

---

### `db.delete(table).where(condition)`

Delete rows.

```ts
await db.delete(users).where(eq(users.id, 'u1')).execute();
```

### `.returning()`

Return the deleted row(s) instead of void.

```ts
const deleted = await db.delete(users).where(eq(users.id, 'u1')).returning().execute();
// Returns: { id: string; name: string; ... }[]
```

---

## Joins

### `db.leftJoin(parent).on(child, condition?)`

LEFT JOIN. Returns all parent rows, with matching child data nested under the child table name.

```ts
const orders = table('orders', {
  id: text().primaryKey(),
  userId: text().notNull().references(users.id),
  total: integer().notNull(),
});

// With explicit condition
await db.leftJoin(users).on(orders, eq(orders.userId, users.id)).execute();

// Auto-join from foreign key (if .references() is defined)
await db.leftJoin(users).on(orders).execute();
```

### `db.innerJoin(parent).on(child, condition?)`

INNER JOIN. Returns only rows where both tables match.

```ts
await db.innerJoin(users).on(orders, eq(orders.userId, users.id)).execute();
```

### Join Result Shape

Joins return **nested** results, not flat-merged:

```ts
[
  {
    id: 'u1',
    name: 'Alice',
    orders: [
      { id: 'o1', userId: 'u1', total: 100 },
      { id: 'o2', userId: 'u1', total: 200 },
    ],
  },
];
```

### Join + Columns

Narrow parent columns with `.columns()`:

```ts
await db.leftJoin(users).on(orders).columns(['id', 'name']).execute();
// Returns: { id: string; name: string; orders: OrderRow[] }[]
```

### `.single()` on Joins

```ts
await db.leftJoin(users).on(orders).single().execute();
// Returns: { id: string; name: string; orders: OrderRow[] } | null
```

### Multi-Join

Chain multiple joins:

```ts
await db.leftJoin(users).on(orders).leftJoin(orders).on(orderItems).execute();
```

---

## Conditions

All conditions are imported from `flint-orm/expressions`.

### Comparison

```ts
import { eq, neq, gt, gte, lt, lte } from 'flint-orm/expressions';

eq(column, value); // column = value
eq(left, right); // left = right (column-to-column)
neq(column, value); // column != value
gt(column, value); // column > value
gte(column, value); // column >= value
lt(column, value); // column < value
lte(column, value); // column <= value
```

### Range

```ts
import { between } from 'flint-orm/expressions';

between(column, low, high); // column BETWEEN low AND high
```

### Null Checks

```ts
import { isNull, isNotNull } from 'flint-orm/expressions';

isNull(column); // column IS NULL
isNotNull(column); // column IS NOT NULL
```

### Array

```ts
import { isIn, isNotIn } from 'flint-orm/expressions';

isIn(column, values); // column IN (?, ?, ...)
isNotIn(column, values); // column NOT IN (?, ?, ...)
```

### Pattern Matching

```ts
import { like, glob } from 'flint-orm/expressions';

like(column, pattern); // column LIKE ?  (% and _ wildcards, case-insensitive)
glob(column, pattern); // column GLOB ?  (* and ? wildcards, case-sensitive)
```

### Logical

```ts
import { and, or } from 'flint-orm/expressions';

and(...conditions); // cond1 AND cond2 AND ...
or(...conditions); // (cond1 OR cond2 OR ...)
```

---

## Aggregates

Aggregate functions are methods on the `db` object. They return `Promise<T>`.

```ts
const total = await db.count(users);
const active = await db.count(users, eq(users.active, true));
const totalViews = await db.sum(posts, posts.views);
const avgAge = await db.avg(users, users.age);
const minAge = await db.min(users, users.age);
const maxAge = await db.max(users, users.age);
```

---

## Batch

Run multiple queries atomically in a single transaction.

```ts
await db.batch([
  db.insert(orders).values({ id: 'o1', userId: 'u1', total: 100 }),
  db.update(users).set({ totalOrders: 1 }).where(eq(users.id, 'u1')),
]);
```

---

## Raw SQL

### `db.$run(sql, ...params)`

Execute raw SQL directly against the database.

```ts
await db.$run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
await db.$run('INSERT INTO test VALUES (?, ?)', 1, 'Alice');
```

### Tagged Template SQL

Build parameterized SQL expressions with automatic placeholder handling.

```ts
import { sql } from 'flint-orm';

const expr = sql`name = ${'Alice'} AND age > ${18}`;
// { sql: "name = ? AND age > ?", params: ["Alice", 18] }

const result = await db.select().from(users).where(expr).execute();
```

---

## Migration System

### CLI

```bash
flint generate --name init_schema   # Generate migration
flint generate --preview            # Preview SQL without writing
flint migrate                       # Apply pending migrations
flint migrate --status              # Show applied vs pending
flint migrate --dry-run             # Preview without executing
```

### Programmatic API

```ts
import { generate, migrate, getMigrationStatus, serializeSchema, diffSchemas, generateSQL } from 'flint-orm/migration';

// Serialize table definitions to JSON
const state = serializeSchema([users, orders]);

// Diff two schema states
const operations = diffSchemas(previousState, currentState);

// Generate SQL from operations
const sql = generateSQL(operations);

// Generate a migration folder
const result = await generate([users, orders], './flint', { name: 'init_schema', interactive: true });

// Apply pending migrations
const result = await migrate(executor, { migrationsDir: './flint' });

// Check migration status
const status = await getMigrationStatus(executor, './flint');
```

### Migration Operations

```ts
import { addTable, dropTable, renameTable, addColumn, dropColumn, renameColumn, createIndex, dropIndex } from 'flint-orm/migration';
```

| Operation      | SQL Generated                          |
| -------------- | -------------------------------------- |
| `addTable`     | `CREATE TABLE ...`                     |
| `dropTable`    | `DROP TABLE ...`                       |
| `renameTable`  | `ALTER TABLE ... RENAME TO ...`        |
| `addColumn`    | `ALTER TABLE ... ADD COLUMN ...`       |
| `dropColumn`   | `ALTER TABLE ... DROP COLUMN ...`      |
| `renameColumn` | `ALTER TABLE ... RENAME COLUMN ... TO` |
| `createIndex`  | `CREATE [UNIQUE] INDEX ...`            |
| `dropIndex`    | `DROP INDEX ...`                       |

---

## Types

| Type              | Description                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `TableDef<T>`     | Table definition with hidden `._` metadata                                                |
| `ColumnDef<T, S>` | Column definition with phantom types                                                      |
| `InferRow<T>`     | Derives row type from table definition                                                    |
| `InsertRow<T>`    | Derives insert type (defaults are optional)                                               |
| `Executor`        | Database executor interface (all, get, run, transaction)                                  |
| `SQLExpression`   | `{ sql: string; params: unknown[] }`                                                      |
| `Executable`      | Anything with a `.toSQL()` method (for `batch()`)                                         |
| `Driver`          | `'bun-sqlite' \| 'better-sqlite3' \| 'libsql' \| 'libsql-web' \| 'turso' \| 'turso-sync'` |

---

## Error Classes

| Class                  | When                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| `FlintValidationError` | Invalid query construction (e.g., no primary key for `.single()`) |
| `FlintQueryError`      | Runtime SQL execution failure                                     |
