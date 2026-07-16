// ---------------------------------------------------------------------------
// defineMigration — the function used in migration files to declare
// what operations a migration performs.
// ---------------------------------------------------------------------------

import type { MigrationFile, MigrationOperation } from './types';

export function defineMigration(config: { name: string; operations: MigrationOperation[] }): MigrationFile {
  return {
    name: config.name,
    operations: config.operations,
  };
}
