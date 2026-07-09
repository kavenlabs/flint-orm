import { defineConfig } from '~/config';

export default defineConfig({
  driver: 'libsql',
  schema: './db',
  database: { url: process.env.DATABASE_URL! },
});
