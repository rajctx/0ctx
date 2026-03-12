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

function runCliIngest(env, agent, payload) {
  const stdout = run("node", [
    cliEntry,
    "connector",
    "hook",
    "ingest",
    `--agent=${agent}`,
    "--payload",
    JSON.stringify(payload),
    "--json",
  ], { env });
  return JSON.parse(stdout);
}

function checksum(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

async function main() {
  const keepTemp = process.argv.includes("--keep-temp");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "0ctx-release-ga-"));
  const fakeHome = path.join(tempRoot, "home");
  const fakeAppData = path.join(fakeHome, "AppData", "Roaming");
  const repoDir = path.join(tempRoot, "repo");
  const socketPath = isWindows
    ? `\\\\.\\pipe\\0ctx-${randomUUID()}`
    : path.join(tempRoot, "0ctx.sock");
  const dbPath = path.join(fakeHome, ".0ctx", "0ctx.db");
  process.env.CTX_SOCKET_PATH = socketPath;
  process.env.CTX_DB_PATH = dbPath;
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(path.join(fakeAppData, "Claude"), { recursive: true });
  fs.mkdirSync(path.join(fakeAppData, "Antigravity", "User"), { recursive: true });

  const env = {
    ...process.env,
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    APPDATA: fakeAppData,
    CTX_SOCKET_PATH: socketPath,
    CTX_DB_PATH: dbPath,
    CTX_SYNC_ENABLED: "false",
    CTX_TELEMETRY_ENABLED: "false",
  };

  run("git", ["init"], { cwd: repoDir, env });
  run("git", ["config", "user.name", "0ctx Release"], { cwd: repoDir, env });
  run("git", ["config", "user.email", "release@0ctx.dev"], { cwd: repoDir, env });
  run("git", ["checkout", "-b", "main"], { cwd: repoDir, env });
  fs.writeFileSync(path.join(repoDir, "README.md"), "# release e2e\n", "utf8");
  run("git", ["add", "."], { cwd: repoDir, env });
  run("git", ["commit", "-m", "chore: seed release verification repo"], { cwd: repoDir, env });

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

    const daemonSession = await requestDaemon(fakeHome, "createSession", {});
    const sessionToken = daemonSession.sessionToken;
    assert(typeof sessionToken === "string" && sessionToken.length > 0, "createSession did not return a session token");

    const context = await requestDaemon(fakeHome, "createContext", {
      name: "release-ga-e2e",
      paths: [repoDir],
    }, { sessionToken });
    assert(context?.id, "createContext did not return an id");

    const installResult = JSON.parse(run("node", [
      cliEntry,
      "connector",
      "hook",
      "install",
      "--clients=claude,factory,antigravity",
      `--repo-root=${repoDir}`,
      "--json",
    ], { env }));
    assert(installResult.claudeHookConfigured === true, "Claude hook install failed");
    assert(installResult.factoryHookConfigured === true, "Factory hook install failed");
    assert(installResult.antigravityHookConfigured === true, "Antigravity hook install failed");

    const claudeTranscript = path.join(fakeHome, "claude-session.jsonl");
    const factoryTranscript = path.join(fakeHome, "factory-session.jsonl");
    const antigravityTranscript = path.join(fakeHome, "antigravity-session.jsonl");
    writeTranscript(claudeTranscript, {
      title: "claude-release-check",
      cwd: repoDir,
      userText: "summarize the release branch readiness",
      assistantText: "The release branch is ready for a checkpoint after the latest validation pass.",
    });
    writeTranscript(factoryTranscript, {
      title: "factory-branch-review",
      cwd: repoDir,
      userText: "review the branch lane timeline",
      assistantText: "The branch lane timeline is captured and ready for a checkpoint.",
    });
    writeTranscript(antigravityTranscript, {
      title: "antigravity-release-check",
      cwd: repoDir,
      userText: "summarize the release readiness",
      assistantText: "Release readiness looks good after the latest validation pass.",
    });

    const claudeResult = runCliIngest(env, "claude", {
      session_id: "claude-session-e2e",
      turn_id: "claude-turn-e2e",
      hook_event_name: "Stop",
      cwd: repoDir,
      transcript_path: claudeTranscript,
    });
    const factoryResult = runCliIngest(env, "factory", {
      session_id: "factory-session-e2e",
      execution_id: "factory-turn-e2e",
      hook_event_name: "Stop",
      cwd: repoDir,
      transcript_path: factoryTranscript,
    });
    const antigravityResult = runCliIngest(env, "antigravity", {
      session_id: "antigravity-session-e2e",
      execution_id: "antigravity-turn-e2e",
        hook_event_name: "Stop",
        cwd: repoDir,
        transcript_path: antigravityTranscript,
    });

    assert(claudeResult.insertedCount >= 2, "Claude ingest did not create transcript-backed messages");
    assert(factoryResult.insertedCount >= 2, "Factory ingest did not create transcript-backed messages");
    assert(antigravityResult.insertedCount >= 2, "Antigravity ingest did not create transcript-backed messages");

    const lanes = await requestDaemon(fakeHome, "listBranchLanes", { contextId: context.id }, { sessionToken });
    assert(Array.isArray(lanes) && lanes.length === 1, "Expected exactly one branch lane");
    assert(lanes[0].branch === "main", `Expected branch lane main, got ${lanes[0].branch}`);

    const sessions = await requestDaemon(fakeHome, "listBranchSessions", {
      contextId: context.id,
      branch: "main",
      worktreePath: repoDir,
    }, { sessionToken });
    assert(Array.isArray(sessions) && sessions.length === 3, `Expected 3 sessions, got ${sessions.length}`);

    const sessionMap = new Map(sessions.map((entry) => [entry.sessionId, entry]));
    assert(sessionMap.has("claude-session-e2e"), "Claude session missing");
    assert(sessionMap.has("factory-session-e2e"), "Factory session missing");
    assert(sessionMap.has("antigravity-session-e2e"), "Antigravity session missing");

    const claudeMessages = await requestDaemon(fakeHome, "listSessionMessages", {
      contextId: context.id,
      sessionId: "claude-session-e2e",
    }, { sessionToken });
    assert(Array.isArray(claudeMessages) && claudeMessages.length === 2, `Expected 2 Claude messages, got ${claudeMessages.length}`);

    const handoff = await requestDaemon(fakeHome, "getHandoffTimeline", {
      contextId: context.id,
      branch: "main",
      worktreePath: repoDir,
    }, { sessionToken });
    assert(Array.isArray(handoff) && handoff.length === 3, `Expected 3 handoff entries, got ${handoff.length}`);

    const checkpoint = await requestDaemon(fakeHome, "createSessionCheckpoint", {
      contextId: context.id,
      sessionId: "claude-session-e2e",
      summary: "release checkpoint",
    }, { sessionToken });
    assert(checkpoint?.id, "Checkpoint creation failed");

    const explain = await requestDaemon(fakeHome, "explainCheckpoint", {
      checkpointId: checkpoint.id,
    }, { sessionToken });
    assert(explain?.checkpoint?.id === checkpoint.id, "Checkpoint explain failed");

    await requestDaemon(fakeHome, "addNode", {
      contextId: context.id,
      type: "assumption",
      content: "temporary node for rewind verification",
    }, { sessionToken });

    const rewind = await requestDaemon(fakeHome, "rewindCheckpoint", {
      checkpointId: checkpoint.id,
    }, { sessionToken });
    assert(rewind?.checkpoint?.id === checkpoint.id, "Checkpoint rewind failed");

    const resumed = await requestDaemon(fakeHome, "resumeSession", {
      contextId: context.id,
      sessionId: "claude-session-e2e",
    }, { sessionToken });
    assert(resumed?.session?.sessionId === "claude-session-e2e", "Session resume failed");

    const audits = await requestDaemon(fakeHome, "listAuditEvents", {
      contextId: context.id,
      limit: 50,
    }, { sessionToken });
    const actions = new Set(audits.map((entry) => entry.action));
    assert(actions.has("save_checkpoint"), "save_checkpoint audit missing");
    assert(actions.has("rewind"), "rewind audit missing");
    assert(actions.has("resume_session"), "resume_session audit missing");

    const report = {
      ok: true,
      tempRoot,
      contextId: context.id,
      branch: lanes[0].branch,
      sessionCount: sessions.length,
      handoffCount: handoff.length,
      checkpointId: checkpoint.id,
      agents: {
        claude: {
          insertedCount: claudeResult.insertedCount,
          messageIds: claudeMessages.map((message) => message.messageId),
          summary: sessionMap.get("claude-session-e2e")?.summary ?? null,
        },
        factory: { insertedCount: factoryResult.insertedCount, summary: sessionMap.get("factory-session-e2e")?.summary ?? null },
        antigravity: { insertedCount: antigravityResult.insertedCount, summary: sessionMap.get("antigravity-session-e2e")?.summary ?? null },
      },
      transcripts: {
        claude: { path: claudeTranscript, sha256: checksum(claudeTranscript) },
        factory: { path: factoryTranscript, sha256: checksum(factoryTranscript) },
        antigravity: { path: antigravityTranscript, sha256: checksum(antigravityTranscript) },
      },
    };

    const reportPath = path.join(repoRoot, "releases", "verification", "ga-agents.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
  } finally {
    daemon.kill();
    await new Promise((resolve) => daemon.once("exit", resolve));
    if (!keepTemp) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } else {
      process.stderr.write(`Kept temp root: ${tempRoot}\n`);
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
