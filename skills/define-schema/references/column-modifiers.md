# Column Modifiers Reference

Detailed reference for all column modifiers in flint-orm.

## .primaryKey()

Mark a column as the primary key.

```ts
const id = d.integer().primaryKey();
// SQL: id INTEGER PRIMARY KEY
```

**Notes:**
- Only one column per table can be primary key
- Primary keys are implicitly NOT NULL

## .notNull()

Disallow NULL values.

```ts
const name = d.text().notNull();
// SQL: name TEXT NOT NULL
```

**Notes:**
- Adding NOT NULL to an existing column requires a default value (triggers table rebuild otherwise)
- Removing NOT NULL is an unsafe migration (triggers table rebuild)

## .unique()

Add a unique constraint.

```ts
const email = d.text().unique();
// SQL: email TEXT UNIQUE
```

**Notes:**
- Adding or removing UNIQUE triggers a table rebuild

## .default(value)

Set a static default value.

```ts
const active = d.boolean().default(true);
// SQL: active INTEGER DEFAULT 1

const status = d.text().default('active');
// SQL: status TEXT DEFAULT 'active'
```

**Notes:**
- The value must match the column's TypeScript type
- Removing a default is an unsafe migration (SQLite has no DROP DEFAULT syntax)

## .defaultFn(fn)

Set a dynamic default function called on insert when the value is omitted.

```ts
const id = d.text().defaultFn(() => crypto.randomUUID());
```

**Notes:**
- The function is called at insert time, not at schema definition time
- Useful for UUIDs, timestamps, or computed values

## .references(target)

Define a foreign key reference to another table's column.

```ts
const users = d.snakeCase.table('users', {
  id: d.integer().autoIncrement().primaryKey(),
});

const posts = d.snakeCase.table('posts', {
  userId: d.integer().notNull().references(users.id),
});
// SQL: userId INTEGER NOT NULL REFERENCES users(id)
```

**Notes:**
- The target column must be from a table defined with `table()`
- TypeScript prevents calling `.references()` before the target table exists
- Changing the FK target triggers a table rebuild

## .onDelete(action)

Set the ON DELETE action for a foreign key. Requires `.references()` to be called first.

```ts
const posts = d.snakeCase.table('posts', {
  userId: d.integer().notNull().references(users.id).onDelete('cascade'),
});
// SQL: userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
```

**Valid actions:** `'cascade'`, `'set null'`, `'set default'`, `'restrict'`, `'no action'`

**Notes:**
- Changing ON DELETE action triggers a table rebuild

## .onUpdate(action)

Set the ON UPDATE action for a foreign key. Requires `.references()` to be called first.

```ts
const posts = d.snakeCase.table('posts', {
  userId: d.integer().notNull().references(users.id).onUpdate('cascade'),
});
// SQL: userId INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE
```

**Valid actions:** `'cascade'`, `'set null'`, `'set default'`, `'restrict'`, `'no action'`

**Notes:**
- Changing ON UPDATE action triggers a table rebuild

## .autoIncrement() (integer only)

Mark an integer column as auto-increment (SQLite ROWID alias).

```ts
const id = d.integer().primaryKey().autoIncrement();
// SQL: id INTEGER PRIMARY KEY AUTOINCREMENT
```

**Notes:**
- Only works with integer columns
- Changing autoincrement triggers a table rebuild

## .defaultNow() (date only)

Use `Date.now()` as the default when the value is omitted during insert.

```ts
const createdAt = d.date().defaultNow();
// SQL: created_at INTEGER DEFAULT (unixepoch * 1000)
```

**Notes:**
- Only works with date columns
- Makes the column non-nullable in query results (guaranteed to have a value)

## .onUpdateTimestamp() (date only)

Always set to `Date.now()` on update, regardless of the provided value.

```ts
const updatedAt = d.date().onUpdateTimestamp();
```

**Notes:**
- Only works with date columns
- The value is set automatically on every UPDATE operation
- Not reflected in SQL schema — handled by the ORM at runtime

## Migration Safety

| Change | Safe? | Notes |
|--------|-------|-------|
| Adding NOT NULL with default | ✅ | Safe |
| Adding NOT NULL without default | ❌ | Triggers rebuild |
| Removing NOT NULL | ❌ | Triggers rebuild |
| Adding UNIQUE | ❌ | Triggers rebuild |
| Removing UNIQUE | ❌ | Triggers rebuild |
| Adding/changing DEFAULT | ✅ | Safe |
| Removing DEFAULT | ❌ | SQLite has no DROP DEFAULT |
| Adding/changing FK | ❌ | Triggers rebuild |
| Removing FK | ❌ | Triggers rebuild |
| Changing FK actions | ❌ | Triggers rebuild |
| Changing autoincrement | ❌ | Triggers rebuild |
