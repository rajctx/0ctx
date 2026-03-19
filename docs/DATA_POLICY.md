# Data Policy

0ctx is local-first.

Local daemon + SQLite are the source of truth.

## Default policy

New workspaces default to:

- workspace data policy: `local_only`
- local capture retention: `14` days
- debug-heavy artifacts retention: `7` days
- debug-heavy artifacts: off by default

This is the lean normal path.

## What stays local

Local state lives under `~/.0ctx/` and can include:

- SQLite database
- hook dumps
- transcript snapshots
- backups

Debug-heavy artifacts are reduced by default.

## Legacy remote sync states

`metadata_only`:

- legacy workspace setting from older builds
- no longer part of the supported local-only path

`full_sync`:

- legacy workspace setting from older builds
- should be normalized back to `local_only`

## Product rule

Payload and debug data are utility-only.

They are available for:

- support
- debugging
- advanced inspection

They should not dominate the normal product workflow.
