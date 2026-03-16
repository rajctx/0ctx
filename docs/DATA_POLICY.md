# Data Policy

0ctx is local-first.

Local daemon + SQLite are the source of truth.

## Default policy

New workspaces default to:

- sync policy: `metadata_only`
- local capture retention: `14` days
- debug-heavy artifacts retention: `7` days
- debug-heavy artifacts: off by default

This is the lean normal path.

## What stays local

Local state lives under `~/.0ctx/` and can include:

- SQLite database
- connector state
- queue state
- hook dumps
- transcript snapshots
- backups

Debug-heavy artifacts are reduced by default.

## What cloud sync means

`metadata_only`:

- the normal default
- keeps local capture rich
- sends only minimal synced metadata

`full_sync`:

- explicit opt-in only
- should be chosen deliberately

## Product rule

Payload and debug data are utility-only.

They are available for:

- support
- debugging
- advanced inspection

They should not dominate the normal product workflow.
