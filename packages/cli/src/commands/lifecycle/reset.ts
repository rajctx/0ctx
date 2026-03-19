import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FlagMap, ResetCommandDeps } from './types';

export function createResetCommand(deps: ResetCommandDeps) {
    return async function commandReset(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const full = Boolean(flags.full);
        const confirmed = Boolean(flags.confirm);

        if (!confirmed && !asJson) {
            const p = await import('@clack/prompts');
            const accepted = await p.confirm({
                message: full
                    ? 'Reset local 0ctx runtime data, hook state, legacy runtime state, and backups on this machine?'
                    : 'Reset local 0ctx runtime data on this machine?',
                initialValue: false
            });
            if (p.isCancel(accepted) || !accepted) {
                p.cancel('Reset cancelled.');
                return 1;
            }
        } else if (!confirmed && asJson) {
            console.error('reset_requires_confirm: pass --confirm to run non-interactively.');
            return 1;
        }

        const daemonBefore = await deps.isDaemonReachable();
        if (daemonBefore.ok) {
            console.error('reset_requires_daemon_stop: stop the daemon/service before resetting local data.');
            console.error('Try: 0ctx daemon service stop');
            return 1;
        }

        const backupDir = process.env.CTX_BACKUP_DIR ?? path.join(os.homedir(), '.0ctx', 'backups');
        const targets = [
            deps.DB_PATH,
            `${deps.DB_PATH}-shm`,
            `${deps.DB_PATH}-wal`,
            deps.getHookDumpDir(),
            deps.getConnectorQueuePath(),
            deps.getCliOpsLogPath(),
            full ? deps.getConnectorStatePath() : null,
            full ? deps.getHookStatePath() : null,
            full ? backupDir : null
        ].filter((value): value is string => typeof value === 'string' && value.length > 0);

        const removed: string[] = [];
        const skipped: string[] = [];
        for (const target of targets) {
            if (!fs.existsSync(target)) {
                skipped.push(target);
                continue;
            }
            fs.rmSync(target, { recursive: true, force: true });
            removed.push(target);
        }

        if (asJson) {
            console.log(JSON.stringify({ ok: true, full, removed, skipped }, null, 2));
            return 0;
        }

        console.log('\nLocal reset complete.\n');
        for (const entry of removed) console.log(`  removed: ${entry}`);
        for (const entry of skipped) console.log(`  skipped: ${entry}`);
        console.log('');
        return 0;
    };
}
