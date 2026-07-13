# flint-orm — Skill Spec

flint-orm is a type-safe, driver-agnostic SQLite ORM for JavaScript. It supports multiple SQLite drivers (bun:sqlite, better-sqlite3, @libsql/client, @tursodatabase/database, @tursodatabase/sync) through subpath imports, with schema-first migrations and a fluent query builder.

## Domains

| Domain | Description | Skills |
|--------|-------------|--------|
| Client setup and driver selection | Connecting to a database with the right driver | setup-client, driver-selection |
| Schema definition | Defining tables, columns, indexes, constraints, and foreign keys | define-schema |
| Querying data | Reading, writing, and modifying data with type-safe queries | write-queries, batch-transactions |
| Schema evolution | Generating and applying schema migrations safely | run-migrations, update-schema |

## Skill Inventory

| Skill | Type | Domain | What it covers | Failure modes |
|-------|------|--------|----------------|---------------|
| setup-client | core | setup | flint() factory, driver entry points, flint.config.ts | 2 |
| driver-selection | core | setup | bun:sqlite, better-sqlite3, libsql, libsql-web, turso drivers | 2 |
| define-schema | core | schema | table(), column constructors, modifiers, indexes, types | 3 |
| write-queries | core | queries | SELECT, INSERT, UPDATE, DELETE, joins, aggregates, raw SQL | 4 |
| run-migrations | core | migrations | flint generate, flint migrate, programmatic API | 2 |
| update-schema | core | migrations | Safe vs unsafe migrations, rebuildTable, additive patterns | 3 |
| batch-transactions | core | queries | db.batch(), Executable interface, transactions | 2 |

## Failure Mode Inventory

### setup-client (2 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Using libsql-web for local file databases | HIGH | src/entries/libsql-web.ts | driver-selection |
| 2 | Driver mismatch between config and app | CRITICAL | maintainer interview | — |

### driver-selection (2 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Using libsql-web with file: URLs | HIGH | src/entries/libsql-web.ts | setup-client |
| 2 | Not providing authToken for remote databases | HIGH | maintainer interview | — |

### define-schema (3 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Using table() with camelCase keys | HIGH | maintainer interview | — |
| 2 | Calling .references() before table() stamps it | MEDIUM | src/schema/columns.ts | — |
| 3 | Using .__internal in application code | HIGH | maintainer interview | — |

### write-queries (4 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Not calling .execute() at terminal state | CRITICAL | maintainer interview | — |
| 2 | Not awaiting .execute() | CRITICAL | maintainer interview | — |
| 3 | Mixing Kysely/Drizzle/Supabase API patterns | HIGH | maintainer interview | — |
| 4 | Using WHERE conditions with columns from wrong table | HIGH | src/query/builder.ts | — |

### run-migrations (2 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Running migrate without generate first | HIGH | README.md | — |
| 2 | Not using --preview or --dry-run before applying | HIGH | README.md | — |

### update-schema (3 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Adding NOT NULL column without a default | HIGH | src/migration/diff.ts | — |
| 2 | Changing a column type | HIGH | src/migration/diff.ts | — |
| 3 | Dropping a column referenced by foreign keys | HIGH | src/migration/migrate.ts | — |

### batch-transactions (2 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Not awaiting the batch call | HIGH | src/flint.ts | — |
| 2 | Passing non-Executable objects to batch() | MEDIUM | src/flint.ts | — |

## Tensions

| Tension | Skills | Agent implication |
|---------|--------|-------------------|
| type-safety vs flexibility | define-schema ↔ write-queries | Agents may use loose types to work around strict checks |
| immutability vs readability | write-queries | Agents may try to mutate builders instead of reassigning |

## Cross-References

| From | To | Reason |
|------|-----|--------|
| setup-client | driver-selection | Choosing the right driver is part of client setup |
| define-schema | write-queries | Schema definitions determine what queries are type-safe |
| run-migrations | update-schema | update-schema provides patterns that run-migrations executes |
| write-queries | batch-transactions | batch() composes multiple query builders |

## Subsystems & Reference Candidates

| Skill | Subsystems | Reference candidates |
|-------|------------|----------------------|
| driver-selection | local file, remote/file, serverless, turso | — |
| define-schema | column constructors, column modifiers | column modifiers (>10 distinct modifiers) |
| write-queries | — | condition operators (>10 distinct operators) |

## Remaining Gaps

| Skill | Question | Status |
|-------|----------|--------|
| setup-client | Are there environment-specific gotchas beyond driver selection? | open |
| define-schema | What are the performance implications of different index strategies? | open |

## Recommended Skill File Structure

- **Core skills:** setup-client, driver-selection, define-schema, write-queries, run-migrations, update-schema, batch-transactions
- **Framework skills:** None (framework-agnostic)
- **Lifecycle skills:** None yet (could add getting-started, production-checklist in future)
- **Composition skills:** None needed (no framework integrations)
- **Reference files:** column-modifiers reference (for define-schema), condition-operators reference (for write-queries)

## Composition Opportunities

| Library | Integration points | Composition skill needed? |
|---------|-------------------|---------------------------|
| @libsql/client | Driver for local/remote SQLite | No — covered by driver-selection |
| better-sqlite3 | Driver for local SQLite | No — covered by driver-selection |
| bun:sqlite | Driver for local SQLite | No — covered by driver-selection |
