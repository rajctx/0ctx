import color from 'picocolors';
import type { CliRegistry } from './registry';

type NoArgDeps = Pick<CliRegistry,
    'runCommandWithOpsSummary' | 'printHelp' | 'findGitRepoRoot'
    | 'commandEnable' | 'isDaemonReachable' | 'commandBranches'
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
    const detectedRepoRoot = deps.findGitRepoRoot(null);
    console.log(color.bold('\nWelcome to 0ctx!'));
    if (detectedRepoRoot) {
        console.log(color.dim(`Detected git repo. Enabling 0ctx for ${detectedRepoRoot}.\n`));
        return deps.runCommandWithOpsSummary('cli.enable', () => deps.commandEnable({ 'repo-root': detectedRepoRoot }), {
            command: 'enable',
            interactive: true,
            reason: 'repo_entrypoint'
        });
    }
    console.log(color.dim("0ctx works repo-first. Move into a project repo and run `0ctx enable`.\n"));
    return 0;
}
