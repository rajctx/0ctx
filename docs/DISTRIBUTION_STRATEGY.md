# 0ctx Distribution Strategy & DX

Updated: 2026-02-23

## The Problem
Currently, 0ctx consists of five distinct pieces (`core`, `daemon`, `mcp`, `cli`, `ui`) that users must manually wire together. Running the stack requires starting a background daemon process, configuring an MCP bridge, and launching a Next.js UI separately. This architectural fragmentation causes severe friction in the developer experience (DX).

Industry benchmarks for modern developer tools (e.g., GitHub CLI, Docker Desktop, Supabase CLI, Cursor) mandate a **"single install, single command"** experience. 

## Strategy Overview
We will consolidate the disparate packages into two distinct delivery channels:
1. **Developer Distribution**: A unified CLI package as the single source of truth.
2. **Enterprise/Non-Technical Distribution**: A bundled desktop application.

---

## Phase 1: Unified CLI (DX-01)
**Goal:** Make `@0ctx/cli` the ONLY thing a developer needs to install. 

```bash
# Global NPM install is the easiest path to market for JS devs
npm install -g @0ctx/cli

# Now '0ctx' acts as the god-command
```

### Architecture Constraints
- The `@0ctx/cli` package will take strict dependencies on `@0ctx/daemon`, `@0ctx/mcp`, and `@0ctx/ui`.
- **Auto-start**: When the user types `0ctx auth login` or an editor pings the MCP bridge, the CLI will look for the daemon. If it's not running, the CLI will transparently fork/spawn the daemon process in the background.
- **Embedded UI**: The Next.js dashboard will be built and statically exported into the CLI package bundle. The local daemon will serve these static files directly, removing the need for a separate `npm run dev:ui` process.
- **Bootstrapping**: `0ctx bootstrap` will continue to automatically configure IDEs (VS Code, Cursor, Windsurf) by injecting the single global `0ctx start-mcp` command into their settings.

### User Experience
The user installs one package, types `0ctx auth login`, and their editor immediately has context-aware intelligence. They don't know the daemon exists until they type `0ctx doctor`.

---

## Phase 2: Standalone Desktop App (DX-02)
**Goal:** Reach product managers, architects, and designers who don't have Node.js installed or don't use the terminal.

### Architecture Constraints
- Build a lightweight Electron or Tauri wrapper (Tauri preferred for lower memory footprint).
- **Embedded Binaries**: The desktop app bundles Node.js (or uses `pkg`/`bun compile` to create single executable binaries of the daemon/MCP) so the user does not need an external runtime.
- **System Tray**: The app lives in the macOS menu bar / Windows system tray, showing daemon health and sync status (Connected/Degraded/Offline).
- **Webview UI**: The tray icon opens a webview serving the same unified dashboard built in Phase 1. 

### User Experience
The user downloads a `.dmg` or `.exe`, drags it to Applications, and logs in via the browser. The system tray app automatically starts on boot and handles all background graph synchronization and MCP tooling endpoints.
