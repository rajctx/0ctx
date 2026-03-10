#!/usr/bin/env node

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const daemonEntry = path.join(repoRoot, "packages", "cli", "dist", "daemon.js");
const isWindows = process.platform === "win32";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function socketPath() {
  if (process.env.CTX_SOCKET_PATH) {
    return process.env.CTX_SOCKET_PATH;
  }
  return isWindows ? "\\\\.\\pipe\\0ctx.sock" : path.join(os.homedir(), ".0ctx", "0ctx.sock");
}

function request(method, params = {}, sessionToken) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath());
    socket.once("error", reject);
    socket.on("connect", () => {
      socket.write(JSON.stringify({
        method,
        params,
        requestId: randomUUID(),
        sessionToken,
        apiVersion: "2",
      }) + "\n");
    });
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const message = JSON.parse(buffer.slice(0, newline));
      socket.destroy();
      if (message.ok) {
        resolve(message.result);
      } else {
        reject(new Error(message.error ?? `${method} failed`));
      }
    });
  });
}

async function ensureDaemon() {
  let daemon = null;
  try {
    await request("health");
    return { daemonStarted: false, daemon };
  } catch {
    daemon = spawn("node", [daemonEntry], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    await waitForHealth();
    return { daemonStarted: true, daemon };
  }
}

async function waitForHealth(timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await request("health");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Timed out waiting for daemon health.");
}

function firstRepoPath(context) {
  return Array.isArray(context?.paths)
    ? context.paths.find((value) => String(value || "").trim().length > 0) || null
    : null;
}

function isRealWorkspace(context) {
  const repoPath = firstRepoPath(context);
  return Boolean(repoPath) && !/AppData[\\/](Local|Roaming)[\\/]Temp/i.test(repoPath);
}

async function selectSource(sessionToken) {
  const contexts = await request("listContexts", {}, sessionToken);
  const candidates = [];
  for (const context of contexts.filter(isRealWorkspace)) {
    const lanes = await request("listBranchLanes", { contextId: context.id }, sessionToken).catch(() => []);
    for (const lane of lanes) {
      const branch = String(lane.branch || "").trim() || "detached";
      const worktreePath = lane.worktreePath || firstRepoPath(context);
      const sessions = await request("listBranchSessions", {
        contextId: context.id,
        branch,
        worktreePath,
      }, sessionToken).catch(() => []);
      if (sessions.length === 0) continue;
      candidates.push({ context, lane, branch, worktreePath, sessions });
    }
  }
  candidates.sort((left, right) => right.sessions.length - left.sessions.length);
  return candidates[0] || null;
}

async function ensureCheckpoint(source, sessionToken, breakdowns) {
  const checkpoints = await request("listBranchCheckpoints", {
    contextId: source.context.id,
    branch: source.branch,
    worktreePath: source.worktreePath,
  }, sessionToken).catch(() => []);
  if (checkpoints.length > 0) {
    return { checkpoint: checkpoints[0], created: false };
  }
  const latestSession = source.sessions[0];
  assert(latestSession?.sessionId, "No session available to create a validation checkpoint.");
  const created = await request("createSessionCheckpoint", {
    contextId: source.context.id,
    sessionId: latestSession.sessionId,
    kind: "manual",
    summary: `desktop daily-flow validation ${new Date().toISOString().slice(0, 10)}`,
  }, sessionToken);
  breakdowns.push("Created a validation checkpoint because the source workstream had none.");
  return { checkpoint: created, created: true };
}

async function ensureInsight(source, sessionToken, breakdowns) {
  const existing = await request("listWorkstreamInsights", {
    contextId: source.context.id,
    branch: source.branch,
    worktreePath: source.worktreePath,
    limit: 25,
  }, sessionToken).catch(() => []);
  if (existing.length > 0) {
    return { insight: existing[0], created: false, sourceNodeId: existing[0].nodeId || existing[0].id || null };
  }
  const created = await request("addNode", {
    contextId: source.context.id,
    type: "decision",
    key: `desktop-validation-${Date.now()}`,
    content: "Repo-first daily work should stay in the agent; desktop is for inspecting workstreams, sessions, checkpoints, and reviewed memory.",
    tags: [
      `branch:${source.branch}`,
      `worktree:${source.worktreePath}`,
      "source:desktop-validation",
    ],
  }, sessionToken);
  const refreshed = await request("listWorkstreamInsights", {
    contextId: source.context.id,
    branch: source.branch,
    worktreePath: source.worktreePath,
    limit: 25,
  }, sessionToken);
  const insight = refreshed.find((item) => (item.nodeId || item.id) === created.id) || refreshed[0] || null;
  assert(insight, "Failed to surface the validation insight in workstream insights.");
  breakdowns.push("Created a temporary reviewed-memory node because the source workstream had no visible insights.");
  return { insight, created: true, sourceNodeId: created.id };
}

async function createTargetContext(sessionToken) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "0ctx-desktop-validation-"));
  const targetRepo = path.join(tempRoot, "target");
  fs.mkdirSync(targetRepo, { recursive: true });
  const context = await request("createContext", {
    name: `desktop-validation-target-${Date.now()}`,
    paths: [targetRepo],
  }, sessionToken);
  return { context, tempRoot };
}

