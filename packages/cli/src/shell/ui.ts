export function getBestShellSuggestion(line: string, completions: string[]): string {
    const normalized = line.trim();
    if (!normalized) return '';
    return completions.find(candidate => candidate.startsWith(normalized) && candidate !== normalized) ?? '';
}

export function getShellCompletionCandidates(): string[] {
    const commands = [
        'enable',
        'workstreams',
        'workstreams compare',
        'sessions',
        'checkpoints',
        'checkpoints create',
        'resume',
        'rewind',
        'explain',
        'mcp',
        'mcp bootstrap',
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
        'shell',
        'release publish',
        'sync status',
        'sync policy get',
        'sync policy set',
        'connector status',
        'connector verify',
        'connector hook status',
        'hook',
        'hook status',
        'repair',
        'config list',
        'config get',
        'config set'
    ];
    const builtins = ['/help', '/clear', '/history', '/exit'];
    const slashVariants = commands.map(command => `/${command}`);
    return [...builtins, ...commands, ...slashVariants];
}

export async function printShellHelp(): Promise<void> {
    const color = (await import('picocolors')).default;

    const logo = [
        '  ___      _          ',
        ' / _ \\ ___| |____  __ ',
        '| | | / __| __\\ \\/ /  ',
        '| |_| \\__ \\ |_ >  <   ',
        ' \\___/|___/\\__/_/\\_\\  '
    ];

    console.log();
    for (const line of logo) {
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
    console.log(`  ${color.green('>')} ${color.cyan('enable'.padEnd(35))} ${color.dim('(bind this repo and install GA integrations)')}`);
    console.log(`  ${color.green('>')} ${color.cyan('workstreams'.padEnd(35))} ${color.dim('(see tracked workstreams in this repo)')}`);
    console.log(`  ${color.green('>')} ${color.cyan('sessions'.padEnd(35))} ${color.dim('(see captured sessions for the current workstream)')}`);
    console.log(`  ${color.green('>')} ${color.cyan('checkpoints'.padEnd(35))} ${color.dim('(see or create restore points)')}`);
    console.log(`  ${color.green('>')} ${color.cyan('status'.padEnd(35))} ${color.dim('(check runtime and workspace readiness)')}`);

    console.log(`\n${color.dim('All existing 0ctx commands are supported without the "0ctx" prefix.')}\n`);
}
