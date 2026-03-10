import { BLOCKING_EVENT_TYPES } from './types';
import { normalizeCooldownMs, parseRequiredGates } from './shared';
import type {
    BlackboardEvent,
    CompletionEvaluation,
    EvaluateCompletionParams,
    QualityGate,
    TaskLease
} from './types';

export function evaluateCompletionState(
    params: EvaluateCompletionParams = {},
    eventStream: BlackboardEvent[],
    taskLeases: Iterable<TaskLease>,
    gates: Iterable<QualityGate>
): CompletionEvaluation {
    const now = Date.now();
    const contextId = typeof params.contextId === 'string' && params.contextId.length > 0 ? params.contextId : null;
    const cooldownMs = normalizeCooldownMs(params.cooldownMs);
    const stabilizationWindowStartedAt = now - cooldownMs;
    const requiredGates = parseRequiredGates(params.requiredGates);
    const filteredGates = [...gates].filter((gate) => !contextId || gate.contextId === contextId);

    const openGates = filteredGates
        .filter((gate) => gate.status === 'open')
        .map((gate) => ({
            gateId: gate.gateId,
            severity: gate.severity,
            message: gate.message
        }));

    const unresolvedRequiredGates = requiredGates.filter((gateId) => {
        const gate = filteredGates.find((item) => item.gateId === gateId);
        return !gate || gate.status !== 'resolved';
    });

    const activeLeases = [...taskLeases]
        .filter((lease) => (!contextId || lease.contextId === contextId) && lease.expiresAt > now)
        .map((lease) => ({
            taskId: lease.taskId,
            holder: lease.holder,
            expiresAt: lease.expiresAt
        }));

    const recentBlockingEvents = eventStream
        .filter((event) =>
            (!contextId || event.contextId === contextId)
            && event.timestamp > stabilizationWindowStartedAt
            && BLOCKING_EVENT_TYPES.has(event.type)
        )
        .slice(-100)
        .map((event) => ({
            eventId: event.eventId,
            type: event.type,
            sequence: event.sequence,
            timestamp: event.timestamp
        }));

    const reasons: string[] = [];
    if (openGates.length > 0) reasons.push('open_gates');
    if (unresolvedRequiredGates.length > 0) reasons.push('required_gates_unresolved');
    if (activeLeases.length > 0) reasons.push('active_leases');
    if (recentBlockingEvents.length > 0) reasons.push('stabilization_window_active');

    return {
        contextId,
        complete: reasons.length === 0,
        evaluatedAt: now,
        stabilizationCooldownMs: cooldownMs,
        stabilizationWindowStartedAt,
        openGates,
        unresolvedRequiredGates,
        activeLeases,
        recentBlockingEvents,
        reasons
    };
}
