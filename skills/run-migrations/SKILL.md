---
name: run-migrations
description: >
  Generate and apply schema migrations safely using the CLI or programmatic
  API. Covers flint generate, flint migrate, flint.config.ts, and the
  migration pipeline (serialize → diff → generateSQL). Load when creating
  or applying migrations, or when troubleshooting migration issues.
metadata:
  type: core
  library: flint-orm
  library_version: 0.7.0
sources:
  - 'kavenlabs/flint-orm:src/migration/generate.ts'
  - 'kavenlabs/flint-orm:src/migration/migrate.ts'
  - 'kavenlabs/flint-orm:src/migration/sql.ts'
  - 'kavenlabs/flint-orm:src/cli.ts'
  - 'kavenlabs/flint-orm:README.md'
  - 'kavenlabs/flint-orm:API.md'
---

# flint-orm — Migrations

## Setup

### flint.config.ts

```ts
import { defineConfig } from 'flint-orm/config';

export default defineConfig({
  driver: 'bun-sqlite', // Must match the driver you import in your app
  database: {
    url: './app.db',
  },
  schema: './src/schema',
  migrations: './flint',
});
```

### CLI commands

```bash
# Generate a migration from schema changes
flint generate
flint generate --name add_users_table
flint generate --preview  # Show SQL without writing

# Apply pending migrations
flint migrate
flint migrate --dry-run  # Show what would run
flint migrate --status   # Show applied vs pending
```

## Core Patterns

### Generate initial migration

After defining your schema, generate the first migration:

```bash
flint generate --name init_schema
```

This creates a folder in `./flint/` with:
- `migration.ts` — The operations to apply
- `state.json` — Snapshot of the schema

### Apply migrations

```bash
flint migrate
```

This:
1. Reads pending migrations from the migrations directory
2. Applies them in order within transactions
3. Records applied migrations in `__flint_migrations` table

### Preview before applying

Always preview before applying in production:

```bash
flint generate --preview  # Review the SQL
flint migrate --dry-run   # Verify what would run
flint migrate             # Apply with confidence
```

### Programmatic API

```ts
import { flint } from 'flint-orm/bun-sqlite';
import { generate, migrate, getMigrationStatus } from 'flint-orm/migration';

const db = flint({ url: './app.db' });

// Generate a migration
await generate([users, posts], './flint', {
  name: 'add_posts',
  interactive: true,
});

// Apply pending migrations
const result = await migrate(db.$executor, { migrationsDir: './flint' });
console.log(`Applied: ${result.applied.join(', ')}`);

// Check status
const status = await getMigrationStatus(db.$executor, './flint');
console.log(`Pending: ${status.pending.length}`);
```

## How It Works

1. `flint generate` serializes your `table()` definitions to JSON
2. Diffs against the last migration's `state.json`
3. Detects adds, drops, renames, and safe modifications
4. Prompts to confirm potential renames (interactive mode)
5. Writes a migration folder with `migration.ts` + `state.json`
6. `flint migrate` reads pending migrations and executes them in order

## Common Mistakes

### HIGH Running migrate without generate first

Wrong:

```ts
// Modifying schema, then:
flint migrate // No migration files exist yet!
```

Correct:

```ts
// After schema changes:
flint generate --name add_users_table
flint migrate
```

`migrate` applies existing migration files — you must generate them first from schema changes.

Source: README.md

### HIGH Not using --preview or --dry-run before applying

Wrong:

```ts
flint generate
flint migrate // Applies without preview
```

Correct:

```ts
flint generate --preview // Review the SQL
flint migrate --dry-run // Verify what would run
flint migrate // Apply with confidence
```

Migrations can be destructive (dropping columns, rebuilding tables). Always preview first.

Source: README.md
