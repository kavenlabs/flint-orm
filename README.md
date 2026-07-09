# Flint ORM

A type-safe SQLite ORM for JavaScript. One schema, any driver.

## Features

- **Driver-agnostic** — use `bun:sqlite`, `better-sqlite3`, `@libsql/client`, or Turso sync
- **Type-safe queries** — full TypeScript inference for results, inserts, and updates
- **Schema-first migrations** — define tables in code, generate and apply migrations
- **Fluent query builder** — chainable API for SELECT, INSERT, UPDATE, DELETE, and JOINs
- **Aggregate functions** — count, sum, avg, min, max with type inference
- **Zero runtime dependencies** on the core — drivers are opt-in per subpath

## Install

```bash
bun add flint-orm
# or
npm install flint-orm
```

## Quick Start

```ts
import { flint } from 'flint-orm/bun-sqlite'
import { table, text, integer, date } from 'flint-orm/table'
import { eq, and } from 'flint-orm/expressions'

// Define schema
const users = table('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
  age: integer('age'),
  createdAt: date('created_at').defaultNow(),
})

// Connect
const db = flint({ url: './app.db' })

// Insert
db.insert(users).values({ id: 'u1', name: 'Alice', email: 'alice@example.com' }).execute()

// Query
const adults = db.select().from(users).where(eq(users.age, 18)).execute()
//    ^? { id: string; name: string; email: string; age: number; createdAt: Date }[]

// Single row
const alice = db.select().from(users).where(eq(users.id, 'u1')).single().execute()
//    ^? { id: string; name: string; email: string; age: number; createdAt: Date } | null
```

## Drivers

| Driver | Package | Environment | Async | Auth Token |
| --- | --- | --- | --- | --- |
| `bun-sqlite` | `flint-orm/bun-sqlite` | Bun | No | No |
| `better-sqlite3` | `flint-orm/better-sqlite3` | Node, Deno | No | No |
| `libsql` | `flint-orm/libsql` | Node, Deno, Bun | Yes | Yes |
| `libsql-web` | `flint-orm/libsql-web` | Browser | Yes | Yes |
| `turso-sync` | `flint-orm/turso-sync` | Node, Deno, Bun | Yes | Yes |

### libsql / Turso

```ts
import { flint } from 'flint-orm/libsql'

const db = flint({
  url: 'libsql://your-db.turso.io',
  authToken: 'your-token',
})

const rows = await db.select().from(users).execute()
```

### better-sqlite3

```ts
import { flint } from 'flint-orm/better-sqlite3'

const db = flint({ url: './app.db' })

const rows = db.select().from(users).execute() // synchronous
```

## Schema Definition

### Columns

```ts
import { table, text, integer, boolean, real, json, date, index } from 'flint-orm/table'

const posts = table('posts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body'),
  published: boolean('published').default(false),
  views: integer('views').default(0).autoIncrement(),
  price: real('price'),
  metadata: json('metadata').default({}),
  createdAt: date('created_at').defaultNow(),
  updatedAt: date('updated_at').onUpdate(),
})
```

### Modifiers

- `.primaryKey()` — mark as primary key
- `.notNull()` — disallow NULL values
- `.unique()` — add unique constraint
- `.default(value)` — static default value
- `.defaultFn(fn)` — dynamic default (called on insert when value is omitted)
- `.references(target)` — foreign key reference
- `.autoIncrement()` — integer auto-increment (integer columns only)
- `.defaultNow()` — use `Date.now()` as default (date columns only)
- `.onUpdate()` — always set to `Date.now()` on update (date columns only)

### Indexes

```ts
const users = table('users', {
  id: text('id').primaryKey(),
  email: text('email'),
  name: text('name'),
}, (t) => [
  index('idx_users_email').on(t.email).unique(),
  index('idx_users_name').on(t.name),
])
```

### Type Inference

```ts
import type { InferRow, InsertRow } from 'flint-orm/table'

type User = InferRow<typeof users>
// { id: string; name: string; email: string | null; age: number | null; createdAt: Date }

type NewUser = InsertRow<typeof users>
// { id: string; name: string; email?: string | null; age?: number | null; createdAt?: Date }
```

`InsertRow` makes columns with auto-defaults (`integer`, `date`) optional.

## Queries

### SELECT

```ts
// All rows
const all = db.select().from(users).execute()

// With conditions
const active = db.select().from(users).where(eq(users.active, true)).execute()

// Narrow columns
const names = db.select().from(users).columns(['id', 'name']).execute()
//    ^? { id: string; name: string }[]

// Single row
const user = db.select().from(users).where(eq(users.id, 'u1')).single().execute()
//    ^? { ... } | null

// Ordering and pagination
const page = db.select().from(users)
  .orderBy('name', 'asc')
  .limit(10)
  .offset(20)
  .execute()

// Distinct
const unique = db.select().from(users).columns(['email']).distinct().execute()
```

### INSERT

```ts
// Single row
db.insert(users).values({ id: 'u1', name: 'Alice', email: 'alice@example.com' }).execute()

// Multiple rows
db.insert(users).values([
  { id: 'u1', name: 'Alice' },
  { id: 'u2', name: 'Bob' },
]).execute()

// Return inserted rows
const inserted = db.insert(users)
  .values({ id: 'u1', name: 'Alice' })
  .returning()
  .execute()
//    ^? { id: string; name: string; ... }[]

// Upsert
db.insert(users).values({ id: 'u1', name: 'Alice' })
  .onConflictDoUpdate({ target: users.id, set: { name: 'Alice' } })
  .execute()

// Ignore conflicts
db.insert(users).values({ id: 'u1', name: 'Alice' })
  .onConflictDoNothing()
  .execute()
```

