#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(repoRoot, "desktop-app");
const desktopPackage = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
const version = desktopPackage.version;
const outputRoot = path.resolve(repoRoot, process.env.RELEASES_DIR || "releases", "desktop", `v${version}`);
const skipBuild = process.argv.includes("--skip-build");
const asJson = process.argv.includes("--json");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
    shell: process.platform === "win32",
    encoding: options.encoding ?? "utf8",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result;
}

function resolveTargetDir() {
  if (process.env.CARGO_TARGET_DIR) {
    return path.resolve(process.env.CARGO_TARGET_DIR);
  }
  if (process.env.CTX_TAURI_TARGET_DIR) {
    return path.resolve(process.env.CTX_TAURI_TARGET_DIR);
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || process.env.TEMP || process.env.TMP;
    if (!localAppData) {
      throw new Error("LOCALAPPDATA is required on Windows to locate the Tauri target dir.");
    }
    return path.join(localAppData, "0ctx", "tauri-target");
  }
  return path.join(desktopRoot, "src-tauri", "target");
}

function collectBundleFiles(bundleRoot) {
  if (!fs.existsSync(bundleRoot)) {
    return [];
  }
  const results = [];
  const stack = [bundleRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
      continue;
    }
    results.push(current);
  }
  return results.sort();
}

function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

async function main() {
  if (!skipBuild) {
    run("npm", ["run", "build", "--prefix", "desktop-app"]);
  }

  const bundleRoot = path.join(resolveTargetDir(), "release", "bundle");
  const bundleFiles = collectBundleFiles(bundleRoot);
  if (bundleFiles.length === 0) {
    throw new Error(`No desktop bundle artifacts were found under ${bundleRoot}`);
  }

  fs.mkdirSync(outputRoot, { recursive: true });
  const copied = [];
  for (const sourcePath of bundleFiles) {
    const relativePath = path.relative(bundleRoot, sourcePath);
    const destPath = path.join(outputRoot, relativePath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(sourcePath, destPath);
    copied.push({
      sourcePath,
      relativePath,
      outputPath: destPath,
      bytes: fs.statSync(destPath).size,
      sha256: sha256(destPath),
    });
  }

  const checksumLines = copied.map((entry) => `${entry.sha256}  ${entry.relativePath}`);
  const checksumPath = path.join(outputRoot, "SHA256SUMS.txt");
  fs.writeFileSync(checksumPath, `${checksumLines.join("\n")}\n`, "utf8");

  const report = {
    ok: true,
    version,
    outputRoot,
    checksumPath,
    artifacts: copied,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Desktop artifacts packaged at ${outputRoot}`);
  for (const artifact of copied) {
    console.log(`  ${artifact.relativePath} (${artifact.bytes} bytes)`);
  }
  console.log(`Checksums: ${checksumPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
