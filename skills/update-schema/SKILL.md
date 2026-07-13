---
name: update-schema
description: >
  Add columns and tables without data loss. Covers safe vs unsafe migrations,
  rebuildTable operation, additive migration patterns, and which changes
  trigger table rebuilds. Load when modifying schema after initial migration
  or when planning schema evolution.
metadata:
  type: core
  library: flint-orm
  library_version: 0.7.0
sources:
  - 'kavenlabs/flint-orm:src/migration/diff.ts'
  - 'kavenlabs/flint-orm:src/migration/sql.ts'
  - 'kavenlabs/flint-orm:src/migration/migrate.ts'
  - 'kavenlabs/flint-orm:README.md'
---

# flint-orm — Schema Updates

## Setup

After defining your initial schema, you'll need to evolve it over time. flint-orm detects changes and generates appropriate migrations.

## Core Patterns

### Safe migration: Adding a column with default

```ts
// Add a new column with a default value — safe, no data loss
const users = snakeCase.table('users', {
  id: integer().autoIncrement().primaryKey(),
  name: text().notNull(),
  status: text().notNull().default('active'), // NEW: safe to add
});
```

### Safe migration: Adding a new table

```ts
// Add a new table — always safe
const posts = snakeCase.table('posts', {
  id: integer().autoIncrement().primaryKey(),
  userId: integer().notNull().references(users.id),
  title: text().notNull(),
});
```

### Unsafe migration: Changing column type

```ts
// Changing a column type triggers a table rebuild
// The old column was: age: text('age')
// The new column is:  age: integer('age')
const users = snakeCase.table('users', {
  id: integer().autoIncrement().primaryKey(),
  name: text().notNull(),
  age: integer('age').notNull().default(0), // TYPE CHANGE: triggers rebuild
});
```

### Unsafe migration: Adding NOT NULL without default

```ts
// Adding NOT NULL without a default triggers a table rebuild
const users = snakeCase.table('users', {
  id: integer().autoIncrement().primaryKey(),
  name: text().notNull(),
  status: text().notNull(), // NO DEFAULT: triggers rebuild
});
```

## Migration Safety Reference

### Safe changes (no rebuild)

| Change | Example |
|--------|---------|
| Add column with default | `status: text().default('active')` |
| Add new table | `snakeCase.table('new_table', {...})` |
| Add index | `index('idx_name').on(t.name)` |
| Drop index | Remove from index callback |
| Change default value | `status: text().default('inactive')` |

### Unsafe changes (triggers rebuild)

| Change | Example |
|--------|---------|
| Change column type | `text()` → `integer()` |
| Add NOT NULL without default | `text().notNull()` (no `.default()`) |
| Remove NOT NULL | `text().notNull()` → `text()` |
| Add/remove UNIQUE | `text().unique()` → `text()` |
| Remove default | `text().default('x')` → `text()` |
| Add/change/remove foreign key | `.references(col)` changes |
| Change FK actions | `.onDelete('cascade')` changes |
| Change autoincrement | `.autoIncrement()` changes |

### What is rebuildTable?

When an unsafe change is detected, flint-orm generates a `rebuildTable` operation that:

1. Creates a temporary table with the new schema
2. Copies data from the old table
3. Drops the old table
4. Renames the temporary table to the original name
5. Recreates indexes

This happens within a transaction — if anything fails, the original table is preserved.

## Common Mistakes

### HIGH Adding NOT NULL column without a default

Wrong:

```ts
// After initial migration, adding:
const users = snakeCase.table('users', {
  id: integer().autoIncrement().primaryKey(),
  name: text().notNull(),
  status: text().notNull(), // No default — triggers rebuild
});
```

Correct:

```ts
const users = snakeCase.table('users', {
  id: integer().autoIncrement().primaryKey(),
  name: text().notNull(),
  status: text().notNull().default('active'), // Safe: has default
});
```

SQLite cannot add NOT NULL columns to existing tables without a default — this triggers a table rebuild.

Source: src/migration/diff.ts

### HIGH Changing a column type

Wrong:

```ts
// Changing after initial migration:
const users = snakeCase.table('users', {
  id: integer().autoIncrement().primaryKey(),
  name: text().notNull(),
  age: integer('age'), // Was: age: text('age')
});
```

Correct:

```ts
// Plan for the type from the start, or accept the rebuild
const users = snakeCase.table('users', {
  id: integer().autoIncrement().primaryKey(),
  name: text().notNull(),
  age: integer('age').notNull().default(0), // Correct type from start
});
```

SQLite has no `ALTER COLUMN TYPE` — this always triggers a table rebuild.

Source: src/migration/diff.ts

### HIGH Dropping a column referenced by foreign keys

Wrong:

```ts
// Dropping users.id when orders.userId references it
// Migration fails with: Cannot rebuild "users" — referenced by: orders
```

Correct:

```bash
# Migrate dependent tables first, then rebuild the parent
flint migrate # Apply orders migration first
flint generate # Then rebuild users
```

The migration runner checks for incoming foreign keys before rebuild — it will refuse if other tables reference the table being rebuilt.

Source: src/migration/migrate.ts
