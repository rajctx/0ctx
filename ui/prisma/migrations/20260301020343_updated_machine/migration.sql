-- DropForeignKey
ALTER TABLE "commands" DROP CONSTRAINT "commands_tenant_id_fkey";

-- DropIndex
DROP INDEX "idx_connectors_tenant";

-- RenameForeignKey
ALTER TABLE "commands" RENAME CONSTRAINT "commands_connector_fkey" TO "commands_tenant_id_machine_id_fkey";

-- RenameForeignKey
ALTER TABLE "events_ingest" RENAME CONSTRAINT "events_ingest_connector_fkey" TO "events_ingest_tenant_id_machine_id_fkey";

-- RenameForeignKey
ALTER TABLE "trust_challenges" RENAME CONSTRAINT "trust_challenges_connector_fkey" TO "trust_challenges_tenant_id_machine_id_fkey";

-- AddForeignKey
ALTER TABLE "commands" ADD CONSTRAINT "commands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
