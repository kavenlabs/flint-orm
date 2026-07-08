# Flint ORM — API Reference

A minimal, SQLite/libSQL-only query builder. Type-safe, immutable, parameterized.

## Installation

```bash
bun add flint-orm
```

## Quick Start

```ts
import { flint, table, text, integer, eq } from 'flint-orm';

// Define schema
const users = table('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
  age: integer('age'),
});

// Connect
const db = flint({ url: 'app.db' });

// Query
const user = db.select().from(users).where(eq(users.id, 'u1')).single().execute();
// { id: "u1", name: "Alice", email: "alice@example.com", age: 30 }
```

---

## Schema

### `table(name, columns, indexFn?)`

Define a table. Columns live as direct properties. SQL metadata is under `._`.

```ts
import { table, text, integer, boolean, index } from 'flint-orm';

const users = table('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
  active: boolean('active').default(true),
  age: integer('age'),
});
```

### `snakeCase.table(name, columns, indexFn?)`

Auto-converts camelCase keys to snake_case SQL names.

```ts
import { snakeCase, text } from 'flint-orm';

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
| `date()`    | `Date`    | INTEGER (epoch ms) | Supports `.defaultNow()`, `.onUpdate()` |

### Column Modifiers

Every column supports chaining:

```ts
text('name')
  .primaryKey() // PRIMARY KEY
  .notNull() // NOT NULL
  .unique() // UNIQUE
  .default('hello') // DEFAULT 'hello'
  .defaultFn(() => new Date()) // DEFAULT (computed at insert)
  .references(otherColumn); // REFERENCES
```

**Integer-only:**

```ts
integer('id').autoIncrement(); // AUTOINCREMENT
```

**Date-only:**

```ts
date('created_at')
  .defaultNow() // DEFAULT (current epoch ms)
  .onUpdate(); // Always set to now on UPDATE
```

### `InferRow<T>`

Derives the row type from a table definition.

```ts
type UserRow = InferRow<typeof users>;
// { id: string; name: string; email: string | null; active: boolean; age: number | null }
```

### `InsertRow<T>`

Row type for INSERT. Columns with defaults or autoIncrement are optional.

```ts
type UserInsert = InsertRow<typeof users>;
// { id: string; name: string; email?: string; active?: boolean; age?: number }
```

---

## Indexes

### `index(name).on(columns).unique()`

Define indexes via the table callback. Chainable API.

```ts
const users = table('users', {
  id: text('id').primaryKey(),
  email: text('email'),
  name: text('name'),
}, (t) => [
  index('idx_users_email').on(t.email).unique(),
  index('idx_users_name').on(t.name),
  index('idx_users_email_name').on(t.email, t.name),
]);
```

The callback receives the table definition and returns an array of `IndexBuilder` objects. Indexes are attached to the table automatically and serialized for migrations.

---

## Query Builder

### `db.select().from(table)`

Start a SELECT query. Two-phase: `.from()` is required before anything else.

```ts
db.select().from(users).execute();
// SELECT * FROM users
```

### `.columns(keys)`

Narrow which columns appear in the result.

```ts
db.select().from(users).columns(['id', 'name']).execute();
// SELECT id, name FROM users
// Returns: { id: string; name: string }[]
```

### `.where(condition)`

Filter rows.

```ts
db.select().from(users).where(eq(users.active, true)).execute();
// SELECT * FROM users WHERE active = 1
```

### `.single()`

Return one row or null instead of an array. Adds `LIMIT 1`.

```ts
db.select().from(users).where(eq(users.id, 'u1')).single().execute();
// SELECT * FROM users WHERE id = ? LIMIT 1
// Returns: UserRow | null
```

### `.orderBy(key, direction?)`

Sort results. Default direction is `"asc"`.

```ts
db.select().from(users).orderBy('name', 'desc').execute();
// SELECT * FROM users ORDER BY name DESC
```

### `.limit(n)`

Limit the number of results.

```ts
db.select().from(users).limit(10).execute();
// SELECT * FROM users LIMIT 10
```

### `.offset(n)`

Skip N rows.

```ts
db.select().from(users).limit(10).offset(20).execute();
// SELECT * FROM users LIMIT 10 OFFSET 20
```

### `.distinct()`

Return unique rows.

```ts
db.select().from(users).columns(['name']).distinct().execute();
// SELECT DISTINCT name FROM users
```

### Full Example

```ts
const results = db.select().from(users).columns(['id', 'name']).where(eq(users.active, true)).orderBy('name', 'asc').limit(10).offset(0).execute();
// Returns: { id: string; name: string }[]
```

---

### `db.insert(table).values(row)`

Insert one or more rows. Two-phase: `.values()` is required before `.execute()`.

```ts
// Single row
db.insert(users).values({ id: 'u1', name: 'Alice', email: 'alice@example.com' }).execute();
// INSERT INTO users (id, name, email) VALUES (?, ?, ?)

