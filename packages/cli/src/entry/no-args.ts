import color from 'picocolors';
import type { CliRegistry } from './registry';

type NoArgDeps = Pick<CliRegistry,
    'runCommandWithOpsSummary' | 'printHelp' | 'resolveToken' | 'readConnectorState'
    | 'findGitRepoRoot' | 'commandEnable' | 'commandAuthLogin' | 'isTokenExpired'
    | 'refreshAccessToken' | 'getEnvToken' | 'isDaemonReachable' | 'commandBranches'
> & {
    captureEvent: (name: string, properties: Record<string, unknown>) => void;
    stdinIsTTY: boolean;
    stdoutIsTTY: boolean;
    shellMode: boolean;
};

export async function runWithoutArgs(deps: NoArgDeps): Promise<number> {
    if (deps.shellMode) {
        deps.captureEvent('cli_command_executed', { command: 'help' });
        return deps.runCommandWithOpsSummary('cli.help', () => {
            deps.printHelp(false);
            return 0;
        }, { command: 'help', interactive: true });
    }
    if (!(deps.stdinIsTTY && deps.stdoutIsTTY)) {
        deps.captureEvent('cli_command_executed', { command: 'help' });
        return deps.runCommandWithOpsSummary('cli.help', () => {
            deps.printHelp(false);
            return 0;
        }, { command: 'help', interactive: false });
    }
    const tokenStore = deps.resolveToken();
    const connectorState = deps.readConnectorState();
    const detectedRepoRoot = deps.findGitRepoRoot(null);
    if (!tokenStore) {
        console.log(color.bold('\nWelcome to 0ctx!'));
        if (detectedRepoRoot) {
            console.log(color.dim(`Detected git repo. Enabling 0ctx for ${detectedRepoRoot}.\n`));
            return deps.runCommandWithOpsSummary('cli.enable', () => deps.commandEnable({ 'repo-root': detectedRepoRoot }), {
                command: 'enable',
                interactive: true,
                reason: 'first_run_repo'
            });
        }
        console.log(color.dim("0ctx works repo-first. Move into a project repo and run `0ctx enable`.\n"));
        console.log(color.dim('Optional machine step: run `0ctx auth login` first if you need account-backed features before enabling a repo.\n'));
        return 0;
    }
    if (!deps.getEnvToken() && deps.isTokenExpired(tokenStore)) {
        let refreshed = false;
        if ((tokenStore as { refreshToken?: string | null }).refreshToken) {
            try {
                await deps.refreshAccessToken(tokenStore);
                refreshed = true;
            } catch {
                // Fall back to interactive login below.
            }
        }
        if (!refreshed) {
            if (!detectedRepoRoot) {
                console.log(color.bold('\nYour session has expired.'));
                console.log(color.dim('Move into a repo and run `0ctx enable`, or run `0ctx auth login` if you need account-backed features first.\n'));
                return 0;
            }
            console.log(color.bold('\nYour session has expired.'));
            console.log(color.dim('Logging you back in...\n'));
            const loginCode = await deps.runCommandWithOpsSummary('cli.auth.login', () => deps.commandAuthLogin({}), {
                command: 'auth',
                subcommand: 'login',
                interactive: true
            });
            if (loginCode !== 0) return loginCode;
        }
    }
    if (!connectorState) {
        if (detectedRepoRoot) {
            console.log(color.bold('\nAlmost there!'));
            console.log(color.dim(`This repo is not enabled yet. Enabling 0ctx for ${detectedRepoRoot}...\n`));
            deps.captureEvent('cli_command_executed', { command: 'enable', interactive: true, reason: 'machine_unregistered_repo' });
            return deps.runCommandWithOpsSummary('cli.enable', () => deps.commandEnable({ 'repo-root': detectedRepoRoot }), {
                command: 'enable',
                interactive: true,
                reason: 'machine_unregistered_repo'
            });
        }
        console.log(color.bold('\nAlmost there!'));
        console.log(color.dim("This machine is signed in, but you are not inside an enabled repo.\n"));
        console.log(color.dim('Next step: `cd <repo> && 0ctx enable`\n'));
        return 0;
    }
    const daemonPreflight = await deps.isDaemonReachable();
    if (!daemonPreflight.ok) {
        console.log(color.bold('\nRuntime needs repair.'));
        if (detectedRepoRoot) {
            console.log(color.dim(`Daemon is unreachable. Re-enabling 0ctx for ${detectedRepoRoot}...\n`));
            deps.captureEvent('cli_command_executed', { command: 'enable', interactive: true, reason: 'daemon_unreachable_repo' });
            const enableCode = await deps.runCommandWithOpsSummary('cli.enable.auto_repair', () => deps.commandEnable({ 'repo-root': detectedRepoRoot }), {
                command: 'enable',
                interactive: true,
                reason: 'daemon_unreachable_repo'
            });
            if (enableCode !== 0) return enableCode;
        } else {
            console.log(color.dim('Daemon is unreachable and this directory is not a bound repo.\n'));
            console.log(color.dim('Use `0ctx repair` if you are fixing this machine, or `cd <repo> && 0ctx enable` from a project.\n'));
            return 1;
        }
    }
    if (!detectedRepoRoot) {
        console.log(color.bold('\n0ctx is ready on this machine.'));
        console.log(color.dim('Move into a repo and run `0ctx enable` for the normal product flow.\n'));
        console.log(color.dim('Use `0ctx shell` only if you need the advanced interactive shell outside a repo.\n'));
        return 0;
    }
    deps.captureEvent('cli_command_executed', { command: 'workstreams', subcommand: 'current', interactive: true, reason: 'repo_entrypoint' });
    return deps.runCommandWithOpsSummary('cli.workstreams.current', () => deps.commandBranches(['current'], { 'repo-root': detectedRepoRoot, limit: '1' }), {
        command: 'workstreams',
        subcommand: 'current',
        interactive: true,
        reason: 'repo_entrypoint',
        limit: '1'
    });
}