### UPDATE

```ts
db.update(users).set({ name: 'Bob' }).where(eq(users.id, 'u1')).execute()

// Return updated rows
const updated = db.update(users)
  .set({ name: 'Bob' })
  .where(eq(users.id, 'u1'))
  .returning()
  .execute()
```

### DELETE

```ts
db.delete(users).where(eq(users.id, 'u1')).execute()

// Return deleted rows
const deleted = db.delete(users)
  .where(eq(users.id, 'u1'))
  .returning()
  .execute()
```

### JOINs

```ts
// Auto-join via foreign key (posts.userId references users.id)
const postsWithAuthors = db.leftJoin(users).on(posts).execute()

// Explicit join condition
const result = db.leftJoin(users).on(posts, eq(posts.userId, users.id)).execute()

// Chain multiple joins
const complex = db.leftJoin(users)
  .on(posts, eq(posts.userId, users.id))
  .on(comments, eq(comments.postId, posts.id))
  .where(eq(users.id, 'u1'))
  .execute()

// Inner join
const inner = db.innerJoin(users).on(posts).execute()
```

Join results are nested — each joined table's data appears under its table name:

```ts
// result shape: { id: string; name: string; posts: { id: string; title: string }[] }
```

### Aggregates

```ts
const total = db.count(users)
const activeCount = db.count(users, eq(users.active, true))
const totalViews = db.sum(posts, posts.views)
const avgAge = db.avg(users, users.age)
const minAge = db.min(users, users.age)
const maxAge = db.max(users, users.age)
```

### Batch (Transactions)

```ts
db.batch([
  db.insert(users).values({ id: 'u1', name: 'Alice' }),
  db.insert(posts).values({ id: 'p1', userId: 'u1', title: 'Hello' }),
])
```

### Raw SQL

```ts
import { sql } from 'flint-orm'

const expr = sql`name = ${'Alice'} AND age > ${18}`
const result = db.select().from(users).where(expr).execute()

// Direct execution
db.$run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)')
```

## Conditions

All conditions are composable with `and()` and `or()`:

```ts
import { eq, neq, gt, gte, lt, lte, and, or, isIn, isNotIn, isNull, isNotNull, like, glob, between } from 'flint-orm/expressions'

// Equality
eq(users.name, 'Alice')
eq(posts.userId, users.id)  // column-to-column comparison

// Comparisons
gt(users.age, 18)
gte(users.age, 18)
lt(users.age, 65)
lte(users.age, 65)
neq(users.id, 'excluded')

// Logical
and(eq(users.active, true), gt(users.age, 18))
or(eq(users.role, 'admin'), eq(users.role, 'moderator'))

// Sets
isIn(users.id, ['u1', 'u2', 'u3'])
isNotIn(users.id, ['excluded'])

// Null checks
isNull(users.deletedAt)
isNotNull(users.email)

// Pattern matching
like(users.name, 'A%')   // SQL LIKE (% = any characters, _ = single char)
glob(users.name, 'A*')   // SQL GLOB (* = any characters, ? = single char)

// Range
between(users.age, 18, 65)
```

## Migrations

Flint uses schema-first migrations. Define your tables in code, and the CLI generates migration files from the diff.

### Setup

```ts
// flint.config.ts
import { defineConfig } from 'flint-orm/config'

export default defineConfig({
  driver: 'bun-sqlite',
  database: {
    url: './app.db',
  },
  schema: './src/schema',
  migrations: './flint',
})
```

### Generate

```bash
flint generate              # auto-detect changes
flint generate --name init  # name the migration
flint generate --preview    # dry run, show SQL without writing
```

### Apply

```bash
flint migrate               # apply pending migrations
flint migrate --status      # show applied vs pending
flint migrate --dry-run     # show what would run
```

### How It Works

1. `flint generate` serializes your `table()` definitions to JSON
2. Diffs against the last migration's `state.json`
3. Detects adds, drops, renames, and safe modifications
4. Prompts to confirm potential renames
5. Writes a migration folder with `migration.ts` (operations) + `state.json` (snapshot)
6. `flint migrate` reads pending migrations and executes them in order

Unsafe changes (type changes, primary key changes) throw an error and must be handled manually.

## Subpath Imports

| Import | What's in it |
| --- | --- |
| `flint-orm/bun-sqlite` | `flint()` factory for bun:sqlite |
| `flint-orm/better-sqlite3` | `flint()` factory for better-sqlite3 |
| `flint-orm/libsql` | `flint()` factory for @libsql/client |
| `flint-orm/libsql-web` | `flint()` factory for @libsql/client/web |
| `flint-orm/turso-sync` | `flint()` factory for @tursodatabase/sync |
| `flint-orm/table` | `table()`, column constructors, index builder, type utilities |
| `flint-orm/expressions` | `eq`, `and`, `or`, `gt`, `like`, and all condition helpers |
| `flint-orm/config` | `defineConfig()` |
| `flint-orm/migration` | `generate()`, `migrate()`, `serializeSchema()`, `diffSchemas()` |
