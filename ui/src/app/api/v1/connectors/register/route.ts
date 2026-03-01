// Plural-path alias for the connector registration endpoint.
// The CLI tries /connectors/register (plural) first to match the naming
// convention of all other connector routes (/connectors/heartbeat, etc.).
//
// NOTE: Inline import + delegation instead of bare re-export
//   export { POST } from '@/app/api/v1/connector/register/route';
// because Next.js re-exports across route files can silently fail in
// Vercel production builds, producing a 405 (route file exists but no
// handler for the requested HTTP method).
import { POST as handler } from '@/app/api/v1/connector/register/route';

export const POST = handler;
