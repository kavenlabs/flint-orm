// Compile-time-only type tests — this file should fail `tsc` if eq() doesn't
// enforce the column's _type on the value argument.

import { boolean, text, json } from './schema/columns';
import { table } from './schema/table';
import { eq } from './query/conditions';

const users = table('users', {
  id: text('id'),
  active: boolean('active'),
  metadata: json<{ role: string }>('metadata'),
});

// ✅ These should compile fine:
eq(users.active, true);
eq(users.id, 'alice');
eq(users.metadata, { role: 'admin' });

// ❌ These should ALL fail to compile:
// @ts-expect-error - string is not assignable to boolean
eq(users.active, 'not-a-boolean');

// @ts-expect-error - number is not assignable to string
eq(users.id, 42);

// @ts-expect-error - string is not assignable to { role: string }
eq(users.metadata, 'bad');
