#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import process from "node:process";
import { randomUUID, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntry = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const daemonEntry = path.join(repoRoot, "packages", "cli", "dist", "daemon.js");
const isWindows = process.platform === "win32";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    shell: options.shell ?? false,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed.\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`);
  }
  return result.stdout ?? "";
}

function getSocketPath(homeDir) {
  return process.env.CTX_SOCKET_PATH || (isWindows ? "\\\\.\\pipe\\0ctx.sock" : path.join(homeDir, ".0ctx", "0ctx.sock"));
}

function requestDaemon(homeDir, method, params = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(getSocketPath(homeDir));
    const requestId = randomUUID();
    socket.once("error", reject);
    socket.on("connect", () => {
      socket.write(JSON.stringify({
        method,
        params,
        requestId,
        sessionToken: options.sessionToken ?? undefined,
        apiVersion: "2",
      }) + "\n");
    });

    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const message = buffer.slice(0, newline);
      socket.destroy();
      try {
        const parsed = JSON.parse(message);
        if (parsed.ok) {
          resolve(parsed.result);
        } else {
          reject(new Error(parsed.error ?? `daemon ${method} failed`));
        }
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function waitForDaemon(homeDir, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await requestDaemon(homeDir, "health", {});
      if (health?.status === "ok") {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for daemon health.");
}

function writeTranscript(filePath, { title, cwd, userText, assistantText }) {
  const lines = [
    JSON.stringify({
      type: "session_start",
      id: path.basename(filePath, path.extname(filePath)),
      title,
      sessionTitle: title,
      cwd,
    }),
    JSON.stringify({
      type: "message",
      id: `${title}-user`,
      timestamp: "2026-03-06T12:00:00.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: userText }],
      },
    }),
    JSON.stringify({
      type: "message",
      id: `${title}-assistant`,
      timestamp: "2026-03-06T12:00:05.000Z",
      parentId: `${title}-user`,
      message: {
        role: "assistant",
        content: [{ type: "text", text: assistantText }],
      },
    }),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function checksum(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function runCliJson(env, args, options = {}) {
  const stdout = run("node", [cliEntry, ...args], { env, cwd: options.cwd ?? repoRoot });
  return JSON.parse(stdout);
}

async function main() {
  const keepTemp = process.argv.includes("--keep-temp");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "0ctx-daily-flow-"));
  const fakeHome = path.join(tempRoot, "home");
  const repoDir = path.join(tempRoot, "repo");
  const socketPath = isWindows
    ? `\\\\.\\pipe\\0ctx-${randomUUID()}`
    : path.join(tempRoot, "0ctx.sock");
  const dbPath = path.join(fakeHome, ".0ctx", "0ctx.db");
  process.env.CTX_SOCKET_PATH = socketPath;
  process.env.CTX_DB_PATH = dbPath;
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });

  const env = {
    ...process.env,
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    CTX_SOCKET_PATH: socketPath,
    CTX_DB_PATH: dbPath,
    CTX_SYNC_ENABLED: "false",
    CTX_TELEMETRY_ENABLED: "false",
  };

  run("git", ["init"], { cwd: repoDir, env });
  run("git", ["config", "user.name", "0ctx Daily Flow"], { cwd: repoDir, env });
  run("git", ["config", "user.email", "daily@0ctx.dev"], { cwd: repoDir, env });
  run("git", ["checkout", "-b", "main"], { cwd: repoDir, env });
  fs.writeFileSync(path.join(repoDir, "README.md"), "# daily flow\n", "utf8");
  run("git", ["add", "."], { cwd: repoDir, env });
  run("git", ["commit", "-m", "chore: seed daily flow verification repo"], { cwd: repoDir, env });

  const daemon = spawn("node", [daemonEntry], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  let daemonStdout = "";
  let daemonStderr = "";
  daemon.stdout.on("data", (chunk) => { daemonStdout += chunk.toString(); });
  daemon.stderr.on("data", (chunk) => { daemonStderr += chunk.toString(); });

  try {
    await waitForDaemon(fakeHome);

    const enableResult = runCliJson(env, [
      "enable",
      `--repo-root=${repoDir}`,
      "--skip-bootstrap",
      "--json",
    ]);
    assert(enableResult.ok === true, "Enable did not succeed");
    assert(enableResult.contextId, "Enable did not return a context id");
    assert(enableResult.repoReadiness?.zeroTouchReady === true, "Enable did not produce a zero-touch ready repo");
    assert(JSON.stringify(enableResult.repoReadiness?.captureReadyAgents ?? []) === JSON.stringify(["claude", "factory", "antigravity"]), "Unexpected capture ready agents");
    assert(JSON.stringify(enableResult.repoReadiness?.autoContextAgents ?? []) === JSON.stringify(["claude", "factory", "antigravity"]), "Unexpected auto-context agents");
    assert(enableResult.repoReadiness?.syncPolicy === "metadata_only", "Workspace sync policy is not metadata_only");
    assert(enableResult.dataPolicy?.syncPolicy === "metadata_only (default)", "Enable did not report metadata_only (default)");
    assert(enableResult.repoReadiness?.captureRetentionDays === 14, "Unexpected capture retention");
    assert(enableResult.repoReadiness?.debugRetentionDays === 7, "Unexpected debug retention");
    assert(enableResult.repoReadiness?.debugArtifactsEnabled === false, "Debug artifacts should be disabled by default");

    const claudeConfigPath = path.join(repoDir, ".claude", "settings.local.json");
    const factoryConfigPath = path.join(repoDir, ".factory", "settings.json");
    const antigravityConfigPath = path.join(repoDir, ".gemini", "settings.json");
    assert(fs.existsSync(claudeConfigPath), "Claude config was not created");
    assert(fs.existsSync(factoryConfigPath), "Factory config was not created");
    assert(fs.existsSync(antigravityConfigPath), "Antigravity config was not created");

    const claudeConfig = readJson(claudeConfigPath);
    const factoryConfig = readJson(factoryConfigPath);
    const antigravityConfig = readJson(antigravityConfigPath);
    const claudeSessionStart = claudeConfig?.hooks?.SessionStart?.[0]?.hooks?.[0]?.command ?? "";
    const factorySessionStart = factoryConfig?.hooks?.SessionStart?.[0]?.hooks?.[0]?.command ?? "";
    const antigravitySessionStart = antigravityConfig?.hooks?.SessionStart?.[0]?.hooks?.[0]?.command ?? "";
    assert(String(claudeSessionStart).includes("0ctx connector hook session-start --agent=claude"), "Claude SessionStart hook missing");
    assert(String(factorySessionStart).includes("0ctx connector hook session-start --agent=factory"), "Factory SessionStart hook missing");
    assert(String(antigravitySessionStart).includes("0ctx connector hook session-start --agent=antigravity"), "Antigravity SessionStart hook missing");

    const sessionStartPayload = JSON.stringify({ cwd: repoDir });
    const claudeStart = runCliJson(env, ["connector", "hook", "session-start", "--agent=claude", "--payload", sessionStartPayload, "--json"]);
    const factoryStart = runCliJson(env, ["connector", "hook", "session-start", "--agent=factory", "--payload", sessionStartPayload, "--json"]);
    const antigravityStart = runCliJson(env, ["connector", "hook", "session-start", "--agent=antigravity", "--payload", sessionStartPayload, "--json"]);
    for (const [label, result] of [["claude", claudeStart], ["factory", factoryStart], ["antigravity", antigravityStart]]) {
      assert(result.ok === true, `${label} SessionStart did not succeed`);
      assert(result.injected === true, `${label} SessionStart did not inject context`);
      assert(result.branch === "main", `${label} SessionStart did not resolve branch main`);
      const injectedContext = String(result.context ?? "");
      assert(
        injectedContext.includes("Workspace:")
        || injectedContext.includes("0ctx project memory")
        || injectedContext.includes("Current workstream:"),
        `${label} SessionStart context pack missing core context summary`
      );
    }

    const claudeTranscript = path.join(fakeHome, "claude-session.jsonl");
    const factoryTranscript = path.join(fakeHome, "factory-session.jsonl");
    const antigravityTranscript = path.join(fakeHome, "antigravity-session.jsonl");
    writeTranscript(claudeTranscript, {
      title: "claude-daily-flow",
      cwd: repoDir,
      userText: "summarize the current workstream",
      assistantText: "The workstream is ready for a checkpoint after this daily flow validation.",
    });
    writeTranscript(factoryTranscript, {
      title: "factory-daily-flow",
      cwd: repoDir,
      userText: "review today’s repository readiness",
      assistantText: "Repository readiness is healthy and capture is armed for supported agents.",
    });
    writeTranscript(antigravityTranscript, {
      title: "antigravity-daily-flow",
      cwd: repoDir,
      userText: "summarize the last captured progress",
      assistantText: "The latest capture shows a clean workstream with no blockers.",
    });

    const claudeIngest = runCliJson(env, [
      "connector", "hook", "ingest", "--agent=claude",
      "--payload", JSON.stringify({
        session_id: "claude-daily-flow",
        turn_id: "claude-turn-1",
        cwd: repoDir,
        transcript_path: claudeTranscript,
        hook_event_name: "Stop",
      }),
      "--json",
    ]);
    const factoryIngest = runCliJson(env, [
      "connector", "hook", "ingest", "--agent=factory",
      "--payload", JSON.stringify({
        session_id: "factory-daily-flow",
        execution_id: "factory-turn-1",
        cwd: repoDir,
        transcript_path: factoryTranscript,
        hook_event_name: "Stop",
      }),
      "--json",
    ]);
    const antigravityIngest = runCliJson(env, [
      "connector", "hook", "ingest", "--agent=antigravity",
      "--payload", JSON.stringify({
        session_id: "antigravity-daily-flow",
        execution_id: "antigravity-turn-1",
        cwd: repoDir,
        transcript_path: antigravityTranscript,
        hook_event_name: "Stop",
      }),
      "--json",
    ]);
    assert(claudeIngest.insertedCount >= 2, "Claude ingest did not create transcript-backed messages");
    assert(factoryIngest.insertedCount >= 2, "Factory ingest did not create transcript-backed messages");
    assert(antigravityIngest.insertedCount >= 2, "Antigravity ingest did not create transcript-backed messages");

    const daemonSession = await requestDaemon(fakeHome, "createSession", {});
    const sessionToken = daemonSession.sessionToken;
    const lanes = await requestDaemon(fakeHome, "listBranchLanes", { contextId: enableResult.contextId }, { sessionToken });
    assert(Array.isArray(lanes) && lanes.length === 1, "Expected a single workstream after capture");
    assert(lanes[0].branch === "main", `Expected captured branch main, got ${lanes[0].branch}`);

    const sessions = await requestDaemon(fakeHome, "listBranchSessions", {
      contextId: enableResult.contextId,
      branch: "main",
      worktreePath: repoDir,
    }, { sessionToken });
    assert(Array.isArray(sessions) && sessions.length === 3, `Expected 3 captured sessions, got ${sessions.length}`);

    const checkpoint = await requestDaemon(fakeHome, "createSessionCheckpoint", {
      contextId: enableResult.contextId,
      sessionId: "claude-daily-flow",
      summary: "daily flow checkpoint",
    }, { sessionToken });
    assert(checkpoint?.id, "Daily-flow checkpoint creation failed");

    const workstreamCurrent = runCliJson(env, [
      "workstreams",
      "current",
      `--repo-root=${repoDir}`,
      "--json",
    ]);
    assert(workstreamCurrent.branch === "main", "Current workstream did not resolve branch main");
    assert(workstreamCurrent.sessionCount === 3, "Current workstream does not report 3 sessions");
    assert(workstreamCurrent.checkpointCount >= 1, "Current workstream does not report a checkpoint");

    const report = {
      ok: true,
      tempRoot,
      contextId: enableResult.contextId,
      repoRoot: repoDir,
      readiness: enableResult.repoReadiness,
      dataPolicy: enableResult.dataPolicy,
      sessionStart: {
        claude: { injected: claudeStart.injected, branch: claudeStart.branch },
        factory: { injected: factoryStart.injected, branch: factoryStart.branch },
        antigravity: { injected: antigravityStart.injected, branch: antigravityStart.branch },
      },
      capture: {
        claude: { insertedCount: claudeIngest.insertedCount, transcriptSha256: checksum(claudeTranscript) },
        factory: { insertedCount: factoryIngest.insertedCount, transcriptSha256: checksum(factoryTranscript) },
        antigravity: { insertedCount: antigravityIngest.insertedCount, transcriptSha256: checksum(antigravityTranscript) },
      },
      workstream: {
        branch: workstreamCurrent.branch,
        sessionCount: workstreamCurrent.sessionCount,
        checkpointCount: workstreamCurrent.checkpointCount,
        stateSummary: workstreamCurrent.stateSummary ?? null,
      },
      checkpointId: checkpoint.id,
    };

    const reportPath = path.join(repoRoot, "releases", "verification", "daily-flow.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
  } finally {
    daemon.kill();
    await new Promise((resolve) => daemon.once("exit", resolve));
    if (!keepTemp) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    if (daemonStderr.trim().length > 0) {
      process.stderr.write(daemonStderr);
    }
    if (daemonStdout.trim().length > 0) {
      process.stderr.write(daemonStdout);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
