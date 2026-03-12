#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const verificationRoot = path.join(repoRoot, "releases", "verification");
const reportPath = path.join(verificationRoot, "release-readiness.json");

function run(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const durationMs = Date.now() - startedAt;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    command: `${command} ${args.join(" ")}`,
    ok: (result.status ?? 1) === 0,
    status: result.status ?? 1,
    durationMs,
    stdout,
    stderr,
  };
}

function parseJsonOutput(runResult) {
  const text = (runResult.stdout ?? "").trim();
  if (!text) {
    throw new Error(`No JSON output from ${runResult.command}`);
  }
  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) {
    throw new Error(`No JSON payload found in output from ${runResult.command}`);
  }
  return JSON.parse(text.slice(firstBrace));
}

function getGitState() {
  const head = run("git", ["rev-parse", "HEAD"], { captureOutput: true });
  if (!head.ok) {
    throw new Error(`Unable to read git HEAD.\nstderr:\n${head.stderr}`);
  }
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { captureOutput: true });
  const status = run("git", ["status", "--short"], { captureOutput: true });
  return {
    head: head.stdout.trim(),
    branch: branch.ok ? branch.stdout.trim() : null,
    dirty: Boolean(status.stdout.trim()),
    statusShort: status.stdout.trim().split(/\r?\n/).filter(Boolean),
  };
}

function summarizeStep(runResult) {
  return {
    command: runResult.command,
    ok: runResult.ok,
    status: runResult.status,
    durationMs: runResult.durationMs,
  };
}

function parsePackDryRun(runResult) {
  const text = `${runResult.stdout ?? ""}\n${runResult.stderr ?? ""}`;
  const filename = text.match(/filename:\s+([^\r\n]+)/i)?.[1]?.trim() ?? null;
  const packageName = text.match(/name:\s+([^\r\n]+)/i)?.[1]?.trim() ?? null;
  const version = text.match(/version:\s+([^\r\n]+)/i)?.[1]?.trim() ?? null;
  const packageSize = text.match(/package size:\s+([^\r\n]+)/i)?.[1]?.trim() ?? null;
  const unpackedSize = text.match(/unpacked size:\s+([^\r\n]+)/i)?.[1]?.trim() ?? null;
  const totalFilesText = text.match(/total files:\s+([^\r\n]+)/i)?.[1]?.trim() ?? null;
  const totalFiles = totalFilesText ? Number.parseInt(totalFilesText, 10) : null;
  return {
    packageName,
    version,
    filename,
    packageSize,
    unpackedSize,
    totalFiles: Number.isFinite(totalFiles) ? totalFiles : null,
  };
}

function main() {
  const git = getGitState();

  const typecheck = run("npm", ["run", "typecheck"], { captureOutput: true });
  if (!typecheck.ok) {
    throw new Error(`Typecheck failed.\nstdout:\n${typecheck.stdout}\nstderr:\n${typecheck.stderr}`);
  }

  const build = run("npm", ["run", "build"], { captureOutput: true });
  if (!build.ok) {
    throw new Error(`Build failed.\nstdout:\n${build.stdout}\nstderr:\n${build.stderr}`);
  }

  const packDryRun = run("npm", ["run", "release:pack:dry"], { captureOutput: true });
  if (!packDryRun.ok) {
    throw new Error(`CLI pack dry-run failed.\nstdout:\n${packDryRun.stdout}\nstderr:\n${packDryRun.stderr}`);
  }

  const test = run("npm", ["run", "test"], { captureOutput: true });
  if (!test.ok) {
    throw new Error(`Tests failed.\nstdout:\n${test.stdout}\nstderr:\n${test.stderr}`);
  }

  const ga = run("npm", ["run", "release:e2e:ga"], { captureOutput: true });
  if (!ga.ok) {
    throw new Error(`GA e2e failed.\nstdout:\n${ga.stdout}\nstderr:\n${ga.stderr}`);
  }

  const daily = run("npm", ["run", "release:e2e:daily"], { captureOutput: true });
  if (!daily.ok) {
    throw new Error(`Daily flow e2e failed.\nstdout:\n${daily.stdout}\nstderr:\n${daily.stderr}`);
  }

  const desktopReal = run("npm", ["run", "release:e2e:desktop:real"], { captureOutput: true });

  const desktopSmoke = run("npm", ["run", "desktop:smoke"], { captureOutput: true });
  if (!desktopSmoke.ok) {
    throw new Error(`Desktop smoke failed.\nstdout:\n${desktopSmoke.stdout}\nstderr:\n${desktopSmoke.stderr}`);
  }

  const nestedGit = run("npm", ["run", "repo:check-nested-git"], { captureOutput: true });
  if (!nestedGit.ok) {
    throw new Error(`Nested git check failed.\nstdout:\n${nestedGit.stdout}\nstderr:\n${nestedGit.stderr}`);
  }

  const gaReport = parseJsonOutput(ga);
  const dailyReport = parseJsonOutput(daily);
  const desktopRealReport = desktopReal.ok ? parseJsonOutput(desktopReal) : null;

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    git,
    steps: {
      typecheck: summarizeStep(typecheck),
      build: summarizeStep(build),
      cliPackDryRun: summarizeStep(packDryRun),
      test: summarizeStep(test),
      gaAgents: summarizeStep(ga),
      dailyFlow: summarizeStep(daily),
      desktopRealFlow: summarizeStep(desktopReal),
      desktopSmoke: summarizeStep(desktopSmoke),
      nestedGit: summarizeStep(nestedGit),
    },
    gaAgents: {
      branch: gaReport.branch,
      sessionCount: gaReport.sessionCount,
      handoffCount: gaReport.handoffCount,
      checkpointId: gaReport.checkpointId,
      reportPath: gaReport.reportPath ?? null,
      agents: gaReport.agents,
    },
    dailyFlow: {
      workspace: dailyReport.readiness?.workspaceName ?? null,
      workstream: dailyReport.readiness?.workstream ?? null,
      zeroTouchReady: dailyReport.readiness?.zeroTouchReady ?? null,
      captureReadyAgents: dailyReport.readiness?.captureReadyAgents ?? [],
      autoContextAgents: dailyReport.readiness?.autoContextAgents ?? [],
      syncPolicy: dailyReport.dataPolicy?.syncPolicy ?? null,
      reportPath: dailyReport.reportPath ?? null,
    },
    cliPackage: parsePackDryRun(packDryRun),
    desktopRealFlow: desktopRealReport ? {
      workspace: desktopRealReport.source?.contextName ?? null,
      branch: desktopRealReport.source?.branch ?? null,
      sessionId: desktopRealReport.source?.sessionId ?? null,
      checkpointId: desktopRealReport.checkpoint?.checkpointId ?? null,
      promotedNodeId: desktopRealReport.promotion?.targetNodeId ?? null,
      reportPath: desktopRealReport.reportPath ?? null,
    } : {
      skipped: true,
      reason: "No real captured workspace data was available for desktop validation.",
    },
  };

  fs.mkdirSync(verificationRoot, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
