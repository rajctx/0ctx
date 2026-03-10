import type { ConnectorState } from '../connector.js';
import { isMethodAllowedForCloudCommand } from './helpers.js';
import type { ConnectorRuntimeDependencies } from './types.js';

export async function syncCommandBridge(params: {
    deps: ConnectorRuntimeDependencies;
    registration: ConnectorState;
    accessToken: string;
    daemonSessionToken: string | null;
    lastError: string | null;
}): Promise<{ daemonSessionToken: string | null; lastError: string | null }> {
    const { deps, registration, accessToken } = params;
    let { daemonSessionToken, lastError } = params;

    try {
        if (!daemonSessionToken) {
            throw new Error('daemon_session_unavailable');
        }

        const commandsResult = await deps.fetchConnectorCommands(
            accessToken,
            registration.machineId,
            registration.runtime.lastCommandCursor
        );

        if (!commandsResult.ok) {
            if (commandsResult.statusCode === 404) {
                registration.runtime.commandBridgeSupported = false;
                registration.runtime.commandBridgeError = null;
                return { daemonSessionToken, lastError };
            }
            throw new Error(commandsResult.error ?? 'command_fetch_failed');
        }

        const commands = commandsResult.data?.commands ?? [];
        let cursor = registration.runtime.lastCommandCursor;

        for (const command of commands) {
            cursor = Math.max(cursor, command.cursor ?? cursor);
            const commandContextId =
                command.contextId ??
                (typeof command.params?.contextId === 'string' ? command.params.contextId : null);
            let status: 'applied' | 'failed' = 'applied';
            let errorText: string | undefined;
            let commandResult: unknown;

            if (!isMethodAllowedForCloudCommand(command.method)) {
                status = 'failed';
                errorText = 'command_method_not_allowed';
            } else {
                const policy = commandContextId
                    ? await deps.getContextSyncPolicy(daemonSessionToken, commandContextId)
                    : null;

                if (policy === 'local_only') {
                    status = 'failed';
                    errorText = 'command_blocked_by_sync_policy_local_only';
                } else {
                    try {
                        commandResult = await deps.applyDaemonCommand(daemonSessionToken, command.method, command.params ?? {});
                    } catch (error) {
                        status = 'failed';
                        errorText = error instanceof Error ? error.message : String(error);
                    }
                }
            }

            const ackResult = await deps.ackConnectorCommand(accessToken, {
                machineId: registration.machineId,
                tenantId: registration.tenantId,
                commandId: command.commandId,
                cursor: command.cursor,
                status,
                ...(status === 'applied' ? { result: commandResult } : {}),
                ...(errorText ? { error: errorText } : {})
            });

            if (!ackResult.ok) {
                lastError = ackResult.error ?? 'command_ack_failed';
            }
        }

        if (typeof commandsResult.data?.cursor === 'number') {
            cursor = Math.max(cursor, commandsResult.data.cursor);
        }

        registration.runtime.lastCommandCursor = cursor;
        registration.runtime.lastCommandSyncAt = deps.now();
        registration.runtime.commandBridgeError = null;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        registration.runtime.commandBridgeError = message;
        if (message.includes('Invalid sessionToken')) {
            registration.runtime.daemonSessionToken = null;
            daemonSessionToken = null;
        }
        lastError = message;
    }

    return { daemonSessionToken, lastError };
}
