// Plural-path alias for the connector registration endpoint.
// The CLI tries /connectors/register (plural) first to match the naming
// convention of all other connector routes (/connectors/heartbeat, etc.).
export { POST } from '@/app/api/v1/connector/register/route';
