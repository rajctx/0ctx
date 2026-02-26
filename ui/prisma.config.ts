import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Use env('DATABASE_URL') when available; fall back to a dummy value so that
// `prisma generate` can succeed in CI/install contexts where the real URL
// isn't needed (only the schema is read, not the database).
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});
