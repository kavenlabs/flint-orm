// ---------------------------------------------------------------------------
// Test: create a real SQLite DB, define a table, and exercise the full
// insert → select → update → delete cycle, printing results so encode/decode
// round-trips (especially boolean and JSON) can be visually confirmed.
// ---------------------------------------------------------------------------

import { Database } from "bun:sqlite";
import { eq, and } from "./conditions";
import { text, integer, boolean, json } from "./columns";
import { table } from "./table";
import { select, insert, update, delete_ } from "./builder";
import type { InferRow } from "./table";

// ── Schema ─────────────────────────────────────────────────────────────────

const users = table("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull(),
  metadata: json<{ role: string; tags: string[] }>("metadata"),
});

// ── Type test (compile-time) ──────────────────────────────────────────────
// This line will fail to compile if InferRow doesn't match expectations.
type _Row = InferRow<typeof users>;
//   ^? { id: string; name: string; active: boolean; metadata: { role: string; tags: string[] } }

// ── Database setup ─────────────────────────────────────────────────────────

const db = new Database("test.db");

db.run(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL,
  metadata TEXT
)`);

// ── INSERT ─────────────────────────────────────────────────────────────────

console.log("── INSERT ──");

const aliceInsert = insert(users).values({
  id: "u1",
  name: "Alice",
  active: true,
  metadata: { role: "admin", tags: ["alpha", "beta"] },
});

console.log("SQL:", aliceInsert.toSQL().sql);
console.log("Params:", aliceInsert.toSQL().params);

aliceInsert.execute(db);

console.log("✓ inserted 1 row\n");

// ── SELECT ─────────────────────────────────────────────────────────────────

console.log("── SELECT all ──");

const allRows = select().from(users).execute(db);
console.log(JSON.stringify(allRows, null, 2));
console.log();

console.log("── SELECT with WHERE ──");

const alice = select().from(users).where(eq(users.name, "Alice")).execute(db);

console.log(JSON.stringify(alice, null, 2));
console.log();

// ── Type-error check (uncomment to verify compile-time safety) ────────────
// This line SHOULD fail to compile — "not-a-boolean" is not assignable to boolean.
// select().from(users).where(eq(users.active, "not-a-boolean")).execute(db);

// ── UPDATE ─────────────────────────────────────────────────────────────────

console.log("── UPDATE ──");

update(users)
  .set({ active: false, metadata: { role: "viewer", tags: ["gamma"] } })
  .where(eq(users.id, "u1"))
  .execute(db);

const updated = select().from(users).where(eq(users.id, "u1")).execute(db);

console.log(JSON.stringify(updated, null, 2));
console.log();

// ── DELETE ─────────────────────────────────────────────────────────────────

console.log("── DELETE ──");

delete_(users).where(eq(users.id, "u1")).execute(db);

const afterDelete = select().from(users).execute(db);
console.log("rows remaining:", afterDelete.length);
console.log();

// ── Composite WHERE (and) ─────────────────────────────────────────────────

console.log("── INSERT + composite WHERE ──");

insert(users)
  .values({
    id: "u2",
    name: "Bob",
    active: true,
    metadata: { role: "editor", tags: [] },
  })
  .execute(db);

const bobs = select()
  .from(users)
  .where(and(eq(users.name, "Bob"), eq(users.active, true)))
  .execute(db);

console.log(JSON.stringify(bobs, null, 2));
console.log();

// ── toSQL() debugging ─────────────────────────────────────────────────────

console.log("── toSQL() examples ──");

console.log(
  "select:",
  select()
    .from(users)
    .where(and(eq(users.active, true), eq(users.name, "Bob")))
    .toSQL(),
);

console.log(
  "insert:",
  insert(users)
    .values({
      id: "u3",
      name: "Carol",
      active: false,
      metadata: null as any,
    })
    .toSQL(),
);

console.log("update:", update(users).set({ active: true }).where(eq(users.id, "u3")).toSQL());

console.log("delete:", delete_(users).where(eq(users.id, "u3")).toSQL());

// ── Cleanup ────────────────────────────────────────────────────────────────

db.close();
console.log("\n✓ all done — check test.db or the output above for round-trip correctness");
