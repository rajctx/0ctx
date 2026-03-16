import type { AppConfig } from '@0ctx/core';

export type FlagMap = Record<string, string | boolean>;

export interface ReleasePublishResult {
    ok: boolean;
    version: string;
    tag: string;
    dryRun: boolean;
    steps: Array<{ id: string; ok: boolean; exitCode?: number | null }>;
}

export interface MiscCommandDeps {
    CLI_VERSION: string;
    parseOptionalStringFlag: (value: string | boolean | undefined) => string | null;
    runInteractiveShell: (options: { cliEntrypoint: string; nodeExecArgv: string[] }) => Promise<number>;
    resolveCliEntrypoint: () => string;
    runReleasePublish: (options: {
        version: string;
        tag: string;
        dryRun: boolean;
        allowDirty: boolean;
        otp?: string;
        skipValidate: boolean;
        skipChangelog: boolean;
        outputMode: 'capture' | 'inherit';
    }) => Promise<ReleasePublishResult>;
    listConfig: () => Array<{ key: keyof AppConfig; value: unknown; source: 'default' | 'env' | 'config' }>;
    getConfigPath: () => string;
    isValidConfigKey: (key: string) => key is keyof AppConfig;
    getConfigValue: (key: keyof AppConfig) => AppConfig[keyof AppConfig];
    setConfigValue: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}
