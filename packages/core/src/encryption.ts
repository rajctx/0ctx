import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const MASTER_KEY_PATH = path.join(os.homedir(), '.0ctx', 'master.key');
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface EncryptedPayload {
    version: 1;
    keyId: string;
    iv: string;
    tag: string;
    ciphertext: string;
}

function normalizeMasterKey(raw: string): Buffer {
    try {
        const base64 = Buffer.from(raw, 'base64');
        if (base64.length === KEY_BYTES) return base64;
    } catch {
        // no-op
    }

    const utf = Buffer.from(raw, 'utf8');
    if (utf.length === KEY_BYTES) return utf;

    throw new Error('Master key must be 32 bytes (base64-encoded or raw UTF-8).');
}

function loadOrCreateMasterKey(): Buffer {
    if (process.env.CTX_MASTER_KEY) {
        return normalizeMasterKey(process.env.CTX_MASTER_KEY);
    }

    fs.mkdirSync(path.dirname(MASTER_KEY_PATH), { recursive: true });

    if (!fs.existsSync(MASTER_KEY_PATH)) {
        const generated = randomBytes(KEY_BYTES).toString('base64');
        fs.writeFileSync(MASTER_KEY_PATH, generated, { mode: 0o600 });
    }

    const fileKey = fs.readFileSync(MASTER_KEY_PATH, 'utf8').trim();
    return normalizeMasterKey(fileKey);
}

function getKeyId(key: Buffer): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function encryptJson(value: unknown): EncryptedPayload {
    const key = loadOrCreateMasterKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');

    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        version: 1,
        keyId: getKeyId(key),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        ciphertext: ciphertext.toString('base64')
    };
}

export function decryptJson<T>(payload: EncryptedPayload): T {
    if (payload.version !== 1) {
        throw new Error(`Unsupported encryption payload version ${payload.version}`);
    }

    const key = loadOrCreateMasterKey();
    const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(payload.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext, 'base64')),
        decipher.final()
    ]);

    return JSON.parse(plaintext.toString('utf8')) as T;
}
