import { describe, expect, it } from 'vitest';
import { checkRateLimit, validateCsrf } from '../src/lib/bff';

// Reset rate limit state between tests by clearing module-level map via re-import
// Since the map is module-scoped, we test cumulative behavior within each test.

describe('Rate limiting (SEC-001)', () => {
    it('allows requests within the limit', () => {
        const ip = `test-ip-${Date.now()}`;
        // Default limit is 300 RPM; test well under that
        for (let i = 0; i < 10; i++) {
            expect(checkRateLimit(ip)).toBe(true);
        }
    });

    it('blocks requests exceeding the limit', () => {
        const ip = `flood-ip-${Date.now()}`;
        // Exhaust the 300 RPM bucket
        for (let i = 0; i < 300; i++) {
            checkRateLimit(ip);
        }
        // Next request should be blocked
        expect(checkRateLimit(ip)).toBe(false);
    });

    it('isolates rate limits per IP', () => {
        const ip1 = `ip1-${Date.now()}`;
        const ip2 = `ip2-${Date.now()}`;
        // Exhaust ip1
        for (let i = 0; i < 300; i++) checkRateLimit(ip1);
        // ip2 should still be allowed
        expect(checkRateLimit(ip2)).toBe(true);
    });
});

describe('CSRF validation (SEC-001)', () => {
    function makeRequest(method: string, headers: Record<string, string> = {}): Request {
        return {
            method,
            headers: {
                get(name: string) {
                    return headers[name.toLowerCase()] ?? null;
                }
            }
        } as unknown as Request;
    }

    it('allows GET requests without Origin/Referer', () => {
        expect(validateCsrf(makeRequest('GET'))).toBe(true);
    });

    it('allows HEAD requests', () => {
        expect(validateCsrf(makeRequest('HEAD'))).toBe(true);
    });

    it('allows OPTIONS requests', () => {
        expect(validateCsrf(makeRequest('OPTIONS'))).toBe(true);
    });

    it('allows POST with matching origin', () => {
        const req = makeRequest('POST', {
            host: 'app.0ctx.com',
            origin: 'https://app.0ctx.com'
        });
        expect(validateCsrf(req)).toBe(true);
    });

    it('rejects POST with mismatched origin', () => {
        const req = makeRequest('POST', {
            host: 'app.0ctx.com',
            origin: 'https://evil.com'
        });
        expect(validateCsrf(req)).toBe(false);
    });

    it('allows POST with matching referer when no origin', () => {
        const req = makeRequest('POST', {
            host: 'app.0ctx.com',
            referer: 'https://app.0ctx.com/dashboard'
        });
        expect(validateCsrf(req)).toBe(true);
    });

    it('rejects POST with mismatched referer', () => {
        const req = makeRequest('POST', {
            host: 'app.0ctx.com',
            referer: 'https://evil.com/attack'
        });
        expect(validateCsrf(req)).toBe(false);
    });

    it('rejects POST with invalid origin URL', () => {
        const req = makeRequest('POST', {
            host: 'app.0ctx.com',
            origin: 'not-a-url'
        });
        expect(validateCsrf(req)).toBe(false);
    });
});
