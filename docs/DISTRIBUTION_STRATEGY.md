# 0ctx Distribution Strategy and DevX

Updated: 2026-02-24

## Goal

Deliver a no-clone, low-friction user experience where a single CLI install sets up the local runtime and connects users to the hosted 0ctx UI.

## Canonical Runtime Model

- End-user runtime package: `@0ctx/cli`
- Hosted UI: `https://app.0ctx.com` (or configured `ui.url`)
- Local runtime: daemon + connector/service + MCP bootstrap
- Contributor UI code remains in `packages/ui`, but is not bundled into end-user CLI runtime

## First-Run Experience

```bash
npm install -g @0ctx/cli
0ctx setup --clients=all
```

`0ctx setup` performs:
1. Auth check/login
2. Managed local runtime startup
3. MCP bootstrap for supported clients
4. Runtime verification (`status` + `sync status`)
5. Hosted dashboard handoff

## Command Surface

- `0ctx setup` (recommended onboarding path)
- `0ctx dashboard` (open hosted dashboard URL)
- `0ctx connector <action>` (service + verification surface)
- Advanced compatibility commands remain:
  - `0ctx install`
  - `0ctx bootstrap`
  - `0ctx doctor`
  - `0ctx status`
  - `0ctx repair`

## Packaging Constraints

- Do not package `@0ctx/ui` runtime assets in CLI release artifacts.
- Keep CLI focused on local runtime lifecycle, onboarding, and diagnostics.
- Keep hosted UI deployment and versioning independent from CLI publish cadence.

## Distribution Channels

1. **CLI channel (primary)**
- npm global install of `@0ctx/cli`
- best for developers and technical operators

2. **Desktop channel (future)**
- optional desktop app for non-terminal workflows
- reuses hosted UI and local connector/service runtime

## Acceptance Criteria

- End users do not need to run a local Next.js UI server.
- `0ctx setup` is sufficient to onboard a new machine.
- Hosted UI connectivity and runtime posture are visible in CLI diagnostics.
- Docs and tracker do not claim embedded local UI packaging in CLI path.
