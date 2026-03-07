import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';

const HISTORY_LIMIT = 500;
const DEFAULT_PROMPT_PLAIN = '0ctx> ';

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

function getBestSuggestion(line: string, completions: string[]): string {
    const normalized = line.trim();
    if (!normalized) return '';
    return completions.find(c => c.startsWith(normalized) && c !== normalized) ?? '';
}

function getCompletionCandidates(): string[] {
    const commands = [
        'setup',
        'setup --validate',
        'install',
        'bootstrap',
        'mcp',
        'mcp setup',
        'mcp bootstrap',
        'mcp validate',
        'doctor',
        'status',
        'status --json',
        'status --compact',
        'version',
        'recall',
        'recall feedback --node-id=',
        'recall feedback list',
        'recall feedback stats',
        'repair',
        'repair --deep',
        'repair --json',
        'logs --snapshot',
        'logs --snapshot --errors-only',
        'dashboard',
        'shell',
        'release publish',
        'auth login',
        'auth logout',
        'auth status',
        'auth rotate',
        'config list',
        'config get',
        'config set',
        'sync status',
        'sync policy get',
        'sync policy set',
        'connector status',
        'connector verify',
        'connector register',
        'connector hook status',
        'connector hook install',
        'connector hook ingest --agent=codex --payload=',
        'connector queue status',
        'connector queue drain',
        'connector queue purge',
        'connector queue logs',
        'hook',
        'hook status',
        'hook install',
        'hook ingest --agent=codex --payload=',
        'daemon start',
        'daemon service status',
    ];
    const builtins = ['/help', '/clear', '/history', '/exit'];
    // Also expose slash-prefixed variants of every command so `/auth login` autocompletes
    const slashVariants = commands.map(c => `/${c}`);
    return [...builtins, ...commands, ...slashVariants];
}

