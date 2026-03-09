import type { DaemonCapabilityCheck as RecallCapabilityCheck } from '../../cli-core/daemon';

export type FlagMap = Record<string, string | boolean>;

export interface RecallCommandDeps {
    parseOptionalStringFlag: (value: string | boolean | undefined) => string | null;
    parsePositiveIntegerFlag: (value: string | boolean | undefined, fallback: number) => number;
    parsePositiveNumberFlag: (value: string | boolean | undefined, fallback: number) => number;
    getContextIdFlag: (flags: FlagMap) => string | null;
    checkDaemonCapabilities: (requiredMethods: string[]) => Promise<RecallCapabilityCheck>;
    printCapabilityMismatch: (commandLabel: string, check: RecallCapabilityCheck) => void;
    sendToDaemon: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
}
