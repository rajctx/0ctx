/**
 * CLOUD-002: Persistence store for control-plane data.
 *
 * Public surface for the hosted UI store backends and singleton wiring.
 */

export type {
  Command,
  Connector,
  EventIngest,
  Store,
  StoredSyncEnvelope,
  Tenant,
  TrustChallenge,
} from '@/lib/store/types';
export { MemoryStore } from '@/lib/store/memory-store';
export { PrismaStore } from '@/lib/store/prisma-store';
export { getStore, resetStore } from '@/lib/store/singleton';
