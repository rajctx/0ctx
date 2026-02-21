import { randomBytes } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptJson, encryptJson } from '../src/encryption';

const originalMasterKey = process.env.CTX_MASTER_KEY;

beforeEach(() => {
    process.env.CTX_MASTER_KEY = randomBytes(32).toString('base64');
});

afterEach(() => {
    if (originalMasterKey === undefined) {
        delete process.env.CTX_MASTER_KEY;
    } else {
        process.env.CTX_MASTER_KEY = originalMasterKey;
    }
});

describe('encryptJson/decryptJson', () => {
    it('round-trips a JSON payload', () => {
        const original = {
            context: 'enterprise-context',
            nodes: [{ id: 'n1', content: 'Sensitive business logic' }]
        };

        const encrypted = encryptJson(original);
        const decrypted = decryptJson<typeof original>(encrypted);

        expect(decrypted).toEqual(original);
        expect(encrypted.ciphertext).not.toContain('Sensitive business logic');
    });
});
