import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

interface DaemonLaunch {
  command: string;
  args: string[];
  label: string;
}

function pushLaunch(targets: DaemonLaunch[], launch: DaemonLaunch) {
  if (!targets.some((candidate) => candidate.command === launch.command && candidate.args.join('\u0000') === launch.args.join('\u0000'))) {
    targets.push(launch);
  }
}

function resolveSocketPath() {
  if (process.env.CTX_SOCKET_PATH) {
    return process.env.CTX_SOCKET_PATH;
  }
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\0ctx.sock';
  }
  return path.join(os.homedir(), '.0ctx', '0ctx.sock');
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class DaemonService {
  private launchPromise: Promise<boolean> | null = null;
  private lastError: string | null = null;

  constructor(private readonly repoRoot: string) {}

  async ensureStarted(timeoutMs = 8_000) {
    if (await this.isReachable()) {
      return true;
    }

    if (this.launchPromise) {
      return this.launchPromise;
    }

    this.launchPromise = this.startAndWait(timeoutMs).finally(() => {
      this.launchPromise = null;
    });

    return this.launchPromise;
  }

  getLastError() {
    return this.lastError;
  }

  async isRunning() {
    return this.isReachable();
  }

  private resolveLaunches() {
    const launches: DaemonLaunch[] = [];
    const custom = String(process.env.CTX_DAEMON_BIN || '').trim();
    if (custom) {
      if (custom.toLowerCase().endsWith('.ps1')) {
        pushLaunch(launches, {
          command: 'powershell.exe',
          args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', custom],
          label: 'env-powershell'
        });
      } else {
        pushLaunch(launches, {
          command: custom,
          args: [],
          label: 'env-command'
        });
      }
    }

    const daemonEntry = path.join(this.repoRoot, 'packages', 'daemon', 'dist', 'index.js');
    if (fs.existsSync(daemonEntry)) {
      pushLaunch(launches, {
        command: process.execPath,
        args: [daemonEntry],
        label: 'workspace-daemon'
      });
    }

    const cliEntry = path.join(this.repoRoot, 'packages', 'cli', 'dist', 'index.js');
    if (fs.existsSync(cliEntry)) {
      pushLaunch(launches, {
        command: process.execPath,
        args: [cliEntry, 'daemon', 'start'],
        label: 'workspace-cli'
      });
    }

    if (process.platform === 'win32') {
      const appDataShim = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', '0ctx.cmd') : null;
      if (appDataShim && fs.existsSync(appDataShim)) {
        pushLaunch(launches, {
          command: appDataShim,
          args: ['daemon', 'start'],
          label: 'appdata-cmd'
        });
      }
      pushLaunch(launches, {
        command: '0ctx.cmd',
        args: ['daemon', 'start'],
        label: 'shim'
      });
      pushLaunch(launches, {
        command: 'cmd.exe',
        args: ['/C', '0ctx.cmd', 'daemon', 'start'],
        label: 'cmd-shell'
      });
    } else {
      pushLaunch(launches, {
        command: '0ctx',
        args: ['daemon', 'start'],
        label: 'path'
      });
    }

    return launches;
  }

  private async startAndWait(timeoutMs: number) {
    for (const candidate of this.resolveLaunches()) {
      try {
        await this.launchCandidate(candidate);
        if (await this.waitForReachable(timeoutMs)) {
          this.lastError = null;
          return true;
        }
        this.lastError = `${candidate.label}: daemon_start_timeout`;
      } catch (error) {
        this.lastError = `${candidate.label}: ${describeError(error)}`;
      }
    }

    return false;
  }

  private launchCandidate(candidate: DaemonLaunch) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(candidate.command, candidate.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });

      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  private async waitForReachable(timeoutMs: number) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.isReachable()) {
        return true;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });
    }
    return false;
  }

  private async isReachable() {
    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection(resolveSocketPath());
      let settled = false;
      let buffer = '';

      const finish = (value: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(value);
      };

      socket.setTimeout(1_000, () => finish(false));
      socket.on('connect', () => {
        socket.write(JSON.stringify({
          method: 'health',
          params: {},
          requestId: 'desktop-daemon-probe',
          apiVersion: '2'
        }) + '\n');
      });
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) {
          return;
        }
        try {
          const message = JSON.parse(buffer.slice(0, newlineIndex));
          finish(Boolean(message?.ok));
        } catch {
          finish(false);
        }
      });
      socket.on('error', () => finish(false));
      socket.on('end', () => finish(false));
    });
  }
}
