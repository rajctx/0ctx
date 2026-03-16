import type { AppConfig } from '@0ctx/core';
import type { MiscCommandDeps } from './types';

export function createConfigCommands(deps: MiscCommandDeps) {
    function commandConfigList(): number {
        const entries = deps.listConfig();
        console.log(`\nConfig (${deps.getConfigPath()})\n`);
        for (const entry of entries) {
            const srcTag = entry.source === 'default' ? ' (default)' : entry.source === 'env' ? ' (env)' : '';
            console.log(`  ${entry.key} = ${JSON.stringify(entry.value)}${srcTag}`);
        }
        console.log('');
        return 0;
    }

    function commandConfigGet(key: string | undefined): number {
        if (!key) {
            console.error('Usage: 0ctx config get <key>');
            return 1;
        }
        if (!deps.isValidConfigKey(key)) {
            console.error(`Unknown config key: ${key}`);
            console.error(`Valid keys: ${deps.listConfig().map(e => e.key).join(', ')}`);
            return 1;
        }
        console.log(deps.getConfigValue(key));
        return 0;
    }

    function commandConfigSet(key: string | undefined, value: string | undefined): number {
        if (!key || value === undefined) {
            console.error('Usage: 0ctx config set <key> <value>');
            return 1;
        }
        if (!deps.isValidConfigKey(key)) {
            console.error(`Unknown config key: ${key}`);
            console.error(`Valid keys: ${deps.listConfig().map(e => e.key).join(', ')}`);
            return 1;
        }

        const booleanKeys = new Set<keyof AppConfig>([
            'sync.enabled',
            'capture.debugArtifacts',
            'integration.chatgpt.enabled',
            'integration.chatgpt.requireApproval',
            'integration.autoBootstrap'
        ]);
        const numberKeys = new Set<keyof AppConfig>([
            'capture.retentionDays',
            'capture.debugRetentionDays'
        ]);

        let parsed: unknown = value;
        if (booleanKeys.has(key)) {
            parsed = value === 'true' || value === '1';
        } else if (numberKeys.has(key)) {
            const numeric = Number.parseInt(value, 10);
            if (!Number.isFinite(numeric) || numeric <= 0) {
                console.error(`Invalid value for ${key}: expected a positive integer.`);
                return 1;
            }
            parsed = numeric;
        }

        deps.setConfigValue(key, parsed as AppConfig[typeof key]);
        console.log(`Set ${key} = ${JSON.stringify(parsed)}`);
        return 0;
    }

    return {
        commandConfigList,
        commandConfigGet,
        commandConfigSet
    };
}
