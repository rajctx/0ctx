import fs from 'fs';
import os from 'os';
import path from 'path';

export const SHELL_HISTORY_LIMIT = 500;

function getHistoryPath(): string {
    return path.join(os.homedir(), '.0ctx', 'history');
}

export function loadShellHistory(): string[] {
    const historyPath = getHistoryPath();
    if (!fs.existsSync(historyPath)) return [];
    try {
        const lines = fs
            .readFileSync(historyPath, 'utf8')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
        return lines.slice(-SHELL_HISTORY_LIMIT);
    } catch {
        return [];
    }
}

export function appendShellHistoryEntry(line: string): void {
    const normalized = line.trim();
    if (!normalized) return;
    const historyPath = getHistoryPath();
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.appendFileSync(historyPath, `${normalized}\n`, 'utf8');
}