async function main() {
  const breakdowns = [];
  const cleanup = [];
  const { daemonStarted, daemon } = await ensureDaemon();
  try {
    const daemonSession = await request("createSession");
    const sessionToken = daemonSession.sessionToken;
    const source = await selectSource(sessionToken);
    assert(source, "No real captured workspace with sessions was found.");

    const sessionDetail = await request("getSessionDetail", {
      contextId: source.context.id,
      sessionId: source.sessions[0].sessionId,
    }, sessionToken);
    const messages = await request("listSessionMessages", {
      contextId: source.context.id,
      sessionId: source.sessions[0].sessionId,
      limit: 200,
    }, sessionToken);
    const { checkpoint, created: checkpointCreated } = await ensureCheckpoint(source, sessionToken, breakdowns);
    const checkpointDetail = await request("getCheckpointDetail", {
      contextId: source.context.id,
      checkpointId: checkpoint.id || checkpoint.checkpointId,
    }, sessionToken);
    const handoff = await request("getHandoffTimeline", {
      contextId: source.context.id,
      branch: source.branch,
      worktreePath: source.worktreePath,
      limit: 10,
    }, sessionToken).catch(() => []);

    const { insight, created: insightCreated, sourceNodeId } = await ensureInsight(source, sessionToken, breakdowns);
    if (insightCreated && sourceNodeId) {
      cleanup.push(() => request("deleteNode", { contextId: source.context.id, id: sourceNodeId }, sessionToken).catch(() => null));
    }

    const target = await createTargetContext(sessionToken);
    cleanup.push(() => request("deleteContext", { id: target.context.id }, sessionToken).catch(() => null));
    cleanup.push(() => fs.rmSync(target.tempRoot, { recursive: true, force: true }));

    const promotion = await request("promoteInsight", {
      contextId: target.context.id,
      sourceContextId: source.context.id,
      nodeId: sourceNodeId || insight.nodeId || insight.id,
      branch: source.branch,
      worktreePath: source.worktreePath,
    }, sessionToken);
    const promotedNode = await request("getNode", {
      contextId: target.context.id,
      id: promotion.targetNodeId,
    }, sessionToken);

    assert(messages.length > 0, "Desktop validation found no session messages.");
    assert(checkpointDetail?.checkpoint || checkpointDetail?.id, "Desktop validation could not load checkpoint detail.");
    assert(promotion?.targetNodeId, "Desktop validation could not promote an insight.");
    assert(promotedNode?.id === promotion.targetNodeId, "Promoted insight could not be loaded from the target workspace.");

    const report = {
      ok: true,
      validatedAt: new Date().toISOString(),
      daemonStarted,
      source: {
        contextId: source.context.id,
        contextName: source.context.name,
        repoPath: firstRepoPath(source.context),
        branch: source.branch,
        worktreePath: source.worktreePath,
        sessionId: source.sessions[0].sessionId,
        sessionMessageCount: messages.length,
        handoffCount: Array.isArray(handoff) ? handoff.length : 0,
      },
      checkpoint: {
        checkpointId: checkpoint.id || checkpoint.checkpointId,
        createdForValidation: checkpointCreated,
        detailLoaded: true,
      },
      insight: {
        nodeId: sourceNodeId || insight.nodeId || insight.id,
        createdForValidation: insightCreated,
        trustTier: insight.trustTier || null,
      },
      promotion: {
        targetContextId: target.context.id,
        targetNodeId: promotion.targetNodeId,
        created: Boolean(promotion.created),
        reused: Boolean(promotion.reused),
      },
      breakdowns,
      reportPath: path.join(repoRoot, "releases", "verification", "desktop-real-flow.json"),
      sessionDetailTitle: sessionDetail?.session?.title || sessionDetail?.title || null,
    };

    fs.mkdirSync(path.dirname(report.reportPath), { recursive: true });
    fs.writeFileSync(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    while (cleanup.length > 0) {
      await cleanup.pop()();
    }
  } finally {
    if (daemonStarted && daemon) {
      daemon.kill();
      await new Promise((resolve) => daemon.once("exit", resolve));
    }
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
