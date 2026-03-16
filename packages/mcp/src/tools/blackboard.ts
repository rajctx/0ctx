import { defineTool } from './define';

export const blackboardTools = [
    defineTool('ctx_blackboard_subscribe', 'Create a blackboard event subscription for this session. Optionally scope to contextId and event types.', {
        contextId: { type: 'string', description: 'Optional explicit context scope.' },
        types: { type: 'array', items: { type: 'string' }, description: 'Optional event types to include.' },
        afterSequence: { type: 'number', description: 'Optional starting event sequence cursor.' }
    }),
    defineTool('ctx_blackboard_poll', 'Poll events for an existing blackboard subscription.', {
        subscriptionId: { type: 'string', description: 'Subscription ID from ctx_blackboard_subscribe.' },
        afterSequence: { type: 'number', description: 'Optional cursor override.' },
        limit: { type: 'number', description: 'Optional max events (default 100).' }
    }, ['subscriptionId']),
    defineTool('ctx_blackboard_ack', 'Acknowledge blackboard events for a subscription.', {
        subscriptionId: { type: 'string', description: 'Subscription ID to ack against.' },
        eventId: { type: 'string', description: 'Optional event ID to ack.' },
        sequence: { type: 'number', description: 'Optional sequence cursor to ack up to.' }
    }, ['subscriptionId']),
    defineTool('ctx_blackboard_state', 'Inspect blackboard runtime state (recent events, leases, gates).', {
        contextId: { type: 'string', description: 'Optional explicit context scope.' },
        limit: { type: 'number', description: 'Optional max number of recent events.' }
    }),
    defineTool('ctx_blackboard_completion', 'Evaluate whether a context has stabilized for completion (gates, leases, and cooldown window).', {
        contextId: { type: 'string', description: 'Optional explicit context scope.' },
        cooldownMs: { type: 'number', description: 'Optional stabilization cooldown window in milliseconds (default 30000).' },
        requiredGates: { type: 'array', items: { type: 'string' }, description: 'Optional required gate IDs (default: typecheck,test,lint,security).' }
    }),
    defineTool('ctx_task_claim', 'Attempt to claim a blackboard task lease for this session.', {
        taskId: { type: 'string', description: 'Task identifier to claim.' },
        contextId: { type: 'string', description: 'Optional explicit context scope.' },
        leaseMs: { type: 'number', description: 'Optional lease duration in milliseconds.' }
    }, ['taskId']),
    defineTool('ctx_task_release', 'Release a previously claimed blackboard task lease.', {
        taskId: { type: 'string', description: 'Task identifier to release.' }
    }, ['taskId']),
    defineTool('ctx_gate_resolve', 'Resolve or open a blackboard quality gate.', {
        gateId: { type: 'string', description: 'Quality gate identifier.' },
        contextId: { type: 'string', description: 'Optional explicit context scope.' },
        severity: { type: 'string', description: 'Optional severity label.' },
        status: { type: 'string', enum: ['open', 'resolved'], description: 'Gate status update.' },
        message: { type: 'string', description: 'Optional gate update message.' }
    }, ['gateId'])
];
