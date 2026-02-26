/**
 * CLOUD-002: Prisma v7 client singleton.
 *
 * Uses @prisma/adapter-pg driver adapter for Rust-free architecture.
 * globalThis pattern prevents connection pool exhaustion during Next.js hot-reload.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    // Return a client without adapter for environments where DB is not configured.
    // Operations will fail at query time with a clear error.
    return new PrismaClient();
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
