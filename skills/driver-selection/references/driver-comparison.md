# Driver Comparison Reference

Detailed comparison of all flint-orm drivers.

## bun:sqlite

**Runtime:** Bun only
**Type:** Sync (Promise-wrapped for uniform API)
**Install:** Built into Bun — no separate install needed

```ts
import { flint } from 'flint-orm/bun-sqlite';
const db = flint({ url: './app.db' });
```

**Options:**
- `url: string` — Path to SQLite file or `:memory:`

**Limitations:**
- Only works in Bun runtime
- No remote database support
- No authentication support

## better-sqlite3

**Runtime:** Node.js
**Type:** Sync (Promise-wrapped for uniform API)
**Install:** `npm install better-sqlite3`

```ts
import { flint } from 'flint-orm/better-sqlite3';
const db = flint({ url: './app.db' });
```

**Options:**
- `url: string` — Path to SQLite file or `:memory:`

**Limitations:**
- No remote database support
- No authentication support

## @libsql/client

**Runtime:** Bun/Node.js
**Type:** Async
**Install:** `npm install @libsql/client`

```ts
import { flint } from 'flint-orm/libsql';
const db = flint({
  url: 'libsql://your-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

**Options:**
- `url: string` — Local file (`file:./app.db`), remote (`libsql://...`), or in-memory (`:memory:`)
- `authToken: string` — Required for remote databases

**Capabilities:**
- Local file access
- Remote database access
- Serverless compatible
- Authentication support

## @libsql/client/web

**Runtime:** Any (browser, edge, serverless)
**Type:** Async
**Install:** `npm install @libsql/client`

```ts
import { flint } from 'flint-orm/libsql-web';
const db = flint({
  url: 'libsql://your-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

**Options:**
- `url: string` — Remote only (`ws://`, `wss://`, `http://`, `https://`)
- `authToken: string` — Required for remote databases

**Capabilities:**
- No native binary — works in any JavaScript runtime
- Serverless/edge optimized
- Authentication support

**Limitations:**
- No local file access (`file:` URLs not supported)
- No in-memory database support

## @tursodatabase/database

**Runtime:** Bun/Node.js
**Type:** Async
**Install:** `npm install @tursodatabase/database`

```ts
import { flint } from 'flint-orm/turso';
const db = flint({
  url: 'libsql://your-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

**Options:**
- `url: string` — Local file or remote Turso database
- `authToken: string` — Required for remote databases

## @tursodatabase/sync

**Runtime:** Bun/Node.js
**Type:** Async
**Install:** `npm install @tursodatabase/sync`

```ts
import { flint } from 'flint-orm/turso-sync';
const db = flint({
  url: 'libsql://your-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

**Options:**
- `url: string` — Local file or remote Turso database
- `authToken: string` — Required for remote databases

**Capabilities:**
- Includes sync support for offline-first applications

## Decision Guide

| Use Case | Recommended Driver |
|----------|-------------------|
| Bun runtime, local file | bun:sqlite |
| Node.js, local file | better-sqlite3 |
| Remote Turso database | libsql |
| Serverless/edge | libsql-web |
| Turso with sync | turso-sync |
| Testing/prototyping | Any with `:memory:` |
