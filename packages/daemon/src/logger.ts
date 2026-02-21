type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogRecord {
    level: LogLevel;
    message: string;
    timestamp: string;
    [key: string]: unknown;
}

export function log(level: LogLevel, message: string, meta: Record<string, unknown> = {}): void {
    const record: LogRecord = {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...meta
    };

    const serialized = JSON.stringify(record);
    if (level === 'error' || level === 'warn') {
        console.error(serialized);
        return;
    }

    console.log(serialized);
}
