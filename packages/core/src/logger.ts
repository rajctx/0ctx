/**
 * OPS-001: Structured JSON logger with correlation IDs.
 *
 * Usage:
 *   import { createLogger } from '@0ctx/core/logger';
 *   const log = createLogger('daemon');
 *   log.info('Server started', { port: 8787 });
 *
 * Environment:
 *   CTX_LOG_LEVEL   — min level: trace|debug|info|warn|error|fatal (default: info)
 *   CTX_LOG_FORMAT  — 'json' (default) or 'text' for human-readable
 */

import { randomUUID } from 'crypto';

// ── Log levels ────────────────────────────────────────────────────────────────

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_VALUES: Record<LogLevel, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60
};

function resolveLevel(): LogLevel {
    const env = (process.env.CTX_LOG_LEVEL ?? 'info').toLowerCase();
    return env in LEVEL_VALUES ? (env as LogLevel) : 'info';
}

function resolveFormat(): 'json' | 'text' {
    return process.env.CTX_LOG_FORMAT === 'text' ? 'text' : 'json';
}

// ── Log entry ─────────────────────────────────────────────────────────────────

export interface LogEntry {
    level: LogLevel;
    ts: string;
    component: string;
    msg: string;
    correlationId?: string;
    requestId?: string;
    [key: string]: unknown;
}

// ── Logger ────────────────────────────────────────────────────────────────────

export interface Logger {
    trace(msg: string, data?: Record<string, unknown>): void;
    debug(msg: string, data?: Record<string, unknown>): void;
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
    fatal(msg: string, data?: Record<string, unknown>): void;
    child(extra: Record<string, unknown>): Logger;
}

export function createLogger(component: string, defaults?: Record<string, unknown>): Logger {
    const minLevel = resolveLevel();
    const minValue = LEVEL_VALUES[minLevel];
    const format = resolveFormat();

    function emit(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
        if (LEVEL_VALUES[level] < minValue) return;

        const entry: LogEntry = {
            level,
            ts: new Date().toISOString(),
            component,
            msg,
            ...defaults,
            ...data
        };

        const output = format === 'json'
            ? JSON.stringify(entry)
            : formatText(entry);

        if (LEVEL_VALUES[level] >= LEVEL_VALUES.error) {
            process.stderr.write(output + '\n');
        } else {
            process.stdout.write(output + '\n');
        }
    }

    const logger: Logger = {
        trace: (msg, data) => emit('trace', msg, data),
        debug: (msg, data) => emit('debug', msg, data),
        info: (msg, data) => emit('info', msg, data),
        warn: (msg, data) => emit('warn', msg, data),
        error: (msg, data) => emit('error', msg, data),
        fatal: (msg, data) => emit('fatal', msg, data),
        child(extra: Record<string, unknown>): Logger {
            return createLogger(component, { ...defaults, ...extra });
        }
    };

    return logger;
}

// ── Correlation ID ────────────────────────────────────────────────────────────

/**
 * Generate a new correlation ID for tracing requests across services.
 */
export function newCorrelationId(): string {
    return randomUUID();
}

// ── Text formatter ────────────────────────────────────────────────────────────

function formatText(entry: LogEntry): string {
    const { level, ts, component, msg, ...rest } = entry;
    const tag = level.toUpperCase().padEnd(5);
    const extra = Object.keys(rest).length > 0
        ? ' ' + JSON.stringify(rest)
        : '';
    return `${ts} [${tag}] ${component}: ${msg}${extra}`;
}
