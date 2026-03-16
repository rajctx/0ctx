#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPackagePath = path.join(repoRoot, "packages", "cli", "package.json");
const requiredFiles = [
  "LICENSE",
  "README.md",
  "build.mjs",
  "dist/index.js",
  "dist/daemon.js",
  "dist/mcp-server.js",
  "package.json",
];
const forbiddenPathMatchers = [
  /^src\//,
  /^test\//,
  /^scripts\//,
  /^node_modules\//,
  /^\.github\//,
  /^tsconfig/i,
  /^vitest/i,
  /^package-lock\.json$/i,
  /\.env/i,
];

function runPackDryRun() {
  const result = spawnSync("npm", ["pack", "--workspace=@0ctx/cli", "--dry-run", "--json"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if ((result.status ?? 1) !== 0) {
    const stderr = result.stderr?.trim() || "unknown error";
    throw new Error(`CLI pack dry-run failed: ${stderr}`);
  }

  const raw = result.stdout?.trim();
  if (!raw) {
    throw new Error("CLI pack dry-run returned no JSON output.");
  }

  const parsed = JSON.parse(raw);
  const pack = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!pack || typeof pack !== "object") {
    throw new Error("CLI pack dry-run JSON did not include a package summary.");
  }

  return pack;
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(cliPackagePath, "utf8"));
}

function main() {
  const pack = runPackDryRun();
  const packageJson = readPackageJson();
  const files = Array.isArray(pack.files)
    ? pack.files
        .map((entry) => String(entry.path || "").trim())
        .filter(Boolean)
        .sort()
    : [];

  const missingRequiredFiles = requiredFiles.filter((file) => !files.includes(file));
  const forbiddenFiles = files.filter((file) => forbiddenPathMatchers.some((matcher) => matcher.test(file)));
  const metadataChecks = {
    license: packageJson.license === "Apache-2.0",
    homepage: typeof packageJson.homepage === "string" && packageJson.homepage.startsWith("https://"),
    bugsUrl: typeof packageJson.bugs?.url === "string" && packageJson.bugs.url.startsWith("https://"),
    repositoryUrl:
      typeof packageJson.repository?.url === "string" &&
      packageJson.repository.url === "https://github.com/0ctx-com/0ctx.git",
  };

  const ok =
    missingRequiredFiles.length === 0 &&
    forbiddenFiles.length === 0 &&
    Object.values(metadataChecks).every(Boolean);

  const result = {
    ok,
    packageName: pack.name ?? packageJson.name ?? null,
    version: pack.version ?? packageJson.version ?? null,
    filename: pack.filename ?? null,
    packageSize: pack.size ?? null,
    unpackedSize: pack.unpackedSize ?? null,
    totalFiles: files.length,
    files,
    missingRequiredFiles,
    forbiddenFiles,
    metadataChecks,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!ok) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
