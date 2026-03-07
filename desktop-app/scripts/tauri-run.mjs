#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/tauri-run.mjs <tauri-args...>");
  process.exit(1);
}

const isWindows = process.platform === "win32";
const isBuildCommand = args[0] === "build";
const maxAttempts = isWindows && isBuildCommand ? 3 : 1;
const lockPattern =
  /Failed to clean up .*out[\\/]+probe: .*os error 32|being used by another process/i;
const accessDeniedOutputPattern =
  /failed to remove file .*ctx-desktop\.exe[\s\S]*Access is denied\.\s*\(os error 5\)/i;

const tauriBinary = resolve(
  process.cwd(),
  "node_modules",
  ".bin",
  isWindows ? "tauri.cmd" : "tauri"
);

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function runTauri(attempt) {
  return new Promise((resolveRun) => {
    const env = { ...process.env };

    if (isWindows) {
      const localAppData = env.LOCALAPPDATA || env.TEMP || env.TMP || process.cwd();
      env.CARGO_TARGET_DIR =
        env.CARGO_TARGET_DIR ||
        env.CTX_TAURI_TARGET_DIR ||
        resolve(localAppData, "0ctx", "tauri-target");

      if (isBuildCommand) {
        // Reduce parallelism to lower Windows transient lock contention during crate probes.
        env.CARGO_BUILD_JOBS = env.CARGO_BUILD_JOBS || "1";
        env.CARGO_INCREMENTAL = env.CARGO_INCREMENTAL || "0";
      }
    }

    const child = spawn(tauriBinary, args, {
      cwd: process.cwd(),
      env,
      stdio: ["inherit", "pipe", "pipe"],
      shell: isWindows,
    });

    let combinedOutput = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stdout.write(chunk);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stderr.write(chunk);
    });

    child.on("close", (code) => {
      resolveRun({
        code: code ?? 1,
        isLockError: lockPattern.test(combinedOutput),
        isAccessDeniedOutputError: accessDeniedOutputPattern.test(combinedOutput),
        attempt,
      });
    });
  });
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = await runTauri(attempt);

  if (result.code === 0) {
    process.exit(0);
  }

  if (!(result.isLockError || result.isAccessDeniedOutputError) || attempt === maxAttempts) {
    process.exit(result.code);
  }

  if (isWindows && result.isAccessDeniedOutputError) {
    try {
      const { spawnSync } = await import("node:child_process");
      spawnSync("cmd.exe", ["/c", "taskkill /IM ctx-desktop.exe /F >NUL 2>NUL"], {
        stdio: "ignore",
      });
    } catch {
      // Best effort; retry still gives caller a deterministic outcome.
    }
  }

  console.warn(
    `\nRetrying Tauri build after transient Windows file lock (attempt ${attempt + 1}/${maxAttempts})...`
  );
  await sleep(1500);
}
