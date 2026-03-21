# Changelog

All notable changes to 0ctx are tracked here.

## [Unreleased]

### Platform (Core/Daemon/MCP)
- _None recorded._

### Product (CLI/UI)
- _None recorded._

### Governance & Release
- _None recorded._

### Security & Compliance
- _None recorded._

## [v0.1.18] - 2026-03-21

### Platform (Core/Daemon/MCP)
- _None recorded._

### Product (CLI/UI)
- Added the desktop shell with overview, workstreams, sessions, and setup surfaces.
- Added workspace deletion to the CLI and desktop app, including desktop row actions and confirmation flow.
- Simplified Codex notify configuration back to the direct `0ctx hook ingest` path without extra local launcher indirection.
- Fixed the packaged desktop app startup path so it no longer crashes on machines that do not have repo-local workspace packages available.

### Governance & Release
- Updated dependency baselines used by the desktop and CLI release surfaces.

### Security & Compliance
- _None recorded._

## [v0.1.17] - 2026-03-19

### Platform (Core/Daemon/MCP)
- _None recorded._

### Product (CLI/UI)
- _None recorded._

### Governance & Release
- _None recorded._

### Security & Compliance
- _None recorded._

## [v0.1.2] - 2026-02-28

### Platform (Core/Daemon/MCP)
- _None recorded._

### Product (CLI/UI)
- _None recorded._

### Governance & Release
- _None recorded._

### Security & Compliance
- _None recorded._

## [v0.1.1] - 2026-02-28

### Platform (Core/Daemon/MCP)
- _None recorded._

### Product (CLI/UI)
- _None recorded._

### Governance & Release
- _None recorded._

### Security & Compliance
- _None recorded._

## [v0.1.0] - 2026-02-28

### Platform (Core/Daemon/MCP)
- _None recorded._

### Product (CLI/UI)
- _None recorded._

### Governance & Release
- _None recorded._

### Security & Compliance
- _None recorded._

### Platform (Core/Daemon/MCP)

- Added enterprise hardening features across core/daemon/mcp (audit, backup, metrics, protocol/session).

### Product (CLI/UI)

- Added product CLI (`@0ctx/cli`) for install/bootstrap/doctor/repair workflows.
- Added MCP auto-bootstrap for Claude/Cursor/Windsurf.

### Governance & Release

- Added GitHub governance and repo management docs/templates.
- Changed build/typecheck graph to include the CLI package.
- Changed agent guidance for enterprise workflow and repository policy.

### Security & Compliance

- _None recorded._
