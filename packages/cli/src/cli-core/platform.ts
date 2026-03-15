import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import color from 'picocolors';
import { bootstrapMcpRegistration } from '@0ctx/mcp/dist/bootstrap';
import { getConfigValue } from '@0ctx/core';
import type { BootstrapResult, SupportedClient } from './types';

export function resolveMcpEntrypointForBootstrap(explicitEntrypoint?: string): string {
    if (explicitEntrypoint && explicitEntrypoint.trim().length > 0) {
        const resolved = path.resolve(explicitEntrypoint.trim());
        if (fs.existsSync(resolved)) return resolved;
        throw new Error(`Configured MCP entrypoint does not exist: ${resolved}`);
    }

    const candidates = [
        path.resolve(__dirname, 'mcp-server.js'),
        (() => {
            try {
                return require.resolve('@0ctx/mcp/dist/index.js');
            } catch {
                return '';
            }
        })(),
        path.resolve(process.cwd(), 'packages', 'mcp', 'dist', 'index.js'),
        path.resolve(process.cwd(), 'dist', 'mcp-server.js')
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    throw new Error('Could not resolve MCP server entrypoint. Run `npm run build` (repo) or `0ctx repair` (installed CLI).');
}

export function resolveCliEntrypoint(): string {
    if (process.argv[1]) {
        return path.resolve(process.argv[1]);
    }
    return __filename;
}

function normalizeHostedUiBaseUrl(input: string): string {
    try {
        const parsed = new URL(input);
        const host = parsed.hostname.toLowerCase();
        const isLegacyHost = host === '0ctx.com'
            || host === 'www.0ctx.com'
            || host === 'app.0ctx.com';
        const isRootPath = parsed.pathname === '' || parsed.pathname === '/';
        if (isLegacyHost && isRootPath) {
            parsed.hostname = 'www.0ctx.com';
            parsed.pathname = '/install';
            return parsed.toString();
        }
        return parsed.toString();
    } catch {
        return input;
    }
}

export function getHostedUiUrl(): string {
    const configured = getConfigValue('ui.url');
    if (typeof configured === 'string' && configured.trim().length > 0) {
        return normalizeHostedUiBaseUrl(configured.trim());
    }
    return normalizeHostedUiBaseUrl('https://www.0ctx.com/install');
}

export function openUrl(url: string): void {
    try {
        const platform = os.platform();
        if (platform === 'win32') {
            execSync(`start "" "${url}"`, { stdio: 'ignore' });
        } else if (platform === 'darwin') {
            execSync(`open "${url}"`, { stdio: 'ignore' });
        } else {
            execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
        }
    } catch {
        // Best-effort open only. User can copy URL.
    }
}

export function runBootstrap(
    clients: SupportedClient[],
    dryRun: boolean,
    explicitEntrypoint?: string,
    profile?: string
): ReturnType<typeof bootstrapMcpRegistration> {
    return bootstrapMcpRegistration({
        clients,
        dryRun,
        serverName: '0ctx',
        entrypoint: resolveMcpEntrypointForBootstrap(explicitEntrypoint),
        profile
    });
}

export async function printBootstrapResults(results: BootstrapResult[], dryRun: boolean): Promise<void> {
    const p = await import('@clack/prompts');
    const mode = dryRun ? color.yellow('DRY RUN') : color.green('APPLIED');
    p.log.message(`MCP bootstrap (${mode})`);

    for (const result of results) {
        const clientName = color.cyan(result.client);
        const suffix = result.message ? color.dim(` - ${result.message}`) : '';

        if (result.status === 'failed') {
            p.log.error(`${clientName}: failed (${result.configPath || 'no config'})${suffix}`);
        } else if (result.status === 'skipped') {
            p.log.info(`${clientName}: skipped (${result.configPath || 'no config'})${suffix}`);
        } else {
            p.log.success(`${clientName}: ${result.status} (${result.configPath})${suffix}`);
        }
    }
}
