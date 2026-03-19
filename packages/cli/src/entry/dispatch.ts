import type { ParsedArgs } from '../cli-core/types';
import type { CliRegistry } from './registry';

export function resolveDataPolicySubcommand(candidate: string | null | undefined): string | null {
    if (!candidate) return null;
    return ['show', 'get', 'presets', 'catalog', 'set', 'cleanup', 'lean', 'review', 'debug', 'shared'].includes(candidate)
        ? candidate
        : null;
}

type DispatchDeps = Pick<CliRegistry,
    'commandEnable' | 'commandSetup' | 'commandInstall' | 'commandBootstrap' | 'commandMcp'
    | 'commandDoctor' | 'commandStatus' | 'commandRepair' | 'commandReset' | 'commandVersion'
    | 'commandBranches' | 'commandWorkspaces' | 'commandAgentContext' | 'commandSessions'
    | 'commandCheckpoints' | 'commandInsights' | 'commandExtract' | 'commandResume'
    | 'commandRewind' | 'commandExplain' | 'commandRecall' | 'startDaemonDetached'
    | 'waitForDaemon' | 'commandDaemonService' | 'printHelp' | 'commandConfigList'
    | 'commandConfigGet' | 'commandConfigSet' | 'commandDataPolicy' | 'commandConnector'
    | 'commandConnectorQueue' | 'commandConnectorHook' | 'commandLogs'
    | 'commandShell' | 'commandReleasePublish'
>;

export async function runParsedCommand(parsed: ParsedArgs, deps: DispatchDeps): Promise<number> {
    switch (parsed.command) {
        case 'enable': return deps.commandEnable(parsed.flags);
        case 'setup': return deps.commandSetup(parsed.flags);
        case 'install': return deps.commandInstall(parsed.flags);
        case 'bootstrap': return deps.commandBootstrap(parsed.flags);
        case 'mcp': return deps.commandMcp(parsed.subcommand, parsed.flags);
        case 'doctor': return deps.commandDoctor(parsed.flags);
        case 'status': return deps.commandStatus(parsed.flags);
        case 'repair': return deps.commandRepair(parsed.flags);
        case 'reset': return deps.commandReset(parsed.flags);
        case 'version': return deps.commandVersion(parsed.flags);
        case 'workstreams':
        case 'branches':
            return deps.commandBranches(parsed.positionalArgs, parsed.flags);
        case 'workspaces': return deps.commandWorkspaces(parsed.positionalArgs, parsed.flags);
        case 'agent-context': return deps.commandAgentContext(parsed.flags);
        case 'sessions': return deps.commandSessions(parsed.flags);
        case 'checkpoints': return deps.commandCheckpoints(parsed.subcommand, parsed.flags);
        case 'insights': return deps.commandInsights(parsed.positionalArgs, parsed.flags);
        case 'extract': return deps.commandExtract(parsed.positionalArgs, parsed.flags);
        case 'resume': return deps.commandResume(parsed.flags);
        case 'rewind': return deps.commandRewind(parsed.flags);
        case 'explain': return deps.commandExplain(parsed.flags);
        case 'recall': return deps.commandRecall(parsed.flags, parsed.positionalArgs);
        case 'auth':
            console.error('`0ctx auth` has been removed from the current local-first product path.');
            return 1;
        case 'daemon':
            if (parsed.subcommand === 'start') {
                try {
                    deps.startDaemonDetached();
                } catch (error) {
                    console.error(error instanceof Error ? error.message : String(error));
                    return 1;
                }
                const ok = await deps.waitForDaemon();
                console.log(ok ? 'daemon started' : 'daemon start timeout');
                return ok ? 0 : 1;
            }
            if (parsed.subcommand === 'service') return deps.commandDaemonService(parsed.serviceAction);
            deps.printHelp(Boolean(parsed.flags.advanced));
            return 1;
        case 'config': {
            const sub = parsed.subcommand;
            if (sub === 'list' || !sub) return deps.commandConfigList();
            if (sub === 'get') return deps.commandConfigGet(parsed.positionalArgs[0]);
            if (sub === 'set') return deps.commandConfigSet(parsed.positionalArgs[0], parsed.positionalArgs[1]);
            deps.printHelp(Boolean(parsed.flags.advanced));
            return 1;
        }
        case 'data-policy':
            return deps.commandDataPolicy(resolveDataPolicySubcommand(parsed.subcommand ?? parsed.positionalArgs[0] ?? null), parsed.flags);
        case 'sync': {
            console.error('`0ctx sync` has been removed from the local-only product surface.');
            console.error('Workspace data stays local by default. Use `0ctx data-policy` to manage local capture and debug retention.');
            return 1;
        }
        case 'connector':
            if (parsed.subcommand === 'hook') return deps.commandConnectorHook(parsed.positionalArgs[0], parsed.flags);
            if (parsed.subcommand === 'run') return deps.commandConnector(parsed.subcommand, parsed.flags);
            if (parsed.subcommand === 'service') return deps.commandDaemonService(parsed.serviceAction);
            if (parsed.subcommand && ['install', 'enable', 'disable', 'uninstall', 'start', 'stop', 'restart'].includes(parsed.subcommand)) {
                return deps.commandDaemonService(parsed.subcommand);
            }
            console.error('`0ctx connector` is no longer part of the normal local product surface.');
            console.error('Use `0ctx hook ...` for capture hooks, `0ctx daemon service ...` for service management, and `0ctx logs` for runtime diagnostics.');
            return 1;
        case 'hook': return deps.commandConnectorHook(parsed.positionalArgs[0], parsed.flags);
        case 'logs': return deps.commandLogs(parsed.flags);
        case 'shell': return deps.commandShell();
        case 'release':
            if (parsed.subcommand === 'publish') return deps.commandReleasePublish(parsed.flags);
            deps.printHelp(Boolean(parsed.flags.advanced));
            return 1;
        case 'ui':
            console.error('`0ctx ui` has been removed from the end-user flow.');
            console.error('Use `0ctx enable` inside a repo for the normal local product flow.');
            return 1;
        case 'help':
            deps.printHelp(Boolean(parsed.flags.advanced));
            return 0;
        default:
            deps.printHelp(Boolean(parsed.flags.advanced));
            return 1;
    }
}
