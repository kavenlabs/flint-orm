---
name: setup-client
description: >
  Install flint-orm, choose a driver, and connect to a database. Covers
  flint() factory, driver entry points (bun-sqlite, better-sqlite3, libsql,
  libsql-web, turso, turso-sync), and flint.config.ts configuration. Load
  when setting up a new project or switching drivers.
metadata:
  type: core
  library: flint-orm
  library_version: 0.7.0
sources:
  - 'kavenlabs/flint-orm:src/entries/bun-sqlite.ts'
  - 'kavenlabs/flint-orm:src/entries/libsql.ts'
  - 'kavenlabs/flint-orm:src/entries/libsql-web.ts'
  - 'kavenlabs/flint-orm:src/entries/better-sqlite3.ts'
  - 'kavenlabs/flint-orm:README.md'
---

# flint-orm — Client Setup

flint-orm is a type-safe, driver-agnostic SQLite ORM for JavaScript. One schema, any driver.

## Setup

### Install with a driver

```bash
# Choose ONE driver (bun:sqlite is built into Bun, no install needed):
bun add flint-orm                    # bun:sqlite (sync, Promise-wrapped) — Bun only
bun add flint-orm better-sqlite3    # better-sqlite3 (sync, Promise-wrapped)
bun add flint-orm @libsql/client    # libsql (async, local or remote)
bun add flint-orm @libsql/client    # libsql-web (async, serverless, no file: support)
bun add flint-orm @tursodatabase/database  # turso (async)
bun add flint-orm @tursodatabase/sync      # turso-sync (async, authToken)
```

### Initialize the client

```ts
import { flint } from 'flint-orm/bun-sqlite';

const db = flint({ url: './app.db' });
```

### Create flint.config.ts

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

## Core Patterns

### Connect to a local file

```ts
import { flint } from 'flint-orm/bun-sqlite';

const db = flint({ url: './app.db' });
```

### Connect to a remote database

```ts
import { flint } from 'flint-orm/libsql';

const db = flint({
  url: 'libsql://your-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

### Connect in a serverless environment

```ts
import { flint } from 'flint-orm/libsql-web';

// libsql-web only supports ws://, wss://, http://, https:// URLs
const db = flint({
  url: 'libsql://your-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

## Common Mistakes

### CRITICAL Driver mismatch between config and app

Wrong:

```ts
// flint.config.ts
export default defineConfig({ driver: 'bun-sqlite', ... });

// app.ts
import { flint } from 'flint-orm/libsql'; // MISMATCH
const db = flint({ url: '...' });
```

Correct:

```ts
// flint.config.ts
export default defineConfig({ driver: 'libsql', ... });

// app.ts
import { flint } from 'flint-orm/libsql'; // MATCHES
const db = flint({ url: '...' });
```

The CLI uses flint.config.ts to determine which driver to use for migrations, but the app uses whichever driver you import — these must match.

Source: maintainer interview

### HIGH Using libsql-web for local file databases

Wrong:

```ts
import { flint } from 'flint-orm/libsql-web';
const db = flint({ url: './app.db' }); // ERROR: file: not supported
```

Correct:

```ts
import { flint } from 'flint-orm/libsql';
const db = flint({ url: './app.db' });
```

libsql-web only supports ws:, wss:, http:, https: URLs — it has no native binary and cannot access local files. Use the regular libsql driver for local files.

Source: src/entries/libsql-web.ts
