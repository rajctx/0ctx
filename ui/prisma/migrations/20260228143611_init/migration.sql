-- CreateTable
CREATE TABLE "tenants" (
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settings" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "connectors" (
    "machine_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "registration_id" TEXT NOT NULL,
    "stream_url" TEXT NOT NULL DEFAULT '',
    "capabilities" JSONB NOT NULL DEFAULT '["sync","blackboard","commands"]',
    "posture" TEXT,
    "trust_level" TEXT NOT NULL DEFAULT 'unverified',
    "trust_verified_at" TIMESTAMPTZ,
    "registered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_heartbeat_at" TIMESTAMPTZ,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("machine_id")
);

-- CreateTable
CREATE TABLE "commands" (
    "command_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "cursor" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "context_id" TEXT,
    "method" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "commands_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "events_ingest" (
    "id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "subscription_id" TEXT NOT NULL DEFAULT '',
    "cursor" BIGINT NOT NULL DEFAULT 0,
    "events" JSONB NOT NULL DEFAULT '[]',
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_ingest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_challenges" (
    "machine_id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "trust_challenges_pkey" PRIMARY KEY ("machine_id")
);

-- CreateIndex
CREATE INDEX "idx_connectors_tenant" ON "connectors"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_commands_machine_status" ON "commands"("machine_id", "status", "cursor");

-- CreateIndex
CREATE INDEX "idx_commands_tenant" ON "commands"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_events_machine" ON "events_ingest"("machine_id");

-- CreateIndex
CREATE INDEX "idx_events_tenant" ON "events_ingest"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_events_received" ON "events_ingest"("received_at" DESC);

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("tenant_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commands" ADD CONSTRAINT "commands_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "connectors"("machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commands" ADD CONSTRAINT "commands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("tenant_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events_ingest" ADD CONSTRAINT "events_ingest_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "connectors"("machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_challenges" ADD CONSTRAINT "trust_challenges_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "connectors"("machine_id") ON DELETE CASCADE ON UPDATE CASCADE;
