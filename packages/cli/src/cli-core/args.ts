import type { ParsedArgs } from './types';

export function normalizeCommandAlias(command: string): string {
    const normalized = command.trim().toLowerCase();
    if (normalized === 'deamon') return 'daemon';
    if (normalized === 'log') return 'logs';
    return normalized;
}

export function parseArgs(argv: string[]): ParsedArgs {
    const [rawCommand = 'help', maybeSubcommand, ...rest] = argv;
    const command = normalizeCommandAlias(rawCommand);
    const hasSubcommand = command === 'daemon'
        || command === 'auth'
        || command === 'config'
        || command === 'sync'
        || command === 'checkpoints'
        || command === 'connector'
        || command === 'mcp'
        || command === 'release';
    const tokens = hasSubcommand
        ? rest
        : [maybeSubcommand, ...rest].filter((token): token is string => Boolean(token));
    const flags: Record<string, string | boolean> = {};
    const consumedArgIndexes = new Set<number>();

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (!token.startsWith('--')) continue;

        const equalsIndex = token.indexOf('=');
        const rawKey = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
        const rawValue = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1);
        const key = rawKey.slice(2);

        if (rawValue !== undefined) {
            flags[key] = rawValue;
            consumedArgIndexes.add(i);
            continue;
        }

        const next = tokens[i + 1];
        if (next && !next.startsWith('--')) {
            flags[key] = next;
            consumedArgIndexes.add(i);
            consumedArgIndexes.add(i + 1);
            i += 1;
            continue;
        }

        flags[key] = true;
        consumedArgIndexes.add(i);
    }

    const sub = hasSubcommand ? maybeSubcommand : undefined;
    const serviceAction = (sub === 'service' && tokens[0] && !tokens[0].startsWith('--'))
        ? tokens[0]
        : undefined;
    const positionalArgs = tokens.filter((arg, index) => !consumedArgIndexes.has(index) && !arg.startsWith('--'));
    return { command, subcommand: sub, serviceAction, positionalArgs, flags };
}

export function parsePositiveNumberFlag(value: string | boolean | undefined, fallback: number): number {
    if (typeof value !== 'string') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseOptionalPositiveNumberFlag(value: string | boolean | undefined): number | null {
    if (typeof value !== 'string') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parsePositiveIntegerFlag(value: string | boolean | undefined, fallback: number): number {
    const parsed = parsePositiveNumberFlag(value, fallback);
    return Math.max(1, Math.floor(parsed));
}

export function parseOptionalStringFlag(value: string | boolean | undefined): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function parseOptionalBooleanLikeFlag(value: string | boolean | undefined): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return null;
}

export function sleepMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function applyDashboardQuery(url: string, queryRaw: string | boolean | undefined): string {
    if (!queryRaw || typeof queryRaw !== 'string') return url;
    const query = queryRaw.trim();
    if (!query) return url;
    return query.startsWith('?') ? `${url}${query}` : `${url}?${query}`;
}
