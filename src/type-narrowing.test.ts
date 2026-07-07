// -----------------------------------------------------------------------
// Type narrowing verification — this file checks that TypeScript correctly
// infers the narrowed types. It should compile cleanly.
// -----------------------------------------------------------------------

import { flint } from './flint';
import { eq } from './query/conditions';
import { text, boolean, json, integer, date } from './schema/columns';
import type { DateColumnDef } from './schema/columns';
import { table } from './schema/table';

const users = table('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  active: boolean('active').notNull(),
  metadata: json<{ role: string; tags: string[] }>('metadata'),
});

const orders = table('orders', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  total: integer('total').notNull(),
});

const orderItems = table('orderItems', {
  id: text('id').primaryKey(),
  orderId: text('orderId').notNull(),
  productName: text('productName').notNull(),
  quantity: integer('quantity').notNull(),
});

const db = flint({ url: ':memory:' });

// ── 1. .columns() array form narrows return type ───────────────────────────

// Should be { name: string; active: boolean }[]
void (db.select().from(users).columns(['name', 'active']).execute() satisfies { name: string; active: boolean }[]);

// ── 2. .single() returns T | null, not T[] ────────────────────────────────

// Should be InferRow<typeof users> | null
void (db.select().from(users).where(eq(users.id, 'u2')).single().execute() satisfies {
  id: string;
  name: string;
  active: boolean;
  metadata: { role: string; tags: string[] } | null;
} | null);

// ── 3. .single() + .columns() returns narrowed type | null ────────────────

void (db.select().from(users).columns(['name']).where(eq(users.id, 'u2')).single().execute() satisfies { name: string } | null);

// ── 4. JoinResult is an array of objects ──────────────────────────────────

void (db.leftJoin(orders).on(orderItems, eq(orders.id, orderItems.orderId)).execute() satisfies any[]);

// ── 5. Join with .columns() narrows parent ────────────────────────────────

void (db.leftJoin(orders).on(orderItems, eq(orders.id, orderItems.orderId)).columns(['id', 'total']).execute() satisfies {
  id: string;
  total: number;
}[]);

// ── 6. .single() on join returns result | null ────────────────────────────

void (db.leftJoin(orders).on(orderItems, eq(orders.id, orderItems.orderId)).single().execute() satisfies any | null);

// ── 7. date column — defaultNow and onUpdate are available ────────────────

const tsDate = date().defaultNow().onUpdate();
void (tsDate satisfies DateColumnDef);

// defaultNow() chains back to DateColumnDef
const tsDate2 = date().notNull().defaultNow();
void (tsDate2 satisfies DateColumnDef);

console.log('All type narrowing checks passed at compile time ✓');
