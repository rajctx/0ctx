import {
  cpExecCommand,
  errorResponse,
  jsonResponse,
  requireSession,
  resolveMachineId
} from '@/lib/bff';

export async function GET() {
  const [token, authErr] = await requireSession();
  if (authErr) return authErr;

  const machineId = resolveMachineId();

  try {
    const result = await cpExecCommand(token, machineId, 'auditVerify', {});

    if (!result.ok) {
      return errorResponse(502, 'audit_verify_failed', result.error ?? 'Verification failed', true);
    }

    return jsonResponse(result.result);
  } catch (err) {
    return errorResponse(
      502,
      'command_bridge_error',
      err instanceof Error ? err.message : 'Command bridge error',
      true
    );
  }
}
