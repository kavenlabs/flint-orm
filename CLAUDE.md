# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

flint-orm is a type-safe, driver-agnostic SQLite ORM for JavaScript. It supports multiple SQLite drivers (bun:sqlite, better-sqlite3, @libsql/client, @tursodatabase/database, @tursodatabase/sync) with schema-first migrations. One schema, any driver.

## Build & Dev Commands

- **Build**: `bun run build` — bundles with `bun build` then runs `tsc` for type declarations
- **Typecheck**: `bun run typecheck`
- **Lint**: `bun run lint` (oxlint)
- **Format**: `bun run format` (oxfmt)
- **Run tests**: `bun test` (runs all tests in `tests/`)
- **Run single test**: `bun test tests/path/to/file.test.ts`
- **CLI**: `bun src/cli.ts <command>` (or `flint` when installed)

## Architecture

### Driver Abstraction

Each driver gets its own subpath export. Users install `flint-orm` once — subpaths are tree-shakable entry points within the same package.

```
flint-orm/bun-sqlite      → bun:sqlite (sync, Promise-wrapped)
flint-orm/better-sqlite3   → better-sqlite3 (sync, Promise-wrapped)
flint-orm/libsql           → @libsql/client (async, authToken)
flint-orm/libsql-web       → @libsql/client/web (async, authToken)
flint-orm/turso            → @tursodatabase/database (async)
flint-orm/turso-sync       → @tursodatabase/sync (async, authToken)
```

Each entry point exports a `flint()` factory bound to its driver. The driver import lives in the entry point, not the shared core — this is what enables tree-shaking.

### Uniform Async API

All `execute()` methods return `Promise<T>` regardless of driver. Sync drivers (bun:sqlite, better-sqlite3) wrap their results in `Promise.resolve()`. This means users always `await` — no need to think about which driver they're using.

The shared `Executor` interface (`src/executor.ts`) requires all methods to return `Promise`. Each driver adapter implements this interface. The builder's `execute()` is always `async`.

### Core Query System (`src/flint.ts` + `src/query/`)

`flint(executor)` returns a client with `selectFrom()`, `insert()`, `update()`, `delete()`, `leftJoin()`, `innerJoin()`, `batch()`, and aggregate methods. The query builder is a multi-stage fluent API enforced at the type level:

- `db.selectFrom(table)` → `SelectBuilder` (where, orderBy, limit, offset, columns, single, distinct)
- `db.insert(table).values(row)` → `InsertBuilder` (onConflictDoNothing, onConflictDoUpdate, returning)
- `db.update(table).set(partial)` → `UpdateBuilder` (where, returning)
- `db.delete(table)` → `DeleteBuilder` (where, returning)
- `db.leftJoin(parent).on(child)` → `JoinBuilder` (chained .on(), where, orderBy, columns)

`batch()` runs multiple `Executable` objects in a single transaction. All builders implement `Executable` with a `toSQL()` method.

### Schema Definitions (`src/schema/`)

- `src/schema/columns.ts`: Column constructors (`text`, `integer`, `boolean`, `json`, `date`, `real`) return immutable `ColumnDef` objects with chainable modifiers (`.primaryKey()`, `.notNull()`, `.unique()`, `.default()`, `.defaultFn()`, `.references()`, `.onDelete()`, `.onUpdate()`, `.autoIncrement()`, `.defaultNow()`, `.onUpdateTimestamp()`). Each column has an `__internal` property with `encode`/`decode` functions for SQLite storage.
- `src/schema/table.ts`: `table(name, columns, indexFn?)` stamps the table name onto columns and returns a `TableDef`. `InferRow<T>` and `InsertRow<T>` derive TypeScript row types. Index definitions use a chainable `index("name").on(col).unique()` builder. `snakeCase` variant auto-converts camelCase keys to snake_case SQL names.

### Migration System (`src/migration/`)

Schema-first migration pipeline:

1. **Serialize** (`serialize.ts`): Converts live `table()` definitions to `SchemaState` (JSON-serializable `SerializedTable`/`SerializedColumn`/`SerializedIndex`).
2. **Diff** (`diff.ts`): Compares previous vs current `SchemaState` to produce `MigrationOperation[]`. Handles table/column/index adds, drops, renames (with interactive user prompts), and safe modifications. Throws on unsafe changes (type changes, PK changes, etc.).
3. **SQL generation** (`sql.ts`): Converts `MigrationOperation[]` to executable SQL strings.
4. **Generate** (`generate.ts`): Orchestrates serialize → diff → resolveRenames → generateSQL, writes migration folder with `migration.ts` + `state.json`.
5. **Migrate** (`migrate.ts`): Applies pending migrations in order, tracking applied migrations in a `__flint_migrations` table. Supports dry-run.

### CLI (`src/cli.ts`)

- `flint generate [--name] [--preview]`: Discovers schema from `flint.config.ts`, generates migration
- `flint migrate [--dry-run] [--status] [--name]`: Applies migrations or shows status

### Entry Points (`src/entries/`)

Barrel re-exports for subpath imports:

- `flint-orm/table` — schema definitions, column constructors, type utilities
- `flint-orm/expressions` — condition helpers (eq, and, or, gt, like, etc.)
- `flint-orm/config` — `defineConfig()`
- `flint-orm/migration` — generate, migrate, serialize, diff

### Config (`flint.config.ts`)

```ts
import { defineConfig } from 'flint-orm/config';

export default defineConfig({
  driver: 'bun-sqlite', // or 'better-sqlite3', 'libsql', 'libsql-web', 'turso', 'turso-sync'
  database: {
    url: './app.db',
    authToken: '...', // for libsql/libsql-web/turso-sync drivers
  },
  schema: './db',
  migrations: './flint',
});
```

### TypeScript Configuration

- Path aliases: `~/*` → `./src/*`, `flint-orm/*` → `./src/*`
- `noUncheckedIndexedAccess: true` — handle potential undefined on index access
- `verbatimModuleSyntax: true` — explicit `type` imports/exports
- Strict mode enabled

### Error Hierarchy (`src/errors.ts`)

`FlintError` → `FlintValidationError` (constraint violations), `FlintQueryError` (SQL execution failures, wraps original error). `CancellationError` (migration diff interactive prompts).

## Key Patterns

- **Immutable builders**: Every builder method returns a new instance; no mutation. This makes query composition safe and predictable.
- **Encode/decode on columns**: Columns handle type conversion between JS and SQLite storage (e.g., `date` ↔ unix timestamp, `boolean` ↔ 0/1, `json` ↔ stringified JSON).
- **Column ownership validation**: Query builders validate that WHERE conditions only reference columns from the queried table(s).
- **Topological sort**: Migration diff sorts tables by foreign key dependency so parent tables are created before dependents.
- **Executor pattern**: Shared `Executor` interface (always async) abstracts all drivers. Sync drivers wrap results in `Promise.resolve()`. Builder logic is written once; only the executor implementation differs per driver.
