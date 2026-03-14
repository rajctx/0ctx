import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { ConnectorStatus } from '../../shared/types/domain';

interface ConnectorLaunch {
  command: string;
  args: string[];
  label: string;
}

function pushLaunch(targets: ConnectorLaunch[], launch: ConnectorLaunch) {
  if (!targets.some((candidate) => candidate.command === launch.command && candidate.args.join('\u0000') === launch.args.join('\u0000'))) {
    targets.push(launch);
  }
}

export class ConnectorService {
  private child: ChildProcess | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private status: ConnectorStatus = {
    running: false,
    pid: null,
    restartCount: 0,
    command: null,
    lastError: null
  };

  constructor(private readonly repoRoot: string) {}

  start() {
    if (this.child) {
      return;
    }
    this.launch();
  }

  restart() {
    this.stop();
    this.status.restartCount = 0;
    this.launch();
    return this.getStatus();
  }

  stop() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child) {
      this.child.removeAllListeners();
      this.child.kill();
      this.child = null;
    }
    this.status.running = false;
    this.status.pid = null;
  }

  dispose() {
    this.stop();
  }

  getStatus() {
    return { ...this.status };
  }

  private resolveLaunches() {
    const launches: ConnectorLaunch[] = [];
    const custom = String(process.env.CTX_CONNECTOR_BIN || '').trim();
    if (custom) {
      if (custom.toLowerCase().endsWith('.ps1')) {
        pushLaunch(launches, {
          command: 'powershell.exe',
          args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', custom, 'connector', 'run', '--quiet'],
          label: 'env-powershell'
        });
      } else {
        pushLaunch(launches, {
          command: custom,
          args: ['connector', 'run', '--quiet'],
          label: 'env-command'
        });
      }
    }

    const cliEntry = path.join(this.repoRoot, 'packages', 'cli', 'dist', 'index.js');
    if (fs.existsSync(cliEntry)) {
      pushLaunch(launches, {
        command: 'node',
        args: [cliEntry, 'connector', 'run', '--quiet'],
        label: 'workspace-cli'
      });
    }

    if (process.platform === 'win32') {
      const appData = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', '0ctx.cmd') : null;
      if (appData && fs.existsSync(appData)) {
        pushLaunch(launches, {
          command: appData,
          args: ['connector', 'run', '--quiet'],
          label: 'appdata-cmd'
        });
      }
      pushLaunch(launches, {
        command: '0ctx.cmd',
        args: ['connector', 'run', '--quiet'],
        label: 'shim'
      });
      pushLaunch(launches, {
        command: 'cmd.exe',
        args: ['/C', '0ctx.cmd', 'connector', 'run', '--quiet'],
        label: 'cmd-shell'
      });
    } else {
      pushLaunch(launches, {
        command: '0ctx',
        args: ['connector', 'run', '--quiet'],
        label: 'path'
      });
    }

    return launches;
  }

  private launch() {
    const failures: string[] = [];
    for (const candidate of this.resolveLaunches()) {
      try {
        const child = spawn(candidate.command, candidate.args, {
          stdio: 'ignore',
          windowsHide: true
        });

        child.on('error', (error) => {
          this.status.lastError = error.message;
        });

        child.on('exit', () => {
          this.child = null;
          this.status.running = false;
          this.status.pid = null;
          this.scheduleRestart();
        });

        this.child = child;
        this.status.running = true;
        this.status.pid = child.pid ?? null;
        this.status.command = [candidate.command, ...candidate.args].join(' ');
        this.status.lastError = null;
        return;
      } catch (error) {
        failures.push(`${candidate.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.status.running = false;
    this.status.command = null;
    this.status.pid = null;
    this.status.lastError = failures.join(' | ') || 'Unable to start connector.';
    this.scheduleRestart();
  }

  private scheduleRestart() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
    }
    this.status.restartCount += 1;
    const delayMs = Math.min(2 ** this.status.restartCount, 60) * 1_000;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.launch();
    }, delayMs);
  }
}
