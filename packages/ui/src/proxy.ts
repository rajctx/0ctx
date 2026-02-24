/**
 * SEC-05: Next.js 16 proxy — Auth0 session gate.
 *
 * Next.js 16 replaces middleware.ts with proxy.ts:
 *   - Export `proxy()` instead of `middleware()`
 *   - Runs on Node.js runtime by default (not Edge)
 *   - Full access to Node APIs
 *
 * This proxy:
 *   - Mounts Auth0 auth routes automatically (/auth/login, /auth/callback, /auth/logout)
 *   - Protects /dashboard/* routes — unauthenticated users redirected to login page
 *   - Landing page (/) and static assets remain public
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { validateCsrf, checkRateLimit } from '@/lib/bff';

export async function proxy(request: NextRequest) {
    // SEC-001: Rate limiting on BFF API routes
    if (request.nextUrl.pathname.startsWith('/api/')) {
        const clientIp =
            request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            request.headers.get('x-real-ip') ||
            '127.0.0.1';
        if (!checkRateLimit(clientIp)) {
            return NextResponse.json(
                { error: 'Too many requests' },
                { status: 429, headers: { 'Retry-After': '60' } }
            );
        }
    }

    // SEC-001: CSRF validation for state-mutating BFF requests
    if (request.nextUrl.pathname.startsWith('/api/')) {
        if (!validateCsrf(request as unknown as Request)) {
            return NextResponse.json(
                { error: 'CSRF validation failed' },
                { status: 403 }
            );
        }
    }

    // Let Auth0 handle its own routes (/auth/login, /auth/callback, etc.)
    const authResponse = await auth0.middleware(request);

    // Protect /dashboard/* routes
    if (request.nextUrl.pathname.startsWith('/dashboard')) {
        const session = await auth0.getSession(request);
        if (!session) {
            // Redirect to Auth0 login
            const loginUrl = new URL('/auth/login', request.url);
            loginUrl.searchParams.set('returnTo', request.nextUrl.pathname);
            return NextResponse.redirect(loginUrl);
        }
    }

    return authResponse;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static (static files)
         * - _next/image (image optimization)
         * - favicon.ico
         * - public assets
         */
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
    ]
};
