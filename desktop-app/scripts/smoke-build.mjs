#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");

if (!fs.existsSync(tauriConfigPath)) {
  console.error(`Missing Tauri config: ${tauriConfigPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
const updaterEndpoints = config?.plugins?.updater?.endpoints;

if (!Array.isArray(updaterEndpoints) || updaterEndpoints.length === 0) {
  console.error("Desktop updater endpoints are not configured in src-tauri/tauri.conf.json.");
  process.exit(1);
}

const run = spawnSync("node", ["scripts/tauri-run.mjs", "build", "--debug"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(run.status ?? 1);
