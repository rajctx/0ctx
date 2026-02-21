---
name: 0ctx-mcp-bootstrap
description: Automatically register the 0ctx MCP server in local AI client config files (Claude, Cursor, Windsurf) and verify the registration. Use when users ask to avoid manual MCP config edits, set up MCP on a new machine, or repair broken MCP client integration.
---

# 0ctx MCP Bootstrap

Use this workflow to make 0ctx MCP registration effectively automatic for supported desktop clients.

## Execute

1. Build MCP artifacts:

```bash
npm run build
```

2. Preview config changes:

```bash
npm run bootstrap:mcp:dry
```

3. Apply registration:

```bash
npm run bootstrap:mcp
```

4. Optionally limit clients:

```bash
npm run bootstrap:mcp -- --clients=claude,cursor
```

5. Restart target AI apps so they reload config.

## Verify

Run the bundled verifier:

```powershell
powershell -ExecutionPolicy Bypass -File skills/0ctx-mcp-bootstrap/scripts/verify-config.ps1
```

Expect `mcpServers.0ctx` with:
- `command` pointing to Node executable
- `args` containing `packages/mcp/dist/index.js`

## Repair Guidance

If bootstrap reports `skipped`:
- Ensure the client is installed and launched at least once (so config directories exist).
- Re-run bootstrap.

If bootstrap reports `failed`:
- Capture path + error.
- Fix file permissions or invalid JSON.
- Re-run dry-run first, then apply.
