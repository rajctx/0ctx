import color from 'picocolors';
import type { ProductCommandDeps, FlagMap } from './types';

export function createBootstrapCommands(deps: ProductCommandDeps) {
    async function commandBootstrap(flags: FlagMap): Promise<number> {
        const p = await import('@clack/prompts');
        const allowPreview = Boolean(flags['allow-preview']) || Boolean(flags.allowPreview);
        const previewError = !allowPreview
            ? deps.validateExplicitPreviewSelection(flags.clients, 'codex,cursor,windsurf')
            : null;
        if (previewError) {
            console.error(previewError);
            return 1;
        }
        const previewOptInError = deps.validatePreviewOptIn(flags.clients, allowPreview, 'codex,cursor,windsurf');
        if (previewOptInError) {
            console.error(previewOptInError);
            return 1;
        }
        const clients = deps.parseClients(flags.clients);
        const dryRun = Boolean(flags['dry-run']);
        const entrypoint = deps.parseOptionalStringFlag(flags.entrypoint) ?? undefined;
        const mcpProfile = deps.parseOptionalStringFlag(flags['mcp-profile'] ?? flags.profile) ?? 'core';

        if (!Boolean(flags.quiet) && !Boolean(flags.json)) {
            p.intro(color.bgBlue(color.black(' 0ctx bootstrap ')));
        }

        const spinner = p.spinner();
        if (!Boolean(flags.quiet) && !Boolean(flags.json)) spinner.start('Applying MCP configurations');

        const results = deps.runBootstrap(clients, dryRun, entrypoint, mcpProfile);

        if (!Boolean(flags.quiet) && !Boolean(flags.json)) {
            spinner.stop('Bootstrap complete');
            await deps.printBootstrapResults(results, dryRun);
            p.log.info('Restart your AI client app so it picks up automatic retrieval config changes.');
            p.outro(results.some(r => r.status === 'failed') ? color.yellow('Bootstrap finished with errors') : color.green('Bootstrap successful'));
        }

        if (Boolean(flags.json)) {
            console.log(JSON.stringify({ dryRun, clients, mcpProfile, results }, null, 2));
        }
        return results.some(result => result.status === 'failed') ? 1 : 0;
    }

    async function commandMcp(subcommand: string | undefined, flags: FlagMap): Promise<number> {
        const action = (subcommand ?? '').trim().toLowerCase();

        if (action === 'bootstrap') {
            return commandBootstrap(flags);
        }
        if (action === 'setup' || action === 'validate') {
            console.error(`0ctx mcp ${action} is deprecated. Use \`0ctx bootstrap\` to repair supported-agent retrieval or \`0ctx setup\` for advanced machine management.`);
            return 1;
        }
        if (action && action !== 'wizard') {
            console.error(`Unknown mcp action: '${action}'`);
            console.error('Usage: 0ctx mcp [bootstrap]');
            return 1;
        }

        const asJson = Boolean(flags.json);
        const quiet = Boolean(flags.quiet) || asJson;

        if (quiet || !process.stdin.isTTY || !process.stdout.isTTY) {
            const nextFlags: FlagMap = { ...flags };
            if (!nextFlags.clients) nextFlags.clients = 'ga';
            if (!nextFlags['mcp-profile'] && !nextFlags.profile) nextFlags['mcp-profile'] = 'core';
            return commandBootstrap(nextFlags);
        }

        const p = await import('@clack/prompts');
        p.intro(color.bgBlue(color.black(' 0ctx mcp ')));

        const nextFlags: FlagMap = { ...flags };
        const selectedClients = await p.multiselect({
            message: 'Select AI clients',
            required: true,
            options: [
                { value: 'claude', label: 'Claude Desktop' },
                { value: 'antigravity', label: 'Antigravity' }
            ]
        });
        if (p.isCancel(selectedClients)) {
            p.cancel('Cancelled.');
            return 1;
        }

        const clients = (selectedClients as string[]).filter(client => deps.DEFAULT_MCP_CLIENTS.includes(client) || client === 'claude' || client === 'antigravity');
        const isGaClients = clients.length === deps.DEFAULT_MCP_CLIENTS.length
            && deps.DEFAULT_MCP_CLIENTS.every(client => clients.includes(client));
        nextFlags.clients = isGaClients ? 'ga' : clients.join(',');

        const selectedProfile = await p.select({
            message: 'Select MCP tool profile',
            initialValue: 'core',
            options: [
                { value: 'core', label: 'core (Recommended)', hint: 'Graph + context tools' },
                { value: 'recall', label: 'recall', hint: 'core + recall tools' },
                { value: 'ops', label: 'ops', hint: 'core + ops/runtime tools' },
                { value: 'all', label: 'all', hint: 'All MCP tools' }
            ]
        });
        if (p.isCancel(selectedProfile)) {
            p.cancel('Cancelled.');
            return 1;
        }

        nextFlags['mcp-profile'] = String(selectedProfile);
        nextFlags['no-open'] = true;

        const resultCode = await commandBootstrap(nextFlags);
        p.outro(resultCode === 0 ? color.green('MCP bootstrap completed.') : color.yellow('MCP bootstrap finished with issues.'));
        return resultCode;
    }

    return {
        commandBootstrap,
        commandMcp
    };
}
