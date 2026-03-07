# Linear Backlog

Tracked in Linear under project `0ctx Product Remediation`:

- `0CT-5` Product Contract Reset
- `0CT-6` Agent Retrieval Parity via MCP
- `0CT-7` Repo-Root Enablement Golden Path
- `0CT-8` Lean Local Data Policy
- `0CT-9` Desktop as Management Surface
- `0CT-10` Honest Memory and Git-Aware Workstreams

This file mirrors the execution breakdown in repo form.

## Epic 1: Product Contract Reset

### Issue 1.1
Title: Remove active-context fallback from capture routing

Outcome:

- capture resolves by repo path or explicit override only
- no silent fallback to active workspace

Acceptance criteria:

- capture fails cleanly when repo path does not match a workspace
- all supported integrations share the same routing rule

### Issue 1.2
Title: Reclassify unsupported or unstable integrations as preview

Outcome:

- only stable official contracts are treated as GA

Acceptance criteria:

- Codex, Cursor, and Windsurf are clearly preview in CLI and desktop
- default install path excludes preview integrations

### Issue 1.3
Title: Rename branch lanes to workstreams in product language

Outcome:

- user-facing language matches the real capability

Acceptance criteria:

- desktop, CLI help, and docs use `Workstreams`
- internal schema can remain branch-based

## Epic 2: Agent Retrieval Parity

### Issue 2.1
Title: Add workstream and checkpoint MCP tools

Outcome:

- agents can fetch the same model users see in desktop

Acceptance criteria:

- MCP exposes tools for workstreams, sessions, checkpoints, and insights
- MCP responses are structured for agent use, not only raw JSON dumps

### Issue 2.2
Title: Add compact session-start context injection for supported hosts

Outcome:

- agents receive the right project memory automatically

Acceptance criteria:

- supported hosts get a compact workstream summary at session start
- no manual copy-paste context flow required in the golden path

## Epic 3: Golden Path Enablement

### Issue 3.1
Title: Replace setup flow with repo-root `0ctx enable`

Outcome:

- one command makes the repo ready

Acceptance criteria:

- workspace auto-creation or binding works from cwd
- daemon starts automatically if needed
- integrations install idempotently
- readiness result is reported in one concise success state

### Issue 3.2
Title: Remove `--context-id` from normal daily CLI usage

Outcome:

- normal product commands resolve from repo path or active bound workspace

Acceptance criteria:

- `--context-id` remains available for support and scripting
- primary CLI docs do not require it

## Epic 4: Lean Data Policy

### Issue 4.1
Title: Make raw capture local-only by default

Outcome:

- raw dumps and transcript history do not participate in default sync

Acceptance criteria:

- sync excludes payload sidecars by default
- retention policy is enforced automatically

### Issue 4.2
Title: Add production retention defaults for debug artifacts

Outcome:

- local debug storage remains useful without growing unchecked

Acceptance criteria:

- transcript history and event logs are pruned automatically
- retention defaults are documented and configurable

## Epic 5: Desktop Product Cleanup

### Issue 5.1
Title: Make desktop a management surface, not a required runtime surface

Outcome:

- successful daily use does not depend on opening desktop

Acceptance criteria:

- capture and retrieval work without desktop open
- desktop focuses on workspaces, workstreams, sessions, checkpoints, insights

### Issue 5.2
Title: Demote utilities and internals in desktop

Outcome:

- Graph, Setup, payload inspection, and runtime internals are clearly secondary

Acceptance criteria:

- utilities are not part of the main daily narrative
- support actions are available without dominating the UI

## Epic 6: Honest Memory and Branch Intelligence

### Issue 6.1
Title: Reposition semantic extraction as reviewed insights

Outcome:

- product promises match actual extraction quality

Acceptance criteria:

- UI and docs no longer overclaim automatic knowledge understanding

### Issue 6.2
Title: Add git-native workstream intelligence

Outcome:

- workstreams understand merge-base, ancestry, and divergence

Acceptance criteria:

- ahead/behind and merge-base data are available per workstream
- handoff and checkpoint views can explain branch divergence honestly

## Suggested milestone order

1. Product Contract Reset
2. Agent Retrieval Parity
3. Golden Path Enablement
4. Lean Data Policy
5. Desktop Product Cleanup
6. Honest Memory and Branch Intelligence
