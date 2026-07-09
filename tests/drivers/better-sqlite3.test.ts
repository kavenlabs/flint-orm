// better-sqlite3 native bindings are not supported in Bun.
// To run these tests: node --test tests/drivers/better-sqlite3.test.ts
import { describe } from 'bun:test';
describe.skip('BetterSqlite3Executor (requires Node.js, not Bun)', () => {});
