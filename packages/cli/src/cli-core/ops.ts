interface CliOpsLogger {
    operation: string;
    status: 'success' | 'error';
    details: Record<string, unknown>;
}

export function createOpsSummaryRunner(
    appendCliOpsLogEntry: (entry: CliOpsLogger) => void
) {
    return async function runCommandWithOpsSummary(
        operation: string,
        action: () => Promise<number> | number,
        details: Record<string, unknown> = {}
    ): Promise<number> {
        const startedAt = Date.now();
        try {
            const exitCode = await Promise.resolve(action());
            appendCliOpsLogEntry({
                operation,
                status: exitCode === 0 ? 'success' : 'error',
                details: {
                    ...details,
                    exitCode,
                    durationMs: Date.now() - startedAt
                }
            });
            return exitCode;
        } catch (error) {
            appendCliOpsLogEntry({
                operation,
                status: 'error',
                details: {
                    ...details,
                    exitCode: 1,
                    durationMs: Date.now() - startedAt,
                    error: error instanceof Error ? error.message : String(error)
                }
            });
            throw error;
        }
    };
}
