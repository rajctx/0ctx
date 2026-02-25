import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';

const HISTORY_LIMIT = 500;
const DEFAULT_PROMPT = '0ctx> ';

export interface ShellOptions {
    cliEntrypoint: string;
    nodeExecArgv?: string[];
    prompt?: string;
}

function getHistoryPath(): string {
    return path.join(os.homedir(), '.0ctx', 'history');
}

function loadHistory(): string[] {
    const historyPath = getHistoryPath();
    if (!fs.existsSync(historyPath)) return [];
    try {
        const lines = fs
            .readFileSync(historyPath, 'utf8')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
        return lines.slice(-HISTORY_LIMIT);
    } catch {
        return [];
    }
}

function appendHistoryEntry(line: string): void {
    const normalized = line.trim();
    if (!normalized) return;
    const historyPath = getHistoryPath();
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.appendFileSync(historyPath, `${normalized}\n`, 'utf8');
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise(resolve => {
        rl.question(prompt, answer => resolve(answer));
    });
}

function getCompletionCandidates(): string[] {
    return [
        'setup',
        'install',
        'bootstrap',
        'doctor',
        'status',
        'repair',
        'dashboard',
        'shell',
        'release publish',
        'auth login',
        'auth logout',
        'auth status',
        'config list',
        'config get',
        'config set',
        'sync status',
        'sync policy get',
        'sync policy set',
        'connector status',
        'connector verify',
        'connector register',
        'connector queue status',
        'connector queue drain',
        'connector queue purge',
        'connector queue logs',
        'daemon start',
        'daemon service status'
    ];
}

function printShellHelp(): void {
    console.log('\n0ctx interactive shell');
    console.log('');
    console.log('Built-ins:');
    console.log('  help      Show shell help');
    console.log('  history   Show command history');
    console.log('  clear     Clear terminal');
    console.log('  exit      Exit shell');
    console.log('  quit      Exit shell');
    console.log('');
    console.log('All existing 0ctx commands are supported without the "0ctx" prefix.');
    console.log('Examples:');
    console.log('  setup --clients=all');
    console.log('  status');
    console.log('  connector status --cloud');
    console.log('  release publish --version v1.2.3 --dry-run');
    console.log('');
}

export function tokenizeShellInput(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaping = false;

    for (const char of input) {
        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }

        if (char === '\\' && quote !== "'") {
            escaping = true;
            continue;
        }

        if (quote !== null) {
            if (char === quote) {
                quote = null;
                continue;
            }
            current += char;
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (/\s/.test(char)) {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
            continue;
        }

        current += char;
    }

    if (escaping) {
        current += '\\';
    }

    if (quote !== null) {
        throw new Error('Unterminated quoted string.');
    }

    if (current.length > 0) {
        tokens.push(current);
    }

    return tokens;
}

export async function runShellCommand(tokens: string[], options: ShellOptions): Promise<number> {
    const normalized = [...tokens];
    if (normalized[0] === '0ctx') {
        normalized.shift();
    }

    if (normalized.length === 0) {
        return 0;
    }

    if (normalized[0] === 'shell') {
        console.error('Nested shell is not supported. Use `exit` to leave the current shell.');
        return 1;
    }

    const childArgs = [...(options.nodeExecArgv ?? []), options.cliEntrypoint, ...normalized];

    return await new Promise(resolve => {
        const child = spawn(process.execPath, childArgs, {
            stdio: 'inherit',
            env: {
                ...process.env,
                CTX_SHELL_MODE: '1'
            }
        });

        child.on('error', error => {
            console.error(error instanceof Error ? error.message : String(error));
            resolve(1);
        });

        child.on('close', code => {
            resolve(code ?? 1);
        });
    });
}

export async function runInteractiveShell(options: ShellOptions): Promise<number> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error('Interactive shell requires a TTY terminal.');
        return 1;
    }

    const prompt = options.prompt ?? DEFAULT_PROMPT;
    const history = loadHistory();
    const completions = getCompletionCandidates();
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        historySize: HISTORY_LIMIT,
        removeHistoryDuplicates: true,
        completer: (line: string) => {
            const normalized = line.trim();
            const matches = completions.filter(candidate => candidate.startsWith(normalized));
            return [matches.length > 0 ? matches : completions, normalized];
        }
    }) as readline.Interface & { history: string[] };

    rl.history = [...history].reverse();

    printShellHelp();

    let lastExitCode = 0;
    let interrupted = false;

    rl.on('SIGINT', () => {
        if (interrupted) {
            rl.close();
            return;
        }
        interrupted = true;
        rl.write('\n(Press Ctrl+C again to exit)\n');
        rl.prompt();
        setTimeout(() => {
            interrupted = false;
        }, 1000);
    });

    try {
        while (true) {
            const rawLine = await question(rl, prompt);
            interrupted = false;
            const line = rawLine.trim();

            if (!line) continue;

            if (line === 'exit' || line === 'quit') {
                break;
            }

            if (line === 'help') {
                printShellHelp();
                continue;
            }

            if (line === 'clear') {
                console.clear();
                continue;
            }

            if (line === 'history') {
                const snapshot = loadHistory();
                snapshot.forEach((entry, idx) => {
                    console.log(`${idx + 1}. ${entry}`);
                });
                continue;
            }

            appendHistoryEntry(line);

            let tokens: string[];
            try {
                tokens = tokenizeShellInput(line);
            } catch (error) {
                console.error(error instanceof Error ? error.message : String(error));
                lastExitCode = 1;
                continue;
            }

            lastExitCode = await runShellCommand(tokens, options);
        }
    } finally {
        rl.close();
    }

    return lastExitCode;
}
