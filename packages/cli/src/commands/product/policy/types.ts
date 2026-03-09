export type FlagMap = Record<string, string | boolean>;

export interface CapabilityCheck {
    ok: boolean;
    reachable: boolean;
    apiVersion: string | null;
    methods: string[];
    missingMethods: string[];
    error: string | null;
    recoverySteps: string[];
}

export interface PolicyCommandDeps {
    requireCommandContextId: (flags: FlagMap, commandLabel: string) => Promise<string | null>;
    resolveCommandContextId: (flags: FlagMap) => Promise<string | null>;
    parseOptionalStringFlag: (value: string | boolean | undefined) => string | null;
    parseOptionalPositiveNumberFlag: (value: string | boolean | undefined) => number | null;
    parseOptionalBooleanLikeFlag: (value: string | boolean | undefined) => boolean | null;
    ensureDaemonCapabilities: (requiredMethods: string[]) => Promise<CapabilityCheck>;
    printCapabilityMismatch: (commandLabel: string, check: CapabilityCheck) => void;
    formatSyncPolicyLabel: (policy: string | null | undefined) => string;
    formatDebugArtifactsLabel: (enabled: boolean) => string;
    printJsonOrValue: (asJson: boolean, value: unknown, human: () => void) => number;
}
