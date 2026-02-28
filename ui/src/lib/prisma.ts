/**
 * Prisma v7 client singleton.
 *
 * Uses @prisma/adapter-pg (Rust-free architecture).
 * globalThis pattern prevents connection pool exhaustion during Next.js hot-reload.
 *
 * DATABASE_URL must be set. If the database is unreachable on first query,
 * Prisma will throw a clear connection error — no silent degradation.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      '[prisma] DATABASE_URL is not set.\n' +
        '  Local dev:  docker compose up postgres  (then set DATABASE_URL=postgres://ctx:ctx_dev_password@localhost:5432/ctx in ui/.env)\n' +
        '  Cloud dev:  use your Neon or Supabase connection string in ui/.env\n' +
        '  Then run:   npm run db:migrate --prefix ui'
    );
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
