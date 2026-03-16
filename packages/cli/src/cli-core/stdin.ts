import fs from 'fs';

export function readStdinPayload(): string {
    if (process.stdin.isTTY) return '';
    try {
        const chunk = fs.readFileSync(0);
        return chunk.toString('utf8');
    } catch {
        return '';
    }
}
