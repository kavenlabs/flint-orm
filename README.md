# flint-orm

A minimal, type-safe SQLite ORM. One dialect, one runtime, no abstraction overhead.

## Why

Drizzle is great, but its execution layer (`drizzle-kit migrate`) wasn't built for dynamic, multi-tenant, per-request-connection contexts. Flint is narrower by design: SQLite/libSQL only, no multi-dialect abstraction, no pluggable drivers — just a query builder that does exactly what SQLite supports.

## Install

```bash
npm install flint-orm
bun add flint-orm
```

## Quick Start

```ts
import { flint, table, text, integer, eq } from "flint-orm";

const users = table("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  age: integer("age"),
});

const db = flint({ url: "app.db" });

// Insert
db.insert(users).values({ id: "u1", name: "Alice", email: "alice@example.com" }).execute();

// Query
const user = db.select().from(users).where(eq(users.id, "u1")).single().execute();
// { id: "u1", name: "Alice", email: "alice@example.com", age: null }

// Update
db.update(users).set({ name: "Alice Updated" }).where(eq(users.id, "u1")).execute();

// Delete
db.delete(users).where(eq(users.id, "u1")).execute();
```

## Features

### Schema

```ts
import { table, text, integer, boolean, json, date, real, index } from "flint-orm";

const users = table("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  active: boolean("active").default(true),
  metadata: json("metadata"),
  createdAt: date("createdAt").defaultNow().onUpdate(),
  score: real("score"),
  age: integer("age"),
  orgId: text("orgId").references(orgs.id),
}, (t) => [
  index("idx_users_email").on(t.email).unique(),
  index("idx_users_org").on(t.orgId),
]);
```

| Type     | TS Type   | SQLite     | Modifiers                        |
| -------- | --------- | ---------- | -------------------------------- |
| `text`   | `string`  | TEXT       | `.primaryKey()`, `.notNull()`, `.unique()`, `.default()`, `.references()` |
| `integer`| `number`  | INTEGER    | `.autoIncrement()`               |
| `boolean`| `boolean` | INTEGER    | Encodes 0/1                      |
| `json<T>`| `T`       | TEXT       | JSON encode/decode               |
| `date`   | `Date`    | INTEGER    | `.defaultNow()`, `.onUpdate()`   |
| `real`   | `number`  | REAL       |                                  |

### Query Builder

Two-phase builders prevent invalid queries at compile time:

```ts
// SELECT
db.select().from(users).columns(["id", "name"]).where(eq(users.active, true)).orderBy("name").limit(10).execute();

// INSERT
db.insert(users).values({ id: "u1", name: "Alice" }).returning().execute();

// UPSERT
db.insert(users).values({ id: "u1", name: "Alice" }).onConflictDoUpdate({ target: users.id, set: { name: "Bob" } }).execute();

// UPDATE
db.update(users).set({ name: "Bob" }).where(eq(users.id, "u1")).returning().execute();

// DELETE
db.delete(users).where(eq(users.id, "u1")).returning().execute();
```

### Joins

```ts
const orders = table("orders", {
  id: text("id").primaryKey(),
  userId: text("userId").references(users.id),
  total: integer("total").notNull(),
});

// Left join — nested result shape
const result = db.leftJoin(orders).on(users).execute();
// [{ id: "u1", name: "Alice", __children: [{ id: "o1", total: 100 }] }]

// Multi-join
db.leftJoin(orders).on(users).leftJoin(orderItems).on(orders).execute();
```

### Aggregates

```ts
db.count(users);
db.sum(orders, orders.total);
db.avg(orders, orders.total, eq(orders.userId, "u1"));
```

### Batch

```ts
db.batch([
  db.insert(orders).values({ id: "o1", userId: "u1", total: 100 }),
  db.update(users).set({ totalOrders: 1 }).where(eq(users.id, "u1")),
]);
```

### Raw SQL

```ts
db.$client.prepare("SELECT * FROM users WHERE id = ?").all("u1");
```

## Conditions

```ts
import { eq, neq, gt, gte, lt, lte, and, or, isIn, isNotIn, isNull, isNotNull, like, glob, between } from "flint-orm";

db.select().from(users).where(and(eq(users.active, true), gt(users.age, 18))).execute();
```

## Types

```ts
import type { InferRow, InsertRow } from "flint-orm";

type UserRow = InferRow<typeof users>;
type UserInsert = InsertRow<typeof users>; // defaults are optional
```

## Migration System

### CLI

```bash
# Generate migration from schema changes
flint generate --name init_schema

# Preview SQL without writing files
flint generate --preview

# Apply pending migrations
flint migrate

# Check status
flint migrate --status
```

### Config

```ts
// flint.config.ts
import { defineConfig } from "flint-orm/config";

export default defineConfig({
  schema: "./src/schema",
  migrations: "./flint",
  database: { url: "./app.db" },
});
```

### How It Works

1. `flint generate` serializes your `table()` definitions, diffs against the last snapshot, and writes a migration folder with TypeScript operations
2. `flint migrate` reads pending migration folders, executes SQL via `batch()` (atomic), and records applied migrations in `__flint_migrations`
3. Tables are topologically sorted by foreign key dependencies (Kahn's algorithm) — referenced tables are created first

### Programmatic

```ts
import { generate, migrate, getMigrationStatus, serializeSchema, diffSchemas, generateSQL } from "flint-orm/migration";
```

## CLI

```
flint <command> [options]

Commands:
  generate   Generate a new migration from schema changes
  migrate    Apply pending migrations
  status     Show migration status

Options:
  --name, -n    Migration name
  --preview, -p Show SQL without writing files
  --status      Show which migrations are pending/applied
```

## Error Handling

```ts
import { FlintValidationError, FlintQueryError } from "flint-orm";
```

| Error                   | When                                |
| ----------------------- | ----------------------------------- |
| `FlintValidationError`  | Invalid query construction          |
| `FlintQueryError`       | Runtime SQL execution failure       |

## Philosophy

- **SQLite only** — no multi-dialect abstraction, no driver plugins
- **Type-safe by construction** — two-phase builders, phantom types, `InferRow<T>`
- **Immutable** — every chain method returns a new instance
- **No classes** — functions and plain objects only
- **Parameterized** — all queries use `?` placeholders, never string interpolation

## License

MIT