// Multiple rows (bulk insert)
db.insert(users)
  .values([
    { id: 'u1', name: 'Alice' },
    { id: 'u2', name: 'Bob' },
  ])
  .execute();
// INSERT INTO users (id, name) VALUES (?, ?), (?, ?)
```

Columns with defaults can be omitted:

```ts
db.insert(users).values({ id: 'u1', name: 'Alice' }).execute();
```

### `.returning()`

Return the inserted row(s) instead of void. Pass an array to narrow which columns are returned.

```ts
// Return all columns
const user = db.insert(users).values({ id: 'u1', name: 'Alice' }).returning().execute();
// Returns: { id: string; name: string; ... }[]

// Return specific columns
const user = db.insert(users).values({ id: 'u1', name: 'Alice' }).returning(['id', 'name']).execute();
// Returns: { id: string; name: string }[]
```

### `.onConflictDoNothing()`

Skip the insert if a row with the same primary key already exists.

```ts
db.insert(users).values({ id: 'u1', name: 'Alice' }).onConflictDoNothing().execute();
// INSERT OR IGNORE INTO users ...
```

### `.onConflictDoUpdate()`

Update specific columns when a row with the same primary key already exists (upsert).

```ts
db.insert(users)
  .values({ id: 'u1', name: 'Alice' })
  .onConflictDoUpdate({
    target: users.id,
    set: { name: 'Alice Updated' },
  })
  .execute();
// INSERT INTO users ... ON CONFLICT (id) DO UPDATE SET name = excluded.name
```

---

### `db.update(table).set(partial).where(condition)`

Update rows. Two-phase: `.set()` is required before `.execute()`.

```ts
db.update(users).set({ name: 'Bob' }).where(eq(users.id, 'u1')).execute();
// UPDATE users SET name = ? WHERE id = ?
```

Multiple `.set()` calls merge:

```ts
db.update(users).set({ name: 'Bob' }).set({ email: 'bob@example.com' }).where(eq(users.id, 'u1')).execute();
// UPDATE users SET name = ?, email = ? WHERE id = ?
```

### `.returning()`

Return the updated row(s) instead of void. Pass an array to narrow which columns are returned.

```ts
// Return all columns
const updated = db.update(users).set({ name: 'Bob' }).where(eq(users.id, 'u1')).returning().execute();
// Returns: { id: string; name: string; ... }[]

// Return specific columns
const updated = db.update(users).set({ name: 'Bob' }).where(eq(users.id, 'u1')).returning(['id', 'name']).execute();
// Returns: { id: string; name: string }[]
```

---

### `db.delete(table).where(condition)`

Delete rows.

```ts
db.delete(users).where(eq(users.id, 'u1')).execute();
// DELETE FROM users WHERE id = ?
```

### `.returning()`

Return the deleted row(s) instead of void. Pass an array to narrow which columns are returned.

```ts
// Return all columns
const deleted = db.delete(users).where(eq(users.id, 'u1')).returning().execute();
// Returns: { id: string; name: string; ... }[]

// Return specific columns
const deleted = db.delete(users).where(eq(users.id, 'u1')).returning(['id', 'name']).execute();
// Returns: { id: string; name: string }[]
```

---

## Joins

### `db.leftJoin(parent).on(child, condition?)`

LEFT JOIN. Returns all parent rows, with matching child data nested under `__children`.

```ts
const orders = table('orders', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(users.id),
  total: integer('total').notNull(),
});

// With explicit condition
db.leftJoin(orders).on(users, eq(orders.userId, users.id)).execute();

