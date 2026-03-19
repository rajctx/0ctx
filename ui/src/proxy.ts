import { NextResponse } from 'next/server';

/**
 * Legacy route redirects for the public docs surface.
 *
 * Older routes redirect to /install so stale links do not 404.
 */

export async function proxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/')) {
    return Response.redirect(new URL('/install', url), 307);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
