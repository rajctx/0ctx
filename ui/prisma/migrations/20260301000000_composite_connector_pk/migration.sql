-- Migration: composite (tenant_id, machine_id) PK for connectors
--
-- Fixes: two users with the same hostname (e.g. "MacBook-Pro") would collide
-- on the single-column machine_id PK, allowing cross-tenant data corruption.
-- The fix: every connector is uniquely identified by (tenant_id, machine_id).

-- ── Step 1: Drop all FK constraints that reference connectors.machine_id ──────

ALTER TABLE "commands"        DROP CONSTRAINT IF EXISTS "commands_machine_id_fkey";
ALTER TABLE "events_ingest"   DROP CONSTRAINT IF EXISTS "events_ingest_machine_id_fkey";
ALTER TABLE "trust_challenges" DROP CONSTRAINT IF EXISTS "trust_challenges_machine_id_fkey";

-- ── Step 2: Purge any connector rows without a tenant (orphaned dev data) ─────
-- These rows cannot participate in the composite PK since tenant_id is non-nullable.

DELETE FROM "commands"        WHERE "tenant_id" IS NULL;
DELETE FROM "events_ingest"   WHERE "tenant_id" IS NULL;
DELETE FROM "connectors"      WHERE "tenant_id" IS NULL;

-- ── Step 3: Make tenant_id non-nullable on all tables ────────────────────────

ALTER TABLE "connectors"    ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "commands"      ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "events_ingest" ALTER COLUMN "tenant_id" SET NOT NULL;

-- ── Step 4: Replace connectors PK with composite (tenant_id, machine_id) ──────

ALTER TABLE "connectors" DROP CONSTRAINT "connectors_pkey";
ALTER TABLE "connectors" DROP CONSTRAINT IF EXISTS "connectors_tenant_id_fkey";

ALTER TABLE "connectors" ADD CONSTRAINT "connectors_pkey"
  PRIMARY KEY ("tenant_id", "machine_id");

ALTER TABLE "connectors" ADD CONSTRAINT "connectors_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("tenant_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Step 5: Add tenant_id to trust_challenges, update its PK ─────────────────

ALTER TABLE "trust_challenges" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

-- Back-fill from connectors (best-effort; rows without a connector are dropped)
UPDATE "trust_challenges" tc
SET "tenant_id" = c."tenant_id"
FROM "connectors" c
WHERE c."machine_id" = tc."machine_id";

DELETE FROM "trust_challenges" WHERE "tenant_id" IS NULL;

ALTER TABLE "trust_challenges" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "trust_challenges" DROP CONSTRAINT "trust_challenges_pkey";
ALTER TABLE "trust_challenges" ADD CONSTRAINT "trust_challenges_pkey"
  PRIMARY KEY ("tenant_id", "machine_id");

-- ── Step 6: Re-add FK constraints using composite references ──────────────────

ALTER TABLE "commands" ADD CONSTRAINT "commands_connector_fkey"
  FOREIGN KEY ("tenant_id", "machine_id")
  REFERENCES "connectors"("tenant_id", "machine_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "events_ingest" ADD CONSTRAINT "events_ingest_connector_fkey"
  FOREIGN KEY ("tenant_id", "machine_id")
  REFERENCES "connectors"("tenant_id", "machine_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trust_challenges" ADD CONSTRAINT "trust_challenges_connector_fkey"
  FOREIGN KEY ("tenant_id", "machine_id")
  REFERENCES "connectors"("tenant_id", "machine_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
