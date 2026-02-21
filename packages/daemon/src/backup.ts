import fs from 'fs';
import os from 'os';
import path from 'path';
import { decryptJson, encryptJson, type ContextDump, type EncryptedPayload } from '@0ctx/core';

const DEFAULT_BACKUP_DIR = path.join(os.homedir(), '.0ctx', 'backups');

export interface BackupManifestEntry {
    fileName: string;
    filePath: string;
    createdAt: number;
    sizeBytes: number;
    encrypted: boolean;
}

function sanitizeFileName(value: string): string {
    return value.replace(/[^a-zA-Z0-9-_.]/g, '-').slice(0, 80);
}

export function getBackupDir(): string {
    const dir = process.env.CTX_BACKUP_DIR || DEFAULT_BACKUP_DIR;
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function writeContextBackup(params: {
    dump: ContextDump;
    backupName?: string;
    encrypted?: boolean;
}): BackupManifestEntry {
    const backupDir = getBackupDir();
    const timestamp = new Date().toISOString().replaceAll(':', '-');
    const baseName = sanitizeFileName(params.backupName || params.dump.context.name || params.dump.context.id);
    const encrypted = params.encrypted ?? true;
    const fileName = `${timestamp}-${baseName}.${encrypted ? 'enc' : 'json'}`;
    const filePath = path.join(backupDir, fileName);

    const contents = encrypted
        ? JSON.stringify({ encrypted: true, payload: encryptJson(params.dump) }, null, 2)
        : JSON.stringify({ encrypted: false, payload: params.dump }, null, 2);

    fs.writeFileSync(filePath, contents, 'utf8');
    const stat = fs.statSync(filePath);

    return {
        fileName,
        filePath,
        createdAt: stat.mtimeMs,
        sizeBytes: stat.size,
        encrypted
    };
}

export function readContextBackup(fileName: string): ContextDump {
    const backupDir = getBackupDir();
    const filePath = path.join(backupDir, fileName);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Backup file '${fileName}' not found`);
    }

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        encrypted: boolean;
        payload: unknown;
    };

    if (raw.encrypted) {
        return decryptJson<ContextDump>(raw.payload as EncryptedPayload);
    }

    return raw.payload as ContextDump;
}

export function listBackups(): BackupManifestEntry[] {
    const backupDir = getBackupDir();
    const files = fs.readdirSync(backupDir, { withFileTypes: true });

    return files
        .filter(entry => entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.enc')))
        .map(entry => {
            const filePath = path.join(backupDir, entry.name);
            const stat = fs.statSync(filePath);
            return {
                fileName: entry.name,
                filePath,
                createdAt: stat.mtimeMs,
                sizeBytes: stat.size,
                encrypted: entry.name.endsWith('.enc')
            };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
}
