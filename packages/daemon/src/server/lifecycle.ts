import net from 'net';
import type Database from 'better-sqlite3';
import type { SyncEngine } from '../sync-engine';
import { log } from '../logger';

export function createDaemonCloser(
    server: net.Server,
    db: Database.Database,
    socketPath: string,
    syncEngine?: SyncEngine
): () => Promise<void> {
    let closed = false;

    return async () => {
        if (closed) return;
        closed = true;

        syncEngine?.stop();

        await new Promise<void>((resolve) => {
            if (!server.listening) {
                resolve();
                return;
            }

            server.close((closeError) => {
                if (closeError) {
                    log('warn', 'daemon_close_error', {
                        socketPath,
                        error: closeError.message
                    });
                }
                resolve();
            });
        });

        try {
            db.close();
        } catch (closeError) {
            log('warn', 'daemon_db_close_error', {
                error: closeError instanceof Error ? closeError.message : String(closeError)
            });
        }
    };
}

export function registerShutdownHandlers(closeDaemon: () => Promise<void>): void {
    const shutdown = (signal: 'SIGINT' | 'SIGTERM') => {
        log('info', 'daemon_shutdown', { signal });
        void closeDaemon().finally(() => {
            process.exit();
        });
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}
