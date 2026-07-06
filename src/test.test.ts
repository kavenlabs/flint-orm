// -----------------------------------------------------------------------
// Test: create a real SQLite DB, define tables, and exercise the full
// insert → select → update → delete cycle, plus new features:
// column selection, joins, and .single().
// -----------------------------------------------------------------------

import { flint } from "./flint";
import { eq, and, isNotNull, like, glob, between } from "./query/conditions";
import { text, boolean, json, integer, date } from "./schema/columns";
import { table } from "./schema/table";
import { ValidationError } from "./errors";
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

// ── FEATURE 5: Column ownership validation ─────────────────────────────────

console.log("\n── column ownership validation ──");

// Valid: using a column from the queried table
try {
  db.select().from(users).where(eq(users.id, "u1")).toSQL();
  console.log("✓ valid column usage passed");
} catch (e) {
  console.log("✗ should not have thrown:", (e as Error).message);
}

// Invalid: using a column from a different table
try {
  db.select().from(users).where(isNotNull(orders.id)).toSQL();
  console.log("✗ should have thrown for cross-table column");
} catch (e) {
  if (e instanceof ValidationError) {
    console.log("✓ caught cross-table column error:", (e as Error).message);
  } else {
    console.log("✗ unexpected error:", (e as Error).message);
  }
}

// Invalid in UPDATE
try {
  db.update(users).set({ active: true }).where(eq(orders.id, "o1")).toSQL();
  console.log("✗ should have thrown for cross-table column in UPDATE");
} catch (e) {
  if (e instanceof ValidationError) {
    console.log("✓ caught cross-table column in UPDATE:", (e as Error).message);
  } else {
    console.log("✗ unexpected error:", (e as Error).message);
  }
}

// Invalid in DELETE
try {
  db.delete(users).where(eq(orders.id, "o1")).toSQL();
  console.log("✗ should have thrown for cross-table column in DELETE");
} catch (e) {
  if (e instanceof ValidationError) {
    console.log("✓ caught cross-table column in DELETE:", (e as Error).message);
  } else {
    console.log("✗ unexpected error:", (e as Error).message);
  }
}

// Valid in JOIN: using columns from both tables
try {
  db.leftJoin(orders).on(orderItems, eq(orders.id, orderItems.orderId)).where(eq(orders.id, "o1")).toSQL();
  console.log("✓ valid column usage in JOIN passed");
} catch (e) {
  console.log("✗ should not have thrown:", (e as Error).message);
}

console.log();

// ── FEATURE 6: like / glob conditions ──────────────────────────────────────

console.log("── like / glob ──");

// Insert test data
db.insert(users).values({ id: "u4", name: "Charlie", active: true, metadata: null as any }).execute();
db.insert(users).values({ id: "u5", name: "David", active: false, metadata: null as any }).execute();

// LIKE: case-insensitive, % = any chars, _ = single char
const likeResult = db
  .select()
  .from(users)
  .where(like(users.name, "%li%"))
  .execute();
console.log("LIKE '%li%':", likeResult.map((r) => r.name));
// Should match: Alice, Charlie

const likeExact = db
  .select()
  .from(users)
  .where(like(users.name, "Al_ce"))
  .execute();
console.log("LIKE 'Al_ce':", likeExact.map((r) => r.name));
// Should match: Alice

// GLOB: case-sensitive, * = any chars, ? = single char
const globResult = db
  .select()
  .from(users)
  .where(glob(users.name, "A*"))
  .execute();
console.log("GLOB 'A*':", globResult.map((r) => r.name));
// Should match: Alice (case-sensitive)

const globLower = db
  .select()
  .from(users)
  .where(glob(users.name, "a*"))
  .execute();
console.log("GLOB 'a*':", globLower.map((r) => r.name));
// Should match: nothing (case-sensitive, no lowercase names starting with 'a')

// toSQL examples
console.log("like SQL:", db.select().from(users).where(like(users.name, "%test%")).toSQL());
console.log("glob SQL:", db.select().from(users).where(glob(users.name, "*.txt")).toSQL());

