---
name: driver-selection
description: >
  Choose the right driver for your environment: local file, in-memory,
  serverless, or remote. Covers bun:sqlite, better-sqlite3, @libsql/client,
  @libsql/client/web, @tursodatabase/database, @tursodatabase/sync. Load
  when deciding which driver to use or when troubleshooting driver-specific
  issues.
metadata:
  type: core
  library: flint-orm
  library_version: 0.7.0
sources:
  - 'kavenlabs/flint-orm:src/entries/bun-sqlite.ts'
  - 'kavenlabs/flint-orm:src/entries/better-sqlite3.ts'
  - 'kavenlabs/flint-orm:src/entries/libsql.ts'
  - 'kavenlabs/flint-orm:src/entries/libsql-web.ts'
  - 'kavenlabs/flint-orm:src/entries/turso.ts'
  - 'kavenlabs/flint-orm:src/entries/turso-sync.ts'
---

# flint-orm — Driver Selection

## Setup

```ts
// bun:sqlite — Bun runtime only, local file
import { flint } from 'flint-orm/bun-sqlite';
const db = flint({ url: './app.db' });

// better-sqlite3 — Node.js, local file
import { flint } from 'flint-orm/better-sqlite3';
const db = flint({ url: './app.db' });

// libsql — local file or remote (Turso)
import { flint } from 'flint-orm/libsql';
const db = flint({ url: 'libsql://your-db.turso.io', authToken: '...' });

// libsql-web — serverless/edge, remote only (no native binary)
import { flint } from 'flint-orm/libsql-web';
const db = flint({ url: 'libsql://your-db.turso.io', authToken: '...' });

// turso — Turso database
import { flint } from 'flint-orm/turso';
const db = flint({ url: 'libsql://your-db.turso.io', authToken: '...' });

// turso-sync — Turso with sync support
import { flint } from 'flint-orm/turso-sync';
const db = flint({ url: 'libsql://your-db.turso.io', authToken: '...' });
```

## Core Patterns

### Local file database

Use bun:sqlite (Bun) or better-sqlite3 (Node.js) for local SQLite files:

```ts
// Bun runtime
import { flint } from 'flint-orm/bun-sqlite';
const db = flint({ url: './app.db' });

// Node.js
import { flint } from 'flint-orm/better-sqlite3';
const db = flint({ url: './app.db' });
```

### Remote database (Turso)

Use libsql or turso for remote Turso databases:

```ts
import { flint } from 'flint-orm/libsql';
const db = flint({
  url: 'libsql://your-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

### Serverless/edge environment

Use libsql-web for serverless or edge runtimes (no native binary):

```ts
import { flint } from 'flint-orm/libsql-web';
const db = flint({
  url: 'libsql://your-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

### In-memory database

All drivers support in-memory databases via `:memory:`:

```ts
import { flint } from 'flint-orm/bun-sqlite';
const db = flint({ url: ':memory:' });
```

## Driver Comparison

| Driver | Runtime | File URLs | Remote URLs | Serverless | Auth Token |
|--------|---------|-----------|-------------|------------|------------|
| bun:sqlite | Bun only | ✅ | ❌ | ❌ | ❌ |
| better-sqlite3 | Node.js | ✅ | ❌ | ❌ | ❌ |
| libsql | Bun/Node | ✅ | ✅ | ✅ | ✅ |
| libsql-web | Any | ❌ | ✅ | ✅ | ✅ |
| turso | Bun/Node | ✅ | ✅ | ✅ | ✅ |
| turso-sync | Bun/Node | ✅ | ✅ | ✅ | ✅ |

## Common Mistakes

### HIGH libsql requires file: prefix for local paths

Wrong:

```ts
import { flint } from 'flint-orm/libsql';
const db = flint({ url: 'app.db' }); // ERROR: URL_INVALID
```

Correct:

```ts
import { flint } from 'flint-orm/libsql';
const db = flint({ url: 'file:./app.db' });
```

Unlike bun:sqlite and better-sqlite3, the libsql driver requires the `file:` prefix for local file paths.

Source: maintainer interview

### HIGH Using libsql-web with file: URLs

Wrong:

```ts
import { flint } from 'flint-orm/libsql-web';
const db = flint({ url: 'file:./app.db' }); // ERROR
```

Correct:

```ts
// For local files, use libsql or bun-sqlite
import { flint } from 'flint-orm/libsql';
const db = flint({ url: 'file:./app.db' });
```

libsql-web only supports HTTP/WebSocket URLs — it has no native binary and cannot access local files.

Source: src/entries/libsql-web.ts

### HIGH Missing authToken for remote databases

Wrong:

```ts
import { flint } from 'flint-orm/libsql';
const db = flint({ url: 'libsql://my-db.turso.io' }); // Missing authToken
```

Correct:

```ts
import { flint } from 'flint-orm/libsql';
const db = flint({
  url: 'libsql://my-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

Remote Turso/libsql databases require authentication.

Source: maintainer interview

## References

- [Full driver comparison](references/driver-comparison.md)
