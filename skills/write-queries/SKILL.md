---
name: write-queries
description: >
  Read, write, and modify data with type-safe SELECT, INSERT, UPDATE, DELETE,
  joins, and aggregates. Covers selectFrom, insert, update, delete, leftJoin,
  innerJoin, where, columns, single, orderBy, limit, offset, distinct,
  returning, onConflictDoNothing, onConflictDoUpdate, count, sum, avg, min,
  max, and raw SQL. Load when building queries or troubleshooting query issues.
metadata:
  type: core
  library: flint-orm
  library_version: 0.7.0
sources:
  - 'kavenlabs/flint-orm:src/query/builder.ts'
  - 'kavenlabs/flint-orm:src/query/conditions.ts'
  - 'kavenlabs/flint-orm:src/query/aggregates.ts'
  - 'kavenlabs/flint-orm:src/flint.ts'
  - 'kavenlabs/flint-orm:README.md'
  - 'kavenlabs/flint-orm:API.md'
---

# flint-orm — Queries

## Setup

```ts
import { flint } from 'flint-orm/bun-sqlite';
import { table, text, integer } from 'flint-orm/table';
import { eq, and } from 'flint-orm/expressions';

const users = table('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  age: integer('age'),
});

const db = flint({ url: './app.db' });
```

## Core Patterns

### SELECT with conditions

```ts
const adults = await db
  .selectFrom(users)
  .where(eq(users.age, 18))
  .execute();
```

### SELECT specific columns

```ts
const names = await db
  .selectFrom(users)
  .columns(['id', 'name'])
  .execute();
// Returns: { id: string; name: string }[]
```

### Get a single row

```ts
const user = await db
  .selectFrom(users)
  .where(eq(users.id, 'u1'))
  .single()
  .execute();
// Returns: User | null
```

### INSERT with returning

```ts
// Return all columns
const inserted = await db
  .insert(users)
  .values({ id: 'u1', name: 'Alice', age: 30 })
  .returning()
  .execute();

// Return specific columns
const inserted = await db
  .insert(users)
  .values({ id: 'u1', name: 'Alice', age: 30 })
  .returning(['id', 'name'])
  .execute();
```

### UPSERT

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

### UPDATE with conditions

```ts
// Update without returning
await db
  .update(users)
  .set({ name: 'Bob' })
  .where(eq(users.id, 'u1'))
  .execute();

// Update with returning
const updated = await db
  .update(users)
  .set({ name: 'Bob' })
  .where(eq(users.id, 'u1'))
  .returning(['id', 'name'])
  .execute();
```

### DELETE with conditions

```ts
// Delete without returning
await db
  .delete(users)
  .where(eq(users.id, 'u1'))
  .execute();

// Delete with returning
const deleted = await db
  .delete(users)
  .where(eq(users.id, 'u1'))
  .returning()
  .execute();
```

### LEFT JOIN

```ts
const posts = table('posts', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(users.id),
  title: text('title').notNull(),
});

const postsWithAuthors = await db
  .leftJoin(users)
  .on(posts)
  .execute();
// Returns: { id: string; name: string; posts: Post[] }[]
```

### Aggregate functions

```ts
const total = await db.count(users);
const activeCount = await db.count(users, eq(users.active, true));
const totalViews = await db.sum(posts, posts.views);
const avgAge = await db.avg(users, users.age);
```

## Building Queries Conditionally

The query builder is immutable — you can compose queries conditionally:

```ts
let query = db.selectFrom(users);

if (filter.name) {
  query = query.where(eq(users.name, filter.name));
}
if (filter.minAge) {
  query = query.where(gte(users.age, filter.minAge));
}

const results = await query.execute();
```

Call `.execute()` at the terminal state when ready to run the query.

## Common Mistakes

### CRITICAL Not calling .execute() at terminal state

Wrong:

```ts
const query = db.selectFrom(users).where(eq(users.id, 'u1')); // Builder, not executed
const data = query; // Missing .execute()
```

Correct:

```ts
// Building queries conditionally is fine:
let query = db.selectFrom(users);
if (filter) query = query.where(eq(users.active, true));
// But call .execute() at the terminal state:
const data = await query.execute();
```

Queries are builders — you can compose them conditionally, but `.execute()` must be called when ready to run the query.

Source: maintainer interview

### CRITICAL Not awaiting .execute()

Wrong:

```ts
const users = db.selectFrom(users).where(eq(users.id, 'u1')).execute(); // Promise, not data
```

Correct:

```ts
const users = await db.selectFrom(users).where(eq(users.id, 'u1')).execute();
```

`.execute()` returns a Promise — without `await`, you get the Promise object, not the data.

Source: maintainer interview

### HIGH Mixing Kysely/Drizzle/Supabase API patterns

Wrong:

```ts
// Supabase-style (wrong)
const users = await db.from('users').select('id, name');
```

Correct:

```ts
// Flint-style
const users = await db.selectFrom(users).columns(['id', 'name']).execute();
```

flint-orm has its own API — `selectFrom().columns([...]).single()` is specific to this library.

Source: maintainer interview

### HIGH Using WHERE conditions with columns from wrong table

Wrong:

```ts
// Using posts column in users query
await db.selectFrom(users).where(eq(posts.userId, 'u1')).execute(); // ERROR
```

Correct:

```ts
await db.selectFrom(users).where(eq(users.id, 'u1')).execute();
```

The builder validates column ownership — columns in WHERE must belong to the queried table(s).

Source: src/query/builder.ts

## References

- [Full condition operators reference](references/condition-operators.md)
