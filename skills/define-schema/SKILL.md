---
name: define-schema
description: >
  Create tables with columns, indexes, constraints, and foreign keys. Covers
  table(), snakeCase.table(), column constructors (text, integer, boolean,
  json, real, date), column modifiers (primaryKey, notNull, unique, default,
  references, onDelete, onUpdate, autoIncrement, defaultNow, onUpdateTimestamp),
  index builder, and InferRow/InsertRow types. Load when defining or modifying
  database schemas.
metadata:
  type: core
  library: flint-orm
  library_version: 0.7.0
sources:
  - 'kavenlabs/flint-orm:src/schema/columns.ts'
  - 'kavenlabs/flint-orm:src/schema/table.ts'
  - 'kavenlabs/flint-orm:README.md'
  - 'kavenlabs/flint-orm:API.md'
---

# flint-orm — Schema Definition

## Setup

```ts
import * as d from 'flint-orm/table';

const users = d.snakeCase.table('users', {
  id: d.integer().autoIncrement().primaryKey(),
  name: d.text().notNull(),
  email: d.text().unique(),
  age: d.integer(),
  active: d.boolean().default(true),
  createdAt: d.date().defaultNow(),
});
```

## Core Patterns

### Define a table with snake_case columns

Use `snakeCase.table()` to auto-convert camelCase keys to snake_case SQL names:

```ts
import * as d from 'flint-orm/table';

const users = d.snakeCase.table('users', {
  id: d.integer().autoIncrement().primaryKey(),
  firstName: d.text().notNull(),    // SQL: first_name
  lastName: d.text().notNull(),     // SQL: last_name
  createdAt: d.date().defaultNow(), // SQL: created_at
});
```

### Add indexes

Define indexes via the table callback:

```ts
import * as d from 'flint-orm/table';

const users = d.snakeCase.table(
  'users',
  {
    id: d.integer().autoIncrement().primaryKey(),
    email: d.text().notNull(),
    name: d.text().notNull(),
  },
  (t) => [
    d.index('idx_users_email').on(t.email).unique(),
    d.index('idx_users_name').on(t.name),
  ],
);
```

### Define foreign keys

Use `.references()` to link columns across tables:

```ts
import * as d from 'flint-orm/table';

const users = d.snakeCase.table('users', {
  id: d.integer().autoIncrement().primaryKey(),
  name: d.text().notNull(),
});

const posts = d.snakeCase.table('posts', {
  id: d.integer().autoIncrement().primaryKey(),
  userId: d.integer().notNull().references(users.id),
  title: d.text().notNull(),
});
```

### Derive TypeScript types

```ts
import type { InferRow, InsertRow } from 'flint-orm/table';

type User = InferRow<typeof users>;
// { id: number; name: string; email: string | null; active: boolean; createdAt: Date }

type NewUser = InsertRow<typeof users>;
// { id?: number; name: string; email?: string; active?: boolean; createdAt?: Date }
```

## Column Types

| Function | TS Type | SQLite Storage | Notes |
|----------|---------|----------------|-------|
| `text()` | `string` | TEXT | |
| `integer()` | `number` | INTEGER | Supports `.autoIncrement()` |
| `boolean()` | `boolean` | INTEGER (0/1) | Encodes/decodes automatically |
| `json<T>()` | `T` | TEXT (JSON) | Generic, encodes/decodes automatically |
| `real()` | `number` | REAL | |
| `date()` | `Date` | INTEGER (epoch ms) | Supports `.defaultNow()`, `.onUpdateTimestamp()` |

## Column Modifiers

| Modifier | Applies to | Description |
|----------|------------|-------------|
| `.primaryKey()` | All | Mark as primary key |
| `.notNull()` | All | Disallow NULL values |
| `.unique()` | All | Add unique constraint |
| `.default(value)` | All | Static default value |
| `.defaultFn(fn)` | All | Dynamic default (called on insert) |
| `.references(col)` | All | Foreign key reference |
| `.onDelete(action)` | All | ON DELETE action (requires `.references()`) |
| `.onUpdate(action)` | All | ON UPDATE action (requires `.references()`) |
| `.autoIncrement()` | integer only | Auto-increment |
| `.defaultNow()` | date only | Use `Date.now()` as default |
| `.onUpdateTimestamp()` | date only | Always set to `Date.now()` on update |

## Common Mistakes

### HIGH Using table() with camelCase keys

Wrong:

```ts
import { table, text } from 'flint-orm/table';

const users = table('users', {
  id: text('id').primaryKey(),
  firstName: text('firstName'), // SQL: firstName, not first_name
});
```

Correct:

```ts
import * as d from 'flint-orm/table';

const users = d.snakeCase.table('users', {
  id: d.integer().autoIncrement().primaryKey(),
  firstName: d.text().notNull(), // SQL: first_name
});
```

`table()` uses the object key as the SQL column name — camelCase keys produce camelCase SQL columns. Use `snakeCase.table()` for automatic conversion.

Source: maintainer interview

### HIGH Using .__internal in application code

Wrong:

```ts
const typeName = users.name.__internal._type; // DON'T DO THIS
```

Correct:

```ts
import type { InferRow } from 'flint-orm/table';
type User = InferRow<typeof users>;
```

`.__internal` is for ORM internals — its shape can change between versions without notice.

Source: maintainer interview

### MEDIUM Calling .references() before table() stamps it

Wrong:

```ts
import { text } from 'flint-orm/table';
const col = text('userId').references(users.id); // ERROR: users not yet defined
```

Correct:

```ts
import * as d from 'flint-orm/table';

const users = d.snakeCase.table('users', {
  id: d.integer().autoIncrement().primaryKey(),
});

const posts = d.snakeCase.table('posts', {
  userId: d.integer().notNull().references(users.id),
});
```

TypeScript prevents this — `.references()` requires a column that has been attached to a table via `table()`.

Source: src/schema/columns.ts

## References

- [Full column modifiers reference](references/column-modifiers.md)
