import readline from 'readline';
import { spawn } from 'child_process';
import { appendShellHistoryEntry, loadShellHistory, SHELL_HISTORY_LIMIT } from './shell/history.js';
import { getBestShellSuggestion, getShellCompletionCandidates, printShellHelp } from './shell/ui.js';

export interface ShellOptions {
    cliEntrypoint: string;
    nodeExecArgv?: string[];
    prompt?: string;
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise(resolve => {
        rl.question(prompt, answer => resolve(answer));
    });
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

    const history = loadShellHistory();
    const completions = getShellCompletionCandidates();
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        historySize: SHELL_HISTORY_LIMIT,
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
        const suggestion = getBestShellSuggestion(line, completions);
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
                const snapshot = loadShellHistory();
                snapshot.forEach((entry, idx) => {
                    console.log(`${idx + 1}. ${entry}`);
                });
                continue;
            }

            appendShellHistoryEntry(line);

            // Strip leading '/' from non-built-in slash commands so that
            // e.g. `/status` runs as `status`
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