console.log();

// ── FEATURE 7: between condition ───────────────────────────────────────────

console.log("── between ──");

// Query orders with total between 100 and 200 (inclusive)
const betweenResult = db
  .select()
  .from(orders)
  .where(between(orders.total, 100, 200))
  .execute();
console.log("BETWEEN 100 AND 200:", betweenResult.map((r) => ({ id: r.id, total: r.total })));
// Should match: o1 (total: 100)

// Query orders with total between 0 and 150
const betweenLow = db
  .select()
  .from(orders)
  .where(between(orders.total, 0, 150))
  .execute();
console.log("BETWEEN 0 AND 150:", betweenLow.map((r) => ({ id: r.id, total: r.total })));
// Should match: o1 (100)

// toSQL example
console.log("between SQL:", db.select().from(orders).where(between(orders.total, 50, 300)).toSQL());

console.log();

// ── FEATURE 8: distinct ────────────────────────────────────────────────────

console.log("── distinct ──");

// Insert duplicate userId values
db.insert(orders).values({ id: "o4", userId: "u2", total: 50 }).execute();
db.insert(orders).values({ id: "o5", userId: "u2", total: 75 }).execute();

// Without distinct - should return all userIds
const allUserIds = db
  .select()
  .from(orders)
  .columns(["userId"])
  .execute();
console.log("All userIds:", allUserIds.map((r) => r.userId));
// Should have: u2, u2, u2, u2, u2 (5 entries)

// With distinct - should return unique userIds
const uniqueUserIds = db
  .select()
  .from(orders)
  .columns(["userId"])
  .distinct()
  .execute();
console.log("Distinct userIds:", uniqueUserIds.map((r) => r.userId));
// Should have: u2 (1 entry)

// toSQL example
console.log("distinct SQL:", db.select().from(orders).columns(["userId"]).distinct().toSQL());

console.log();

// ── FEATURE 9: aggregates ──────────────────────────────────────────────────

console.log("── aggregates ──");

// count(*) - all orders
const totalOrders = db.count(orders);
console.log("count(*):", totalOrders);
// Should be: 5

// count(*) with condition - orders with total between 50 and 150
const midRangeOrders = db.count(orders, between(orders.total, 50, 150));
console.log("count(*) WHERE total BETWEEN 50 AND 150:", midRangeOrders);
// Should be: 3 (o1: 100, o4: 50, o5: 75)

// count(column) - non-null userId values
const userIdCount = db.countColumn(orders, orders.userId);
console.log("count(userId):", userIdCount);
// Should be: 5

// sum(column) - total of all orders
const totalRevenue = db.sum(orders, orders.total);
console.log("sum(total):", totalRevenue);
// Should be: 100 + 200 + 75 + 50 + 75 = 500

// sum(column) with condition - sum of orders between 50 and 150
const midRangeRevenue = db.sum(orders, orders.total, between(orders.total, 50, 150));
console.log("sum(total) WHERE total BETWEEN 50 AND 150:", midRangeRevenue);
// Should be: 100 + 50 + 75 = 225

// avg(column) - average order total
const avgOrder = db.avg(orders, orders.total);
console.log("avg(total):", avgOrder);
// Should be: 100

// min(column) - minimum order total
const minOrder = db.min(orders, orders.total);
console.log("min(total):", minOrder);
// Should be: 50

// max(column) - maximum order total
const maxOrder = db.max(orders, orders.total);
console.log("max(total):", maxOrder);
// Should be: 200

// Multiple aggregates with Promise.all
const [count2, sum2, avg2] = await Promise.all([
  db.count(orders),
  db.sum(orders, orders.total),
  db.avg(orders, orders.total),
]);
console.log("Promise.all:", { count: count2, sum: sum2, avg: avg2 });
// Should be: { count: 5, sum: 500, avg: 100 }

console.log();

// ── Cleanup ────────────────────────────────────────────────────────────────

db.$client.close();
console.log("\n✓ all done — check test.db or the output above for round-trip correctness");
