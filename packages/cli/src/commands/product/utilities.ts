export function createUtilityCommands(deps: import('./types').ProductCommandDeps) {
    async function commandDashboard(flags: import('./types').FlagMap): Promise<number> {
        const explicitQuery = deps.parseOptionalStringFlag(flags['dashboard-query']);
        const fallbackQuery = explicitQuery ?? await deps.buildDefaultDashboardQuery();
        const url = deps.applyDashboardQuery(deps.getHostedDashboardUrl(), fallbackQuery ?? undefined);
        console.log(`dashboard_url: ${url}`);

        if (Boolean(flags['no-open'])) {
            console.log('Open the URL above in your browser.');
            return 0;
        }

        deps.openUrl(url);
        console.log('Opened dashboard URL in your default browser (best effort).');
        return 0;
    }

    async function commandLogs(flags: import('./types').FlagMap): Promise<number> {
        if (Boolean(flags.snapshot)) {
            const limit = deps.parsePositiveIntegerFlag(flags.limit, 50);
            const sinceHours = deps.parseOptionalPositiveNumberFlag(flags['since-hours']);
            const grep = deps.parseOptionalStringFlag(flags.grep)?.toLowerCase() ?? null;
            const errorsOnly = Boolean(flags['errors-only']);
            const sinceCutoff = sinceHours ? Date.now() - (sinceHours * 60 * 60 * 1000) : null;
            const daemon = await deps.isDaemonReachable();
            const queueItemsRaw = deps.listQueuedConnectorEvents();
            const queueStats = deps.getConnectorQueueStats();
            const opsEntriesRaw = deps.readCliOpsLog(Math.max(limit * 3, limit)).reverse() as Array<Record<string, unknown>>;
            let auditEntriesRaw: Array<Record<string, unknown>> = [];
            let capabilities: unknown = null;
            let syncStatus: unknown = null;

            if (daemon.ok) {
                try {
                    const auditResult = await deps.sendToDaemon('listAuditEvents', { limit });
                    auditEntriesRaw = Array.isArray(auditResult) ? auditResult.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object') : [];
                } catch {}
                try { capabilities = await deps.sendToDaemon('getCapabilities', {}); } catch {}
                try { syncStatus = await deps.sendToDaemon('syncStatus', {}); } catch {}
            }

            const matchesSince = (value: number | null) => !sinceCutoff || (value !== null && value >= sinceCutoff);
            const matchesGrep = (entry: unknown) => !grep || JSON.stringify(entry).toLowerCase().includes(grep);
            const isOpError = (entry: Record<string, unknown>) => ['error', 'fail', 'failed'].includes(String(entry.status ?? '').toLowerCase());
            const isAuditError = (entry: Record<string, unknown>) => {
                const result = entry.result;
                if (!result || typeof result !== 'object') return false;
                const typed = result as Record<string, unknown>;
                return typed.success === false || (typeof typed.error === 'string' && typed.error.length > 0);
            };

            const queueItems = queueItemsRaw.filter(item => matchesSince(typeof item.enqueuedAt === 'number' ? item.enqueuedAt : null) && (!errorsOnly || Boolean(item.lastError || item.attempts > 0)) && matchesGrep(item)).slice(0, limit);
            const opsEntries = opsEntriesRaw.filter(entry => matchesSince(typeof entry.timestamp === 'number' ? entry.timestamp : null) && (!errorsOnly || isOpError(entry)) && matchesGrep(entry)).slice(0, limit);
            const auditEntries = auditEntriesRaw.filter(entry => matchesSince(typeof entry.createdAt === 'number' ? entry.createdAt : null) && (!errorsOnly || isAuditError(entry)) && matchesGrep(entry)).slice(0, limit);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                filters: { limit, sinceHours, grep, errorsOnly },
                daemon: { reachable: daemon.ok, error: daemon.ok ? null : (daemon.error ?? 'unknown'), health: daemon.ok ? (daemon.health ?? null) : null, capabilities, sync: syncStatus },
                connector: { statePath: deps.getConnectorStatePath(), state: deps.readConnectorState(), queuePath: deps.getConnectorQueuePath(), queue: { stats: queueStats, sample: queueItems, filteredCount: queueItems.length, totalCount: queueItemsRaw.length } },
                logs: { opsPath: deps.getCliOpsLogPath(), opsEntries, auditEntries, filtered: { opsCount: opsEntries.length, auditCount: auditEntries.length } }
            }, null, 2));
            return 0;
        }

        const { port, close } = await deps.startLogsServer();
        const url = `http://127.0.0.1:${port}`;
        console.log(`logs_url: ${url}`);
        if (!Boolean(flags['no-open'])) {
            deps.openUrl(url);
            console.log('Opened local logs in your default browser (best effort).');
        }
        console.log('Local logs server running. Press Ctrl+C to stop (auto-closes after 30 min of inactivity).');

        await new Promise<void>(resolve => {
            process.once('SIGINT', resolve);
            process.once('SIGTERM', resolve);
        });

        await close();
        return 0;
    }

    return { commandDashboard, commandLogs };
}
