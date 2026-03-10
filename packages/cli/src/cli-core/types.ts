import type { HookSupportedAgent } from '../hooks';

export type { HookSupportedAgent } from '../hooks';

export type SupportedClient = 'claude' | 'cursor' | 'windsurf' | 'codex' | 'antigravity';
export type HookInstallClient = 'claude' | 'cursor' | 'windsurf' | 'codex' | 'factory' | 'antigravity';
export type CheckStatus = 'pass' | 'warn' | 'fail';
export type BootstrapResult = { client: string; status: string; configPath: string; message?: string };

export interface DoctorCheck {
    id: string;
    status: CheckStatus;
    message: string;
    details?: Record<string, unknown>;
}

export interface RepairStep {
    id: string;
    status: CheckStatus;
    code: number;
    message: string;
    details?: Record<string, unknown>;
}

export interface HookHealthAgentCheck {
    agent: HookSupportedAgent;
    configPath: string;
    configExists: boolean;
    commandPresent: boolean;
    sessionStartPresent: boolean;
    command: string | null;
}

export interface HookHealthDetails {
    statePath: string;
    projectRoot: string | null;
    projectRootExists: boolean;
    projectConfigPath: string | null;
    projectConfigExists: boolean;
    contextId: string | null;
    contextIdExists: boolean | null;
    installedAgentCount: number;
    agents: HookHealthAgentCheck[];
}

export interface RepoReadinessSummary {
    repoRoot: string;
    contextId: string | null;
    workspaceName: string | null;
    workstream: string | null;
    sessionCount: number | null;
    checkpointCount: number | null;
    syncPolicy: string | null;
    syncScope: 'workspace';
    captureScope: 'machine';
    debugScope: 'machine';
    captureReadyAgents: HookSupportedAgent[];
    autoContextAgents: HookSupportedAgent[];
    autoContextMissingAgents: HookSupportedAgent[];
    sessionStartMissingAgents: HookSupportedAgent[];
    mcpRegistrationMissingAgents: SupportedClient[];
    captureMissingAgents: HookInstallClient[];
    captureManagedForRepo: boolean;
    zeroTouchReady: boolean;
    nextActionHint: string | null;
    dataPolicyPreset: string | null;
    dataPolicyActionHint: string | null;
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
}

export interface ParsedArgs {
    command: string;
    subcommand?: string;
    serviceAction?: string;
    positionalArgs: string[];
    flags: Record<string, string | boolean>;
}
