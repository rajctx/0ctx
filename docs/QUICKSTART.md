# Quickstart

0ctx is repo-first.

Normal path:

```bash
cd <repo>
0ctx enable
0ctx status
```

What `0ctx enable` does:

1. resolves the repo root
2. creates or binds a workspace for that repo
3. starts or verifies the local daemon
4. installs supported GA capture integrations
5. bootstraps supported GA retrieval integrations
6. reports repo readiness, sync policy, and retention defaults

## Daily use

For supported GA agents, the intended flow is:

1. run `0ctx enable` once in the repo
2. use the agent normally in that repo
3. let 0ctx capture sessions and inject retrieval context automatically

Hosted web pages are optional and currently limited to:

- docs
- install guidance

## Useful commands

```bash
# repo readiness
0ctx status

# inspect workstreams
0ctx workstreams --repo-root .

# inspect sessions
0ctx sessions --repo-root .

# inspect checkpoints
0ctx checkpoints --repo-root .

# advanced repair
0ctx doctor --json
0ctx repair
```

## GA and preview

GA path:

- Claude Code
- Factory / Droid
- Antigravity

Preview path:

- Codex
- Cursor
- Windsurf

Preview integrations are explicit opt-in only and stay outside the normal setup path.
