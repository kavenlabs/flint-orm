# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build**: `bun run build` (compiles to `./dist/` via Bun + `tsc`)
- **Typecheck**: `bun typecheck`
- **Lint**: `bun lint` (oxlint)
- **Format**: `bun format` (oxfmt)
- **Run tests**: `bun test`
- **Run a single test**: `bun test --test-name-pattern "test name"` or `bun test src/test.test.ts`

### CLI (flint)

```bash
# Generate migration from schema changes
flint generate --name init_schema

# Preview SQL without writing files
flint generate --preview

# Apply pending migrations
flint migrate

# Check migration status
flint migrate --status
```

### Config (`flint.config.ts`)

```ts
import { defineConfig } from 'flint-orm/config';

export default defineConfig({
  schema: './src/schema',
  migrations: './flint',
  database: { url: './app.db' },
});
```

## Architecture

flint-orm is a type-safe SQLite ORM built for Bun. It uses functional composition (no classes, no `new`) with immutable, chainable builders. Backed by `bun:sqlite`.

### Core Pattern: Two-Phase Builders

All query operations use a two-phase builder pattern to enforce correct usage at the type level:

1. **Phase 1 (Stage1)**: Only one method available (e.g., `.from()`, `.values()`, `.set()`)
2. **Phase 2 (Full Builder)**: All chainable methods available after Phase 1

This prevents calling `.execute()` before providing required data.

### Key Modules

- **`src/flint.ts`**: `flint()` factory function — creates the db object with all query methods. Also exports `sql` tagged template for raw SQL expressions.
- **`src/schema/table.ts`**: `table()` function defines tables. Stores column definitions as direct properties with SQL metadata under `._`. Also exports `snakeCase` namespace for auto camelCase→snake_case column naming.
- **`src/schema/columns.ts`**: Column constructors (`text()`, `integer()`, `boolean()`, `json()`, `date()`, `real()`). Each returns an immutable `ColumnDef` with chainable modifiers (`.primaryKey()`, `.notNull()`, etc.).
- **`src/query/builder.ts`**: All query builders (SELECT, INSERT, UPDATE, DELETE, JOIN). Builders receive `client` at construction and implement `Executable` interface with `.toSQL()` and `.execute()`.
- **`src/query/conditions.ts`**: Condition helpers (`eq`, `and`, `or`, `gt`, `like`, etc.) that compile to SQL WHERE clauses. `eq()` supports both value and column-to-column comparison.
- **`src/query/aggregates.ts`**: Aggregate functions (`count`, `countColumn`, `sum`, `avg`, `min`, `max`).

### Column Storage Mapping

Columns encode/decode between TypeScript types and SQLite storage classes:

- `text()` → TEXT (string, passthrough)
- `integer()` → INTEGER (number, passthrough). Supports `.autoIncrement()`.
- `boolean()` → INTEGER (stores 0/1, exposes boolean)
- `json()` → TEXT (JSON.stringify/parse)
- `date()` → INTEGER (unix timestamp ms, exposes Date). Supports `.defaultNow()` and `.onUpdate()`.
- `real()` → REAL (number, passthrough)

### Data Flow

1. Values go through `column.__internal.encode()` when building SQL params
2. Results go through `column.__internal.decode()` when reading from SQLite
3. All encoding/decoding happens at a single chokepoint per direction

### Table/Column Relationship

- `table()` stamps `tableName` onto each column's `__internal`
- Columns carry their SQL name, type, constraints, and encode/decode functions
- `._` property on table objects stores the SQL table name

### Join System

Joins support auto-discovery of foreign key conditions via `.references()` on column definitions. One-to-many joins produce nested arrays under the child table name.

### Query Features

- `.single()` — returns one row or null (adds LIMIT 1)
- `.distinct()` — SELECT DISTINCT
- `.columns()` — narrow selected columns (type-safe Pick)
- `.returning()` — on INSERT/UPDATE/DELETE, return affected rows
- `.onConflictDoNothing()` / `.onConflictDoUpdate()` — upsert support
- `db.$run(sql, params)` — execute raw SQL directly
- `db.$client.prepare(sql)` — access underlying `bun:sqlite` client
- `db.batch(queries)` — run multiple queries in a transaction

### snakeCase Tables

Auto-converts camelCase keys to snake_case SQL names:

```ts
import { snakeCase, text } from 'flint-orm';

const users = snakeCase.table('users', {
  id: text().primaryKey(), // SQL: id
  firstName: text().notNull(), // SQL: first_name
  createdAt: text(), // SQL: created_at
});
```

### Migration System

- `flint generate` serializes `table()` definitions, diffs against last snapshot, writes migration folder with TypeScript operations
- `flint migrate` reads pending migrations, executes SQL via `batch()` (atomic), records applied migrations in `__flint_migrations`
- Tables are topologically sorted by foreign key dependencies (Kahn's algorithm)

```ts
import { generate, migrate, getMigrationStatus, serializeSchema, diffSchemas, generateSQL } from 'flint-orm/migration';
```

## Agent Guidelines

- **Ask before assuming** — If a request is ambiguous, ask clarifying questions before taking action. Don't infer intent.
- **Don't write code until asked** — When the user describes a problem or asks a question, analyze and discuss first. Only write code when explicitly requested.
- **Present options** — When there are multiple valid approaches, present them with trade-offs rather than picking one unilaterally.
- **Read before editing** — Always read relevant files before making changes. Understand the existing patterns first.
- **Verify before claiming** — Don't state something works or is correct without checking. Run tests, typecheck, or verify against the code.

## Conventions

- **No classes in public API** — all functionality exposed via functions and plain objects
- **Immutable builders** — every chain method returns a new instance
- **Private fields** — use `#field` syntax (native private)
- **Error hierarchy** — `FlintError` base → `FlintValidationError`, `FlintQueryError`
