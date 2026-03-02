/**
 * SEC-05: Auth0 shared client instance.
 * Used by middleware and server components for session management.
 */
import { Auth0Client } from '@auth0/nextjs-auth0/server';

export const auth0 = new Auth0Client({
  // Redirect to dashboard after login instead of landing page.
  signInReturnToPath: '/dashboard',

  // Request a JWT access token (not opaque) so server components can
  // decode the custom https://0ctx.com/tenant_id claim from the payload.
  // Without audience Auth0 returns an opaque token that can't be decoded.
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
  },
});
