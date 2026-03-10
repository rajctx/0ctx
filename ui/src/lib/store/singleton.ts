import type { Store } from '@/lib/store/types';
import { MemoryStore } from '@/lib/store/memory-store';
import { PrismaStore } from '@/lib/store/prisma-store';

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;

  if (process.env.DATABASE_URL) {
    store = new PrismaStore();
    return store;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production. Set it in your environment and re-deploy.');
  }

  console.warn(
    '[store] DATABASE_URL not set — using in-memory store. Data will NOT persist. ' +
      'Set DATABASE_URL in ui/.env or run: docker compose up postgres'
  );
  store = new MemoryStore();
  return store;
}

export function resetStore(): void {
  store = null;
}
