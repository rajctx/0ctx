---
name: 0ctx-release-gates
description: Run deterministic release-readiness checks for 0ctx and summarize failures with actionable next fixes. Use when users ask if the app is ship-ready, request CI-equivalent local validation, or want pre-release confidence.
---

# 0ctx Release Gates

Use this skill to run consistent readiness checks and provide a concise ship/no-ship summary.

## Execute

Run the bundled gate script:

```powershell
powershell -ExecutionPolicy Bypass -File skills/0ctx-release-gates/scripts/run-gates.ps1
```

This runs:

1. `npm run typecheck`
2. `npm run build`
3. `npm run test`
4. `npm run bootstrap:mcp:dry`

## Report Format

Provide:

1. Gate status (`pass` / `fail`) per command.
2. First failing command output summary.
3. Concrete next fix step.
4. Final recommendation: `ship` or `hold`.

## Decision Rule

- `ship` only if all gates pass.
- `hold` if any gate fails.
