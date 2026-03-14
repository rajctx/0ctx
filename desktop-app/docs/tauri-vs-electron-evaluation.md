# Tauri vs Electron Evaluation

Date: March 13, 2026

Decision: Stay on Tauri.

## Why this memo exists

The current redesign goal is a Perplexity-inspired dark shell with a stable sidebar, readable center column, and adjacent support rail. That is a frontend/layout problem first. A runtime migration only makes sense if Tauri or the host WebView blocks the required product behavior.

## Current Tauri-native responsibilities already in use

The desktop app is not a thin browser shell. It already depends on Tauri-native behavior in [desktop-app/package.json](/Users/Rajesh/development/0ctx-dev/desktop-app/package.json) and [desktop-app/src-tauri/src/lib.rs](/Users/Rajesh/development/0ctx-dev/desktop-app/src-tauri/src/lib.rs):

- System tray lifecycle and tray menu actions.
- Connector supervision and restart behavior.
- Folder picker integration via `tauri-plugin-dialog`.
- Updater flow via `tauri-plugin-updater`.
- Desktop window focus/show behavior.
- Local daemon IPC bridge over named pipes or Unix sockets.
- Event subscription and posture polling bridged into frontend events.
- Native path opening and desktop restart utilities.

Replacing Tauri with Electron would therefore be a platform rewrite, not a design fix.

## Missing capabilities for the planned UX

None found for the current scope.

The intended shell needs:

- a stable sidebar,
- a calm topbar,
- a center reader column,
- a right-side support rail,
- persistent local theme state,
- standard desktop dialogs and runtime controls.

All of that fits inside the current Tauri + web frontend model.

## Tauri/WebView-specific constraints

Official Tauri docs describe the runtime as a Rust host plus the platform webview instead of shipping a browser runtime with the app:

- [Tauri process model](https://v2.tauri.app/concept/process-model/)
- [Tauri architecture](https://v2.tauri.app/concept/architecture/)

Practical impact for this repo:

- UI rendering quality depends partly on the platform WebView, so the team should avoid Chromium-only assumptions for typography, form controls, and layout polish.
- Cross-platform visual QA matters more because Windows WebView2, WKWebView, and Linux WebKitGTK are not identical.
- Browser-engine quirks still exist, but none of the planned sidecar/split-focus interactions require Chromium-only APIs.

## Constraints that still exist in Electron

Electron does not remove desktop-app architecture complexity. Official Electron docs still require a main process plus renderer processes and continued IPC discipline:

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance)

Even after a migration, this app would still need:

- a secure native bridge,
- IPC between UI and desktop runtime,
- strict main-process discipline,
- tray/menu/update wiring,
- the same product information architecture and visual design work.

Electron would not solve overlapping text, weak hierarchy, or shell composition by itself.

## Startup, package, and runtime tradeoffs

Tauri docs explicitly emphasize the smaller-host model because the app uses the system WebView instead of embedding its own browser runtime.

Inference:

- Staying on Tauri should keep package size and native-runtime overhead lower for this desktop companion.
- Migrating to Electron would likely increase package size and runtime footprint because the app would move to Electron's bundled Chromium/Node model instead of the current system-WebView approach.
- Migration cost would include redoing updater, tray, dialog, IPC, and process supervision surfaces that already exist in Rust today.

## Exit criteria for reconsidering Electron

Reopen the decision only if a concrete blocker appears, for example:

- a required Chromium-only windowing or web-platform capability,
- a reproducible platform WebView limitation that breaks the intended product UX,
- or a Tauri-native integration gap that cannot be closed without unacceptable product compromise.

No such blocker is present in this repo today.

## Final recommendation

Stay on Tauri and spend effort on:

- theme architecture,
- shell layout,
- typography and spacing,
- metadata rendering robustness,
- cross-width visual QA.

Those changes directly address the actual desktop UI problem.
