# 0ctx Hosted UI

This app is the hosted web surface for 0ctx docs and install guidance.

It is public in this monorepo, but it is not the primary open-source entrypoint.
For normal OSS usage, start with `@0ctx/cli` and the repo-first local runtime
flow from the repository root.

## Status

- Purpose: hosted docs and install surface
- Audience: contributors and maintainers working on the hosted web experience
- Support level: best-effort compared with the CLI/runtime path

## Local Development

From the repository root:

```bash
npm install
npm run dev:ui
```

Or from `ui/` directly:

```bash
npm run dev
```

## Environment

Copy `ui/.env.example` to `.env.local` only if you need optional hosted-service
configuration such as Sentry. A clean local build does not initialize Sentry
unless `NEXT_PUBLIC_SENTRY_DSN` is set.

## Build And Checks

```bash
npm run build
npm run typecheck
```

## Related Docs

- `../README.md`
- `../docs/INDEX.md`
- `../SUPPORT.md`
