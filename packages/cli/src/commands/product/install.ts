import color from 'picocolors';
import type { ProductCommandDeps, FlagMap } from './types';

export function createInstallCommand(
    deps: ProductCommandDeps & { commandBootstrap: (flags: FlagMap) => Promise<number> }
) {
    return async function commandInstall(flags: FlagMap): Promise<number> {
        const p = await import('@clack/prompts');
        const quiet = Boolean(flags.quiet);
        const asJson = Boolean(flags.json);
        const skipBootstrap = Boolean(flags['skip-bootstrap']);
        const previewError = deps.validateExplicitPreviewSelection(flags.clients, 'codex,cursor,windsurf');
        if (previewError) {
            console.error(previewError);
            return 1;
        }

        if (!quiet && !asJson) p.intro(color.bgBlue(color.black(' 0ctx install ')));
        const spinner = p.spinner();
        if (!quiet && !asJson) spinner.start('Checking daemon status');

        const daemonStatus = await deps.isDaemonReachable();
        if (!daemonStatus.ok) {
            if (!quiet && !asJson) spinner.message('Starting background service...');
            try {
                deps.startDaemonDetached();
            } catch (error) {
                if (!quiet && !asJson) spinner.stop(color.red('Failed to start daemon'));
                console.error(error instanceof Error ? error.message : String(error));
                if (!quiet && !asJson) p.outro(color.red('Install failed'));
                return 1;
            }
        }

        if (!quiet && !asJson) spinner.message('Waiting for daemon to become ready...');
        const ready = await deps.waitForDaemon();
        if (!ready) {
            if (!quiet && !asJson) spinner.stop(color.red('Daemon start timeout'));
            console.error('Unable to reach daemon health endpoint.');
            if (!quiet && !asJson) p.outro(color.red('Install failed'));
            return 1;
        }

        if (!quiet && !asJson) spinner.stop(color.green('Daemon is ready'));

        if (!skipBootstrap) {
            const bootstrapCode = await deps.commandBootstrap({ ...flags, quiet: (quiet || asJson), json: false });
            if (bootstrapCode !== 0) {
                if (!quiet && !asJson) p.outro(color.yellow('Install partial (bootstrap failed)'));
                return bootstrapCode;
            }
        }

        if (quiet || asJson) {
            if (asJson) {
                console.log(JSON.stringify({ ok: true, daemonRunning: true, bootstrap: skipBootstrap ? 'skipped' : 'ok' }, null, 2));
            }
            return 0;
        }

        const checks = await deps.isDaemonReachable();
        p.outro(color.green(`Installation complete! Daemon is ${checks.ok ? 'running' : 'degraded'}.`));
        return checks.ok ? 0 : 1;
    };
}
