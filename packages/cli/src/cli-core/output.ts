import type { ParsedArgs } from './types';

export function printJsonOrValue(asJson: boolean, value: unknown, human: () => void): number {
    if (asJson) {
        console.log(JSON.stringify(value, null, 2));
        return 0;
    }
    human();
    return 0;
}

export function normalizeVersionCommandArgs(argv: string[]): string[] {
    if (argv.length === 1 && (argv[0] === '-v' || argv[0] === '--version')) {
        return ['version'];
    }
    return argv;
}

export function resolveCommandOperation(parsed: ParsedArgs): string {
    if (parsed.command === 'auth') {
        return parsed.subcommand ? `cli.auth.${parsed.subcommand}` : 'cli.auth';
    }
    if (parsed.command === 'config') {
        return parsed.subcommand ? `cli.config.${parsed.subcommand}` : 'cli.config.list';
    }
    if (parsed.command === 'sync') {
        return parsed.subcommand ? `cli.sync.${parsed.subcommand}` : 'cli.sync';
    }
    if (parsed.command === 'connector') {
        if (parsed.subcommand === 'hook') {
            const action = parsed.positionalArgs[0] || 'status';
            return `cli.hook.${action}`;
        }
        if (parsed.subcommand === 'service') {
            const action = parsed.serviceAction || 'unknown';
            return `cli.daemon.service.${action}`;
        }
        if (parsed.subcommand === 'queue') {
            const action = parsed.positionalArgs[0] || 'status';
            return `cli.connector.queue.${action}`;
        }
        return parsed.subcommand ? `cli.connector.${parsed.subcommand}` : 'cli.connector';
    }
    if (parsed.command === 'hook') {
        const action = parsed.positionalArgs[0] || 'status';
        return `cli.hook.${action}`;
    }
    if (parsed.command === 'mcp') {
        return parsed.subcommand ? `cli.mcp.${parsed.subcommand}` : 'cli.mcp';
    }
    if (parsed.command === 'daemon') {
        if (parsed.subcommand === 'service') {
            const action = parsed.serviceAction || 'unknown';
            return `cli.daemon.service.${action}`;
        }
        return parsed.subcommand ? `cli.daemon.${parsed.subcommand}` : 'cli.daemon';
    }
    if (parsed.command === 'release') {
        return parsed.subcommand ? `cli.release.${parsed.subcommand}` : 'cli.release';
    }
    if (parsed.command === 'checkpoints') {
        return parsed.subcommand ? `cli.checkpoints.${parsed.subcommand}` : 'cli.checkpoints.list';
    }
    if (parsed.command === 'workstreams') {
        return 'cli.workstreams';
    }
    if (!parsed.command) return 'cli.help';
    return `cli.${parsed.command}`;
}
