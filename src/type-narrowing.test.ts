// -----------------------------------------------------------------------
// Type narrowing verification — this file checks that TypeScript correctly
// infers the narrowed types. It should compile cleanly.
// -----------------------------------------------------------------------

import { flint } from "./flint";
import { eq } from "./query/conditions";
import { text, boolean, json, integer } from "./schema/columns";
import { table } from "./schema/table";
import type { InferRow } from "./schema/table";
import type { JoinResult } from "./query/builder";

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

const db = flint({ url: ":memory:" });

// ── 1. .columns() array form narrows return type ───────────────────────────

const colArrayResult = db.select().from(users).columns(["name", "active"]).execute();
// Should be { name: string; active: boolean }[]
type _Test1 = typeof colArrayResult extends { name: string; active: boolean }[] ? true : false;
const _t1: _Test1 = true;

// Should NOT have 'id' or 'metadata'
type _Test1b = "id" extends keyof typeof colArrayResult[number] ? true : false;
const _t1b: _Test1b = false;

// ── 2. .single() returns T | null, not T[] ────────────────────────────────

const singleResult = db.select().from(users).where(eq(users.id, "u2")).single().execute();
// Should be InferRow<typeof users> | null
// Check: null IS in the union (null extends singleResult)
type _Test3a = null extends typeof singleResult ? true : false;
const _t3a: _Test3a = true;
// Check: NOT an array
type _Test3b = typeof singleResult extends any[] ? true : false;
const _t3b: _Test3b = false;

// ── 4. .single() + .columns() returns Pick<T, C> | null ───────────────────

const singleColResult = db.select().from(users).columns(["name"]).where(eq(users.id, "u2")).single().execute();
type _Test4 = typeof singleColResult extends { name: string } | null ? true : false;
const _t4: _Test4 = true;

// ── 5. JoinResult has __children array ─────────────────────────────────────

const joinResult = db
  .leftJoin(orders)
  .on(orderItems)
  .on(eq(orders.id, orderItems.orderId))
  .execute();

// Should be JoinResult<typeof orders, typeof orderItems>[]
type _Test5 = typeof joinResult[number] extends { id: string; userId: string; total: number; __children: any[] } ? true : false;
const _t5: _Test5 = true;

// ── 6. Join with .columns() narrows parent, child stays full ───────────────

const joinColResult = db
  .leftJoin(orders)
  .on(orderItems)
  .on(eq(orders.id, orderItems.orderId))
  .columns(["id", "total"])
  .execute();

// Should have { id: string; total: number; __children: [...] }
type _Test6a = typeof joinColResult[number] extends { id: string; total: number; __children: any[] } ? true : false;
const _t6a: _Test6a = true;

// Should NOT have 'userId' on parent
type _Test6b = "userId" extends keyof Omit<typeof joinColResult[number], "__children"> ? true : false;
const _t6b: _Test6b = false;

// Child should have all fields
type _Test6c = typeof joinColResult[number]["__children"][number] extends {
  id: string; orderId: string; productName: string; quantity: number;
} ? true : false;
const _t6c: _Test6c = true;

// ── 7. .single() on join returns JoinResult | null ─────────────────────────

const joinSingleResult = db
  .leftJoin(orders)
  .on(orderItems)
  .on(eq(orders.id, orderItems.orderId))
  .single()
  .execute();

type _Test7 = null extends typeof joinSingleResult ? true : false;
const _t7: _Test7 = true;

// ── 8. .columns() invalid key is compile error ─────────────────────────────
// Uncomment to verify — should fail to compile:
// db.select().from(users).columns(["nonexistent"]).execute();
// db.select().from(users).columns(["nonexistent"]).execute();

console.log("All type narrowing checks passed at compile time ✓");
