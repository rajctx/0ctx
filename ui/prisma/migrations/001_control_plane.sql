-- CLOUD-002: Control-plane persistence schema
-- Idempotent — safe to re-run (uses IF NOT EXISTS)

-- ── Tenants ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
    tenant_id   TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settings    JSONB NOT NULL DEFAULT '{}'
);

-- ── Connectors ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS connectors (
    machine_id          TEXT PRIMARY KEY,
    tenant_id           TEXT REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    registration_id     TEXT NOT NULL,
    stream_url          TEXT NOT NULL DEFAULT '',
    capabilities        JSONB NOT NULL DEFAULT '["sync","blackboard","commands"]',
    posture             TEXT,
    trust_level         TEXT NOT NULL DEFAULT 'unverified',
    trust_verified_at   TIMESTAMPTZ,
    registered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_connectors_tenant ON connectors(tenant_id);

-- ── Commands ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commands (
    command_id  TEXT PRIMARY KEY,
    machine_id  TEXT NOT NULL REFERENCES connectors(machine_id) ON DELETE CASCADE,
    cursor      BIGSERIAL NOT NULL,
    tenant_id   TEXT,
    context_id  TEXT,
    method      TEXT NOT NULL,
    params      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'failed')),
    result      JSONB,
    error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_commands_machine_status ON commands(machine_id, status, cursor);
CREATE INDEX IF NOT EXISTS idx_commands_tenant ON commands(tenant_id);

-- ── Events ingest ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events_ingest (
    id              TEXT PRIMARY KEY,
    machine_id      TEXT NOT NULL REFERENCES connectors(machine_id) ON DELETE CASCADE,
    tenant_id       TEXT,
    subscription_id TEXT NOT NULL DEFAULT '',
    cursor          BIGINT NOT NULL DEFAULT 0,
    events          JSONB NOT NULL DEFAULT '[]',
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_machine ON events_ingest(machine_id);
CREATE INDEX IF NOT EXISTS idx_events_tenant ON events_ingest(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_received ON events_ingest(received_at DESC);

-- ── Trust challenges ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trust_challenges (
    machine_id  TEXT PRIMARY KEY REFERENCES connectors(machine_id) ON DELETE CASCADE,
    nonce       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL
);
