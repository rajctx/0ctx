# 0ctx UI

Contributor and docs-oriented web surface for 0ctx.

This app is public in the monorepo, but it is not the primary open-source
entrypoint. For normal usage, start with `@0ctx/cli` and the repo-first local
runtime flow from the repository root.

## What This UI Covers

- The public docs and install guidance pages.
- A lightweight landing page that points users back to the local-first CLI flow.
- Compatibility redirects for old legacy routes.

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

Copy [`ui/.env.example`](./.env.example) to `.env.local` only if you need optional
UI configuration such as Sentry. A clean local build does not initialize Sentry
unless `NEXT_PUBLIC_SENTRY_DSN` is set.

## Build And Checks

```bash
npm run build
npm run typecheck
```

## Key Pages

- `/` is the public landing page.
- `/docs` is the docs index for the local-first product path.
- `/install` is the repo-first setup guide.

## Related Docs

- [`../README.md`](../README.md)
- [`../docs/INDEX.md`](../docs/INDEX.md)
- [`../SUPPORT.md`](../SUPPORT.md)