// Auto-join from foreign key (if .references() is defined)
db.leftJoin(orders).on(users).execute();
```

### `db.innerJoin(parent).on(child, condition?)`

INNER JOIN. Returns only rows where both tables match.

```ts
db.innerJoin(orders).on(users, eq(orders.userId, users.id)).execute();
```

### Join Result Shape

Joins return **nested** results, not flat-merged:

```ts
// One-to-many: one user with multiple orders
[
  {
    id: 'u1',
    name: 'Alice',
    __children: [
      { id: 'o1', userId: 'u1', total: 100 },
      { id: 'o2', userId: 'u1', total: 200 },
    ],
  },
];
```

### Join + Columns

Narrow parent columns with `.columns()`:

```ts
db.leftJoin(orders).on(users, eq(orders.userId, users.id)).columns(['id', 'name']).execute();
// Returns: { id: string; name: string; __children: OrderRow[] }[]
```

### `.single()` on Joins

```ts
db.leftJoin(orders).on(users, eq(orders.userId, users.id)).single().execute();
// Returns: { id: string; name: string; __children: OrderRow[] } | null
```

### Multi-Join

Chain multiple joins:

```ts
db.leftJoin(orders).on(users).leftJoin(orderItems).on(orders).execute();
// Returns nested: { ...userFields, __children: [{ ...orderFields, __children: [...items] }] }
```

---

## Conditions

All conditions are imported from `flint-orm`.

### Comparison

```ts
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
between(column, low, high); // column BETWEEN low AND high
```

### Null Checks

```ts
isNull(column); // column IS NULL
isNotNull(column); // column IS NOT NULL
```

### Array

```ts
isIn(column, values); // column IN (?, ?, ...)
isNotIn(column, values); // column NOT IN (?, ?, ...)
```

### Pattern Matching

```ts
like(column, pattern); // column LIKE ?  (% and _ wildcards, case-insensitive)
glob(column, pattern); // column GLOB ?  (* and ? wildcards, case-sensitive)
```

### Logical

```ts
and(...conditions); // cond1 AND cond2 AND ...
or(...conditions); // (cond1 OR cond2 OR ...)
```

### Examples

```ts
import { eq, and, or, gt, isIn, like, between } from "flint-orm";

// Simple equality
.where(eq(users.name, "Alice"))

// Column-to-column
.where(eq(orders.userId, users.id))

// Multiple conditions
.where(and(eq(users.active, true), gt(users.age, 18)))

// OR
.where(or(eq(users.name, "Alice"), eq(users.name, "Bob")))

// IN
.where(isIn(users.status, ["active", "pending"]))

// LIKE
.where(like(users.email, "%@example.com"))

// BETWEEN
.where(between(users.age, 18, 65))
```

---

## Aggregates

Aggregate functions are methods on the `db` object. They execute immediately and return a value.

### `db.count(table, condition?)`

Count all rows.

```ts
db.count(users); // 150
db.count(users, eq(users.active, true)); // 120
```

### `db.countColumn(table, column, condition?)`

Count non-null values in a column.

```ts
db.countColumn(users, users.email); // 145 (5 users have no email)
```

### `db.sum(table, column, condition?)`

Sum of values. Returns `null` if no rows match.

```ts
db.sum(orders, orders.total); // 45000
db.sum(orders, orders.total, eq(orders.userId, 'u1')); // 1500
```

### `db.avg(table, column, condition?)`

Average of values. Returns `null` if no rows match.

```ts
db.avg(orders, orders.total); // 300
db.avg(orders, orders.total, eq(orders.userId, 'u1')); // 500
```

### `db.min(table, column, condition?)`

Minimum value. Returns `null` if no rows match.

```ts
db.min(orders, orders.total); // 10
db.min(orders, orders.total, eq(orders.userId, 'u1')); // 50
```

### `db.max(table, column, condition?)`

Maximum value. Returns `null` if no rows match.

```ts
db.max(orders, orders.total); // 1000
db.max(orders, orders.total, eq(orders.userId, 'u1')); // 800
```

### Multiple Aggregates

Use `Promise.all` when you need multiple aggregates:

```ts
const [total, revenue, avgOrder] = await Promise.all([db.count(orders), db.sum(orders, orders.total), db.avg(orders, orders.total)]);
```

---

## Batch

Run multiple queries atomically in a single transaction.

```ts
import { flint, table, text, eq } from 'flint-orm';

const db = flint({ url: 'app.db' });

