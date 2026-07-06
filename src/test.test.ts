// -----------------------------------------------------------------------
// Test: create a real SQLite DB, define tables, and exercise the full
// insert → select → update → delete cycle, plus new features:
// column selection, joins, and .single().
// -----------------------------------------------------------------------

import { flint } from "./flint";
import { eq, and } from "./query/conditions";
import { text, boolean, json, integer, date } from "./schema/columns";
import { table } from "./schema/table";
import type { InferRow } from "./schema/table";
import type { JoinResult } from "./query/builder";

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

const orderItems = table("orderItems", {
  id: text("id").primaryKey(),
  orderId: text("orderId").notNull(),
  productName: text("productName").notNull(),
  quantity: integer("quantity").notNull(),
});

// ── Database setup ─────────────────────────────────────────────────────────

const db = flint({ url: "test.db" });

// ── Compile-time type tests ────────────────────────────────────────────────
// These lines will fail to compile if the types are wrong.
// Type-only checks (no runtime execution) to avoid errors before tables exist.

// .single() return type should be T | null, not T[]
// (verified at usage site below)

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

db.$client.run(`CREATE TABLE IF NOT EXISTS orderItems (
  id TEXT PRIMARY KEY,
  orderId TEXT NOT NULL,
  productName TEXT NOT NULL,
  quantity INTEGER NOT NULL
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

// ═══════════════════════════════════════════════════════════════════════════
// NEW FEATURE TESTS
// ═══════════════════════════════════════════════════════════════════════════

// ── FEATURE 1: .columns() — Array-of-keys form ────────────────────────────

console.log("── .columns() array form ──");

const nameActive = db.select().from(users).columns(["name", "active"]).execute();
console.log("Result:", JSON.stringify(nameActive));
console.log("Keys per row:", Object.keys(nameActive[0] ?? {}));
// Should only have "name" and "active" — no "id" or "metadata"
console.log();

// ── FEATURE 1: .columns() with .where() ───────────────────────────────────

console.log("── .columns() + .where() ──");

const bobName = db
  .select()
  .from(users)
  .columns(["name"])
  .where(eq(users.id, "u2"))
  .execute();
console.log("Bob's name only:", JSON.stringify(bobName));
console.log();

// ── FEATURE 1: Compile-time error for invalid key ─────────────────────────
// Uncomment to verify — should fail to compile:
// db.select().from(users).columns(["nonexistent"]).execute();
// db.select().from(users).columns(["nonexistent"]).execute();

// ── FEATURE 2: leftJoin — one-to-many nested result ───────────────────────

console.log("── leftJoin: orders → orderItems (one-to-many) ──");

// Insert order items for o1
db.insert(orderItems).values({ id: "oi1", orderId: "o1", productName: "Widget", quantity: 2 }).execute();
db.insert(orderItems).values({ id: "oi2", orderId: "o1", productName: "Gadget", quantity: 1 }).execute();
db.insert(orderItems).values({ id: "oi3", orderId: "o1", productName: "Doohickey", quantity: 5 }).execute();
// Insert one item for o2
db.insert(orderItems).values({ id: "oi4", orderId: "o2", productName: "Thingamajig", quantity: 3 }).execute();

const ordersWithItems = db
  .leftJoin(orders)
  .on(orderItems, eq(orders.id, orderItems.orderId))
  .execute();

console.log("Full nested result:");
console.log(JSON.stringify(ordersWithItems, null, 2));
console.log();

// Verify structure: o1 should have 3 items, o2 should have 1
const o1 = ordersWithItems.find((r) => r.id === "o1");
const o2 = ordersWithItems.find((r) => r.id === "o2");
console.log("o1 items count:", (o1 as any)?.orderItems?.length ?? "MISSING");
console.log("o2 items count:", (o2 as any)?.orderItems?.length ?? "MISSING");
console.log();

// ── FEATURE 2: .columns() on join — narrows parent, child arrives fully ────

console.log("── .columns() on join (narrow parent) ──");

const ordersNarrowed = db
  .leftJoin(orders)
  .on(orderItems, eq(orders.id, orderItems.orderId))
  .columns(["id", "total"])
  .execute();

console.log("Narrowed parent fields:");
console.log(JSON.stringify(ordersNarrowed, null, 2));
// Should have: { id, total, __children: [...] }
// Parent should NOT have "userId" — only "id" and "total"
// Child data should arrive fully (all orderItems fields)
console.log("Parent keys:", Object.keys(ordersNarrowed[0] ?? {}).filter((k) => k !== "orderItems"));
console.log("Child keys:", Object.keys((ordersNarrowed[0] as any)?.orderItems?.[0] ?? {}));
console.log();

// ── FEATURE 2: innerJoin ───────────────────────────────────────────────────

console.log("── innerJoin ──");

// Insert an order with no items
db.insert(orders).values({ id: "o3", userId: "u2", total: 0 }).execute();

const innerJoined = db
  .innerJoin(orders)
  .on(orderItems, eq(orders.id, orderItems.orderId))
  .execute();

console.log("Inner join result (orders with items only):");
console.log("Order IDs:", innerJoined.map((r) => r.id));
// o3 should NOT appear (no matching items)
console.log();

// ── FEATURE 3: .single() — found case ─────────────────────────────────────

console.log("── .single() found ──");

const singleBob = db
  .select()
  .from(users)
  .where(eq(users.id, "u2"))
  .single()
  .execute();

console.log("Single Bob:", JSON.stringify(singleBob));
console.log("Is null?", singleBob === null);
console.log();

// ── FEATURE 3: .single() — not found case ─────────────────────────────────

console.log("── .single() not found (should be null) ──");

const notFound = db
  .select()
  .from(users)
  .where(eq(users.id, "nonexistent"))
  .single()
  .execute();

console.log("Not found result:", notFound);
console.log("Is null?", notFound === null);
console.log();

// ── FEATURE 3: .single() with .columns() ──────────────────────────────────

console.log("── .single() + .columns() ──");

const singleName = db
  .select()
  .from(users)
  .columns(["name"])
  .where(eq(users.id, "u2"))
  .single()
  .execute();

console.log("Single name only:", JSON.stringify(singleName));
console.log();

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
  "columns:",
  db.select().from(users).columns(["name", "active"]).toSQL(),
);

console.log(
  "single:",
  db.select().from(users).where(eq(users.id, "u2")).single().toSQL(),
);

console.log(
  "join:",
  db
    .leftJoin(orders)
    .on(orderItems, eq(orders.id, orderItems.orderId))
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

// ── FEATURE 4: date column — defaultNow + onUpdate ────────────────────────

console.log("\n── date column: defaultNow + onUpdate ──");

const posts = table("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: date().defaultNow(),
  updatedAt: date().onUpdate(),
});

db.$client.run(`CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  createdAt INTEGER,
  updatedAt INTEGER
)`);

// Insert without dates — defaultNow should kick in
db.insert(posts).values({ id: "p1", title: "Hello" }).execute();
const p1 = db.select().from(posts).where(eq(posts.id, "p1")).single().execute();
console.log("Insert with defaultNow:", JSON.stringify(p1, null, 2));
console.log("createdAt is Date?", p1?.createdAt instanceof Date);
console.log("updatedAt is null?", p1?.updatedAt === null);

// Update — updatedAt should auto-fill
db.update(posts).set({ title: "Hello Updated" }).where(eq(posts.id, "p1")).execute();
const p1After = db.select().from(posts).where(eq(posts.id, "p1")).single().execute();
console.log("After update:", JSON.stringify(p1After, null, 2));
console.log("updatedAt is Date?", p1After?.updatedAt instanceof Date);

// Update with explicit updatedAt — should be ignored (onUpdate always wins)
db.update(posts).set({ title: "Hello v3", updatedAt: new Date(0) }).where(eq(posts.id, "p1")).execute();
const p1v3 = db.select().from(posts).where(eq(posts.id, "p1")).single().execute();
console.log("After update with explicit date:", JSON.stringify(p1v3, null, 2));
console.log("updatedAt is not epoch?", (p1v3?.updatedAt as Date)?.getTime() !== 0);

// ── Cleanup ────────────────────────────────────────────────────────────────

db.$client.close();
console.log("\n✓ all done — check test.db or the output above for round-trip correctness");
