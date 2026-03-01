-- CreateTable
CREATE TABLE "sync_envelopes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "context_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL DEFAULT '',
    "timestamp" BIGINT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "sync_policy" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_envelopes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_sync_envelopes_tenant_ts" ON "sync_envelopes"("tenant_id", "timestamp");

-- CreateIndex
CREATE INDEX "idx_sync_envelopes_tenant_ctx" ON "sync_envelopes"("tenant_id", "context_id");

-- CreateIndex
CREATE INDEX "idx_sync_envelopes_received" ON "sync_envelopes"("received_at" DESC);

-- AddForeignKey
ALTER TABLE "sync_envelopes" ADD CONSTRAINT "sync_envelopes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
