/**
 * SEC-05: Auth0 shared client instance.
 * Used by middleware and server components for session management.
 */
import { Auth0Client } from '@auth0/nextjs-auth0/server';

export const auth0 = new Auth0Client();