db.batch([
  db.insert(orders).values({ id: 'o1', userId: 'u1', total: 100 }),
  db.update(users).set({ totalOrders: 1 }).where(eq(users.id, 'u1')),
]);
```

All queries succeed or all roll back.

---

## Raw SQL

### `db.$run(sql, ...params)`

Execute raw SQL directly against the database.

```ts
db.$run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
db.$run('INSERT INTO test VALUES (?, ?)', 1, 'Alice');
```

### `db.$client`

Direct access to the underlying `bun:sqlite` client.

```ts
const rows = db.$client.prepare('SELECT * FROM users WHERE id = ?').all('u1');
```

---

## Tagged Template SQL

Build parameterized SQL expressions with automatic placeholder handling.

```ts
import { sql } from 'flint-orm';

const expr = sql`SELECT * FROM users WHERE name = ${'Alice'} AND age > ${18}`;
// { sql: "SELECT * FROM users WHERE name = ? AND age > ?", params: ["Alice", 18] }

// Use with db.$client
const rows = db.$client.prepare(expr.sql).all(...expr.params);
```

---

## Migration System

### `flint generate` (CLI)

Generate a migration from schema changes.

```bash
# Generate migration
flint generate --name init_schema

# Preview SQL without writing files
flint generate --name init_schema --preview
```

### `flint migrate` (CLI)

Apply pending migrations to the database.

```bash
# Apply all pending migrations
flint migrate

# Show which migrations are pending/applied
flint migrate --status
```

### Config

Create `flint.config.ts` in your project root:

```ts
import { defineConfig } from 'flint-orm/config';

export default defineConfig({
  schema: './src/schema', // folder or file with table() definitions
  migrations: './flint',  // where migration folders are stored
  database: {
    url: './app.db',      // SQLite database path
  },
});
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
const result = generate([users, orders], './flint', 'init_schema');

// Apply pending migrations
const result = migrate({ url: './app.db' }, './flint');

// Check migration status
const status = getMigrationStatus(client, './flint');
```

### Migration Operations

Named, pre-vetted operations:

```ts
import {
  addTable, dropTable, renameTable,
  addColumn, dropColumn, renameColumn,
  createIndex, dropIndex,
} from 'flint-orm/migration';
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

### Migration File Shape

```ts
import { defineMigration } from 'flint-orm/migration';
import { addTable, addColumn } from 'flint-orm/migration';

export default defineMigration({
  name: 'init_schema',
  operations: [
    addTable({ name: 'users', columns: [...], indexes: [...] }),
    addColumn('users', { name: 'email', sqlType: 'text', ... }),
  ],
});
```

### Tracking

Applied migrations are recorded in `__flint_migrations` (per-database). The table is created on first `migrate()` call — never with `IF NOT EXISTS`.

### FK Ordering

Tables are topologically sorted (Kahn's algorithm) before generating `CREATE TABLE` statements. Referenced tables are created first.

---

## SQLite Introspection

### `introspectSchema(client)`

Read the live database schema and return a `SchemaState` that can be diffed against code-defined tables.

```ts
import { introspectSchema } from 'flint-orm/sqlite';
import { diffSchemas } from 'flint-orm/migration';

const client = new Database('./app.db');
const liveState = introspectSchema(client);

// Compare live DB against code schema
const codeState = serializeSchema([users, orders]);
const operations = diffSchemas(liveState, codeState);
```

Normalizes SQLite type aliases (VARCHAR → TEXT, BIGINT → INTEGER, etc.) and parses default values.

---

## Types

| Type                | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| `TableDef<T>`       | Table definition with hidden `._` metadata                    |
| `ColumnDef<T, S>`   | Column definition with phantom type `T` and storage class `S` |
| `InferRow<T>`       | Derives row type from table definition                        |
| `InsertRow<T>`      | Derives insert type (defaults are optional)                   |
| `IndexDef`          | Index definition: `{ name, columns, unique }`                 |
| `IndexBuilder`      | Chainable index builder: `.on(cols).unique()`                 |
| `Condition`         | Condition node for WHERE clauses                              |
| `Executable`        | Anything with a `.toSQL()` method (for `batch()`)             |
| `ConnectionDetails` | `{ url: string }`                                             |
| `SQLExpression`     | `{ sql: string; params: unknown[] }`                          |

---

## Error Classes

Prefixed with `Flint` to avoid collisions in consumer codebases.

| Class                  | When                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| `FlintValidationError` | Invalid query construction (e.g., no primary key for `.single()`) |
| `FlintQueryError`      | Runtime SQL execution failure                                     |
