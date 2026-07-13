---
name: batch-transactions
description: >
  Run multiple queries atomically in a single transaction. Covers db.batch(),
  Executable interface, and transaction safety. Load when combining multiple
  writes that must succeed or fail together, or when debugging transaction
  issues.
metadata:
  type: core
  library: flint-orm
  library_version: 0.7.0
sources:
  - 'kavenlabs/flint-orm:src/flint.ts'
  - 'kavenlabs/flint-orm:src/query/builder.ts'
  - 'kavenlabs/flint-orm:README.md'
  - 'kavenlabs/flint-orm:API.md'
---

# flint-orm — Batch Transactions

## Setup

```ts
import { flint } from 'flint-orm/bun-sqlite';
import { table, text, integer } from 'flint-orm/table';
import { eq } from 'flint-orm/expressions';

const users = table('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  totalOrders: integer('totalOrders').default(0),
});

const posts = table('posts', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(users.id),
  title: text('title').notNull(),
});

const db = flint({ url: './app.db' });
```

## Core Patterns

### Run multiple inserts atomically

```ts
await db.batch([
  db.insert(users).values({ id: 'u1', name: 'Alice' }),
  db.insert(posts).values({ id: 'p1', userId: 'u1', title: 'Hello' }),
]);
```

### Combine reads and writes

```ts
await db.batch([
  db.update(users).set({ totalOrders: 1 }).where(eq(users.id, 'u1')),
  db.insert(posts).values({ id: 'p1', userId: 'u1', title: 'Hello' }),
]);
```

### All-or-nothing execution

If any query in the batch fails, all queries are rolled back:

```ts
// If the second insert fails, the first insert is also rolled back
await db.batch([
  db.insert(users).values({ id: 'u1', name: 'Alice' }),
  db.insert(posts).values({ id: 'p1', userId: 'u1', title: 'Hello' }), // If this fails...
]);
// ...the user insert is also rolled back
```

## Common Mistakes

### HIGH Not awaiting the batch call

Wrong:

```ts
db.batch([
  db.insert(users).values({ id: 'u1', name: 'Alice' }),
  db.insert(posts).values({ id: 'p1', userId: 'u1', title: 'Hello' }),
]); // Not awaited!
```

Correct:

```ts
await db.batch([
  db.insert(users).values({ id: 'u1', name: 'Alice' }),
  db.insert(posts).values({ id: 'p1', userId: 'u1', title: 'Hello' }),
]);
```

`batch()` returns a Promise — without `await`, the transaction may not complete.

Source: src/flint.ts

### MEDIUM Passing non-Executable objects to batch()

Wrong:

```ts
db.batch([{ sql: 'INSERT ...', params: [] }]); // Not an Executable
```

Correct:

```ts
db.batch([
  db.insert(users).values({ id: 'u1', name: 'Alice' }),
]);
```

`batch()` only accepts objects with a `.toSQL()` method (query builders), not raw SQL objects.

Source: src/flint.ts
