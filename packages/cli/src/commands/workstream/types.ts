export type FlagMap = Record<string, string | boolean>;

export interface CommandDeps {
    requireCommandContextId: (flags: FlagMap, commandLabel: string) => Promise<string | null>;
    resolveCommandRepoRoot: (flags: FlagMap) => string;
    parseOptionalStringFlag: (value: string | boolean | undefined) => string | null;
    parsePositiveIntegerFlag: (value: string | boolean | undefined, fallback: number) => number;
    getCurrentWorkstream: (repoRoot: string) => string | null;
    formatSyncPolicyLabel: (policy: string | null | undefined) => string;
}