async function printShellHelp(): Promise<void> {
    const color = (await import('picocolors')).default;

    const logo = [
        `  ___      _          `,
        ` / _ \\ ___| |____  __ `,
        `| | | / __| __\\ \\/ /  `,
        `| |_| \\__ \\ |_ >  <   `,
        ` \\___/|___/\\__/_/\\_\\  `
    ];

    console.log();
    for (const line of logo) {
        // Color '0' (the O part) in cyan, and 'ctx' in white
        const coloredLine = line
            .replace(/___|_\s\\|_\||\___\/|\|_\|/g, match => color.cyan(match)) // Attempting to target the '0'
            .replace(/_          | \_\_\_\| \|\_\_\_\_  \_\_ |\_\_\| \_\_\\ \\\/ \/  |\\\_\_ \\ \|\_ \>  \<   |\|\_\_\_\/\\_\_\/\_\/\\\_\\  /, match => color.white(match));

        // A simpler approach to coloring the logo block:
        console.log(color.cyan(line.substring(0, 6)) + color.white(line.substring(6)));
    }
    console.log();
    console.log(color.dim('──────────────────────────────────────────────────'));

    console.log(`\n${color.bold('Built-ins')}`);
    console.log(`  ${color.cyan('help'.padEnd(10))} ${color.dim('Show shell help')}`);
    console.log(`  ${color.cyan('history'.padEnd(10))} ${color.dim('Show command history')}`);
    console.log(`  ${color.cyan('clear'.padEnd(10))} ${color.dim('Clear terminal')}`);
    console.log(`  ${color.cyan('exit / quit'.padEnd(10))} ${color.dim('Exit shell')}`);

    console.log(`\n${color.bold('Slash Commands')}`);
    console.log(`  ${color.magenta('/help'.padEnd(20))} ${color.dim('Show shell help')}`);
    console.log(`  ${color.magenta('/history'.padEnd(20))} ${color.dim('Show command history')}`);
    console.log(`  ${color.magenta('/clear'.padEnd(20))} ${color.dim('Clear terminal')}`);
    console.log(`  ${color.magenta('/exit'.padEnd(20))} ${color.dim('Exit shell')}`);

    console.log(`\n${color.bold('Get started')}`);
    console.log(`  ${color.green('>')} ${color.cyan('status'.padEnd(35))} ${color.dim('(check daemon and system health)')}`);
    console.log(`  ${color.green('>')} ${color.cyan('mcp'.padEnd(35))} ${color.dim('(interactive MCP setup flow)')}`);
    console.log(`  ${color.green('>')} ${color.cyan('enable'.padEnd(35))} ${color.dim('(bind this repo and install GA integrations)')}`);
    console.log(`  ${color.green('>')} ${color.cyan('connector status --cloud'.padEnd(35))} ${color.dim('(check cloud connection)')}`);
    console.log(`  ${color.green('>')} ${color.cyan('hook status'.padEnd(35))} ${color.dim('(check hook installation state)')}`);
    console.log(`  ${color.green('>')} ${color.cyan('auth login'.padEnd(35))} ${color.dim('(authenticate with 0ctx)')}`);

    console.log(`\n${color.dim('All existing 0ctx commands are supported without the "0ctx" prefix.')}\n`);
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

    const color = (await import('picocolors')).default;
    const prompt = options.prompt ?? `${color.cyan('0ctx')}${color.dim('>')} `;

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

    // Inline ghost text (fish-shell style autosuggestions)
    readline.emitKeypressEvents(process.stdin);
    let ghostSuffix = '';

    const updateGhostText = () => {
        const line: string = (rl as any).line ?? '';
        const suggestion = getBestSuggestion(line, completions);
        ghostSuffix = suggestion ? suggestion.slice(line.length) : '';
        if (ghostSuffix) {
            // Save cursor, write dim suggestion suffix, restore cursor
            process.stdout.write('\x1b[s\x1b[2m' + ghostSuffix + '\x1b[0m\x1b[u');
        }
    };

    const keypressHandler = (_ch: string | undefined, key: readline.Key | undefined) => {
        if (!key) return;

        // Right arrow at end of line: accept ghost suggestion
        if (key.name === 'right' && ghostSuffix) {
            setImmediate(() => {
                const cursor: number = (rl as any).cursor ?? 0;
                const line: string = (rl as any).line ?? '';
                if (cursor >= line.length && ghostSuffix) {
                    const toInsert = ghostSuffix;
                    ghostSuffix = '';
                    rl.write(toInsert);
                }
            });
            return;
        }

        // After readline re-renders, compute and show the new ghost text
        setImmediate(updateGhostText);
    };

    process.stdin.on('keypress', keypressHandler);

    await printShellHelp();

    let lastExitCode = 0;
    let interrupted = false;

    rl.on('SIGINT', () => {
        ghostSuffix = '';
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

            if (line === 'exit' || line === 'quit' || line === '/exit' || line === '/quit') {
                break;
            }

            if (line === 'help' || line === '/help') {
                await printShellHelp();
                continue;
            }

            if (line === 'clear' || line === '/clear') {
                console.clear();
                continue;
            }

            if (line === 'history' || line === '/history') {
                const snapshot = loadHistory();
                snapshot.forEach((entry, idx) => {
                    console.log(`${idx + 1}. ${entry}`);
                });
                continue;
            }

            appendHistoryEntry(line);

            // Strip leading '/' from non-built-in slash commands so that
            // e.g. `/auth login` runs as `auth login`
            const commandLine = line.startsWith('/') ? line.slice(1) : line;

            let tokens: string[];
            try {
                tokens = tokenizeShellInput(commandLine);
            } catch (error) {
                console.error(error instanceof Error ? error.message : String(error));
                lastExitCode = 1;
                continue;
            }

            // Hand terminal input ownership to the child command while it runs.
            // Without this, nested interactive prompts (e.g. `mcp`) can get
            // cancelled because both the shell readline instance and child
            // process compete for stdin.
            rl.pause();
            process.stdin.off('keypress', keypressHandler);
            try {
                lastExitCode = await runShellCommand(tokens, options);
            } finally {
                if ((rl as any).closed !== true) {
                    rl.resume();
                    process.stdin.on('keypress', keypressHandler);
                }
            }
        }
    } finally {
        process.stdin.off('keypress', keypressHandler);
        rl.close();
    }

    return lastExitCode;
}
