# @0ctx/cli

`@0ctx/cli` is the primary open-source entrypoint for 0ctx.

It provides the `0ctx` command for:

- enabling 0ctx in a repository
- starting and checking the local runtime
- bootstrapping supported agent integrations
- running support and repair workflows

## Install

```bash
npm install -g @0ctx/cli
cd <repo>
0ctx enable
0ctx status
```

## Monorepo Development

From the repository root:

```bash
npm install
npm run build
npm run cli:install-local
```

## Notes

- The CLI is the supported OSS package surface for this repository.
- The daemon and MCP runtimes are bundled into the CLI package for the normal local workflow.
- For repository-wide documentation, contribution rules, and security reporting, see the root `README.md`, `CONTRIBUTING.md`, and `SECURITY.md`.
