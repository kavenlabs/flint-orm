# Condition Operators Reference

Detailed reference for all condition operators in flint-orm.

All conditions are imported from `flint-orm/expressions`.

## Comparison Operators

### eq(column, value)

Equal comparison.

```ts
import { eq } from 'flint-orm/expressions';

// Value comparison
eq(users.name, 'Alice')  // name = 'Alice'

// Column-to-column comparison
eq(posts.userId, users.id)  // posts.userId = users.id
```

### neq(column, value)

Not equal comparison.

```ts
import { neq } from 'flint-orm/expressions';

neq(users.id, 'excluded')  // id != 'excluded'
```

### gt(column, value)

Greater than.

```ts
import { gt } from 'flint-orm/expressions';

gt(users.age, 18)  // age > 18
```

### gte(column, value)

Greater than or equal.

```ts
import { gte } from 'flint-orm/expressions';

gte(users.age, 18)  // age >= 18
```

### lt(column, value)

Less than.

```ts
import { lt } from 'flint-orm/expressions';

lt(users.age, 65)  // age < 65
```

### lte(column, value)

Less than or equal.

```ts
import { lte } from 'flint-orm/expressions';

lte(users.age, 65)  // age <= 65
```

## Range Operator

### between(column, low, high)

Between two values (inclusive).

```ts
import { between } from 'flint-orm/expressions';

between(users.age, 18, 65)  // age BETWEEN 18 AND 65
```

## Null Check Operators

### isNull(column)

Check for NULL.

```ts
import { isNull } from 'flint-orm/expressions';

isNull(users.deletedAt)  // deletedAt IS NULL
```

### isNotNull(column)

Check for NOT NULL.

```ts
import { isNotNull } from 'flint-orm/expressions';

isNotNull(users.email)  // email IS NOT NULL
```

## Array Operators

### isIn(column, values)

Check if value is in array.

```ts
import { isIn } from 'flint-orm/expressions';

isIn(users.id, ['u1', 'u2', 'u3'])  // id IN ('u1', 'u2', 'u3')
```

### isNotIn(column, values)

Check if value is not in array.

```ts
import { isNotIn } from 'flint-orm/expressions';

isNotIn(users.id, ['excluded'])  // id NOT IN ('excluded')
```

## Pattern Matching Operators

### like(column, pattern)

SQL LIKE pattern matching (% = any characters, _ = single char, case-insensitive).

```ts
import { like } from 'flint-orm/expressions';

like(users.name, 'A%')  // name LIKE 'A%'
```

### glob(column, pattern)

SQL GLOB pattern matching (* = any characters, ? = single char, case-sensitive).

```ts
import { glob } from 'flint-orm/expressions';

glob(users.name, 'A*')  // name GLOB 'A*'
```

## Logical Operators

### and(...conditions)

Logical AND.

```ts
import { and, eq, gt } from 'flint-orm/expressions';

and(eq(users.active, true), gt(users.age, 18))
// active = 1 AND age > 18
```

### or(...conditions)

Logical OR (wraps in parentheses).

```ts
import { or, eq } from 'flint-orm/expressions';

or(eq(users.role, 'admin'), eq(users.role, 'moderator'))
// (role = 'admin' OR role = 'moderator')
```

## Composing Conditions

Conditions can be nested and combined:

```ts
import { and, or, eq, gt, lte, isIn } from 'flint-orm/expressions';

// Complex condition
and(
  or(eq(users.role, 'admin'), eq(users.role, 'moderator')),
  gt(users.age, 18),
  isIn(users.status, ['active', 'pending'])
)
// ((role = 'admin' OR role = 'moderator') AND age > 18 AND status IN ('active', 'pending'))
```

## Column-to-Column Comparisons

`eq` supports comparing two columns:

```ts
import { eq } from 'flint-orm/expressions';

// Compare columns from different tables (useful for joins)
eq(posts.userId, users.id)
```

## Operator Summary

| Operator | SQL | Notes |
|----------|-----|-------|
| `eq` | `=` | Supports column-to-column |
| `neq` | `!=` | |
| `gt` | `>` | |
| `gte` | `>=` | |
| `lt` | `<` | |
| `lte` | `<=` | |
| `between` | `BETWEEN` | Inclusive range |
| `isNull` | `IS NULL` | |
| `isNotNull` | `IS NOT NULL` | |
| `isIn` | `IN` | Array of values |
| `isNotIn` | `NOT IN` | Array of values |
| `like` | `LIKE` | % and _ wildcards, case-insensitive |
| `glob` | `GLOB` | * and ? wildcards, case-sensitive |
| `and` | `AND` | Composable |
| `or` | `OR` | Wraps in parentheses |
