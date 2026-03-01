/**
 * Prisma v7 client singleton.
 *
 * Uses @prisma/adapter-pg (Rust-free architecture).
 * globalThis pattern prevents connection pool exhaustion during Next.js hot-reload.
 *
 * Initialization is lazy (via getPrisma()) so this module can be statically
 * imported without DATABASE_URL — important for local dev with MemoryStore.
 * When DATABASE_URL *is* set, the first call to getPrisma() creates the client.
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

/**
 * Returns the singleton PrismaClient, creating it on first call.
 * Throws if DATABASE_URL is not set.
 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}
