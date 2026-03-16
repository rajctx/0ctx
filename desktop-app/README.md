# 0ctx Desktop Electron

Contributor and dev-focused Electron surface for 0ctx.

## Commands

```bash
npm install
npm run dev
npm run build
npm run build:debug
npm run package
npm run smoke
npm run test
```

## Architecture

- `src/main/*` owns Electron, tray, updater, shell access, connector supervision, and daemon IPC.
- `src/preload` exposes the typed `window.octxDesktop` bridge.
- `src/shared/*` defines contracts shared by main, preload, renderer, and tests.
- `src/renderer/routes/*` owns the four-route shell and page composition boundaries.
- `src/renderer/screens/*` composes the four Paper-aligned top-level surfaces.
- `src/renderer/features/*` owns server-state queries and contextual flows like checkpoints and reviewed insights.
- `src/renderer/design-system/*` owns tokens, primitives, and shell styling.
