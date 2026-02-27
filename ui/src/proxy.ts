/**
 * Auth0 SDK v4 proxy for Next.js 16.
 *
 * Next.js 16 uses proxy.ts (standard Request type) instead of middleware.ts.
 * This file mounts all Auth0 managed routes automatically:
 *   /auth/login        → redirect to Auth0 Universal Login
 *   /auth/callback     → exchange code for tokens, set session cookie
 *   /auth/logout       → clear session, redirect to Auth0 logout
 *   /auth/profile      → return session user as JSON
 *   /auth/access-token → return / refresh access token
 *
 * Dashboard route protection is handled in the dashboard layout server
 * component via auth0.getSession() — the recommended approach per Auth0 docs.
 *
 * The broad matcher is required for rolling sessions to work correctly.
 * Narrowing it will break session refresh on any non-matched request.
 */
import { auth0 } from '@/lib/auth0';

export async function proxy(request: Request): Promise<Response> {
  return auth0.middleware(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
