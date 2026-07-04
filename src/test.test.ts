// -----------------------------------------------------------------------
// Test: create a real SQLite DB, define a table, and exercise the full
// insert → select → update → delete cycle, printing results so encode/decode
// round-trips (especially boolean and JSON) can be visually confirmed.
// -----------------------------------------------------------------------

import { flint } from "./flint";
import { eq, and } from "./query/conditions";
import { text, boolean, json, integer } from "./schema/columns";
import { table } from "./schema/table";
// import type { InferRow } from "./schema/table";

// ── Schema ─────────────────────────────────────────────────────────────────

const users = table("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull(),
  metadata: json<{ role: string; tags: string[] }>("metadata"),
});

const orders = table("orders", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  total: integer("total").notNull(),
});

// ── Type test (compile-time) ──────────────────────────────────────────────
// This line will fail to compile if InferRow doesn't match expectations.
// type _Row = InferRow<typeof users>;
//   ^? { id: string; name: string; active: boolean; metadata: { role: string; tags: string[] } }

// ── Database setup ─────────────────────────────────────────────────────────

const db = flint({ url: "test.db" });

db.$client.run(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL,
  metadata TEXT
)`);

db.$client.run(`CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  total INTEGER NOT NULL
)`);

// ── INSERT ─────────────────────────────────────────────────────────────────

console.log("── INSERT ──");

const aliceInsert = db.insert(users).values({
  id: "u1",
  name: "Alice",
  active: true,
  metadata: { role: "admin", tags: ["alpha", "beta"] },
});

console.log("SQL:", aliceInsert.toSQL().sql);
console.log("Params:", aliceInsert.toSQL().params);

aliceInsert.execute();

console.log("✓ inserted 1 row\n");

// ── SELECT ─────────────────────────────────────────────────────────────────

console.log("── SELECT all ──");
const allRows = db.select().from(users).execute();
console.log(JSON.stringify(allRows, null, 2));
console.log();

console.log("── SELECT with WHERE ──");
const alice = db.select().from(users).where(eq(users.name, "Alice")).execute();
console.log(JSON.stringify(alice, null, 2));
console.log();

// ── Type-error check (uncomment to verify compile-time safety) ────────────
// This line SHOULD fail to compile — "not-a-boolean" is not assignable to boolean.
// db.select().from(users).where(eq(users.active, "not-a-boolean")).execute();

// ── UPDATE ─────────────────────────────────────────────────────────────────

console.log("── UPDATE ──");

db.update(users)
  .set({ active: false, metadata: { role: "viewer", tags: ["gamma"] } })
  .where(eq(users.id, "u1"))
  .execute();

const updated = db.select().from(users).where(eq(users.id, "u1")).execute();
console.log(JSON.stringify(updated, null, 2));
console.log();

// ── DELETE ─────────────────────────────────────────────────────────────────

console.log("── DELETE ──");
db.delete(users).where(eq(users.id, "u1")).execute();
const afterDelete = db.select().from(users).execute();
console.log("rows remaining:", afterDelete.length);
console.log();

// ── Composite WHERE (and) ─────────────────────────────────────────────────

console.log("── INSERT + composite WHERE ──");

db.insert(users)
  .values({
    id: "u2",
    name: "Bob",
    active: true,
    metadata: { role: "editor", tags: [] },
  })
  .execute();

const bobs = db
  .select()
  .from(users)
  .where(and(eq(users.name, "Bob"), eq(users.active, true)))
  .execute();

console.log(JSON.stringify(bobs, null, 2));
console.log();

// ── BATCH ──────────────────────────────────────────────────────────────────

console.log("── BATCH (atomic insert) ──");

db.batch([
  db.insert(orders).values({ id: "o1", userId: "u2", total: 100 }),
  db.insert(orders).values({ id: "o2", userId: "u2", total: 250 }),
]);

const orderRows = db.select().from(orders).execute();
console.log(JSON.stringify(orderRows, null, 2));
console.log("✓ batch inserted", orderRows.length, "orders\n");

// ── toSQL() debugging ─────────────────────────────────────────────────────

console.log("── toSQL() examples ──");

console.log(
  "select:",
  db
    .select()
    .from(users)
    .where(and(eq(users.active, true), eq(users.name, "Bob")))
    .toSQL(),
);

console.log(
  "insert:",
  db
    .insert(users)
    .values({
      id: "u3",
      name: "Carol",
      active: false,
      metadata: null as any,
    })
    .toSQL(),
);

console.log("update:", db.update(users).set({ active: true }).where(eq(users.id, "u3")).toSQL());

console.log("delete:", db.delete(users).where(eq(users.id, "u3")).toSQL());

// ── Cleanup ────────────────────────────────────────────────────────────────

db.$client.close();
console.log("\n✓ all done — check test.db or the output above for round-trip correctness");
