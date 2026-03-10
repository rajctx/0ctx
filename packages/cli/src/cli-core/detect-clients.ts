import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HookInstallClient, SupportedClient } from './types';

function exists(candidate: string): boolean {
    try {
        return fs.existsSync(candidate);
    } catch {
        return false;
    }
}

function resolveAppData(homeDir: string, appDataDir?: string): string {
    return appDataDir || process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
}

function claudeSignals(platform: NodeJS.Platform, homeDir: string, appDataDir: string): string[] {
    if (platform === 'win32') return [path.join(homeDir, '.claude'), path.join(appDataDir, 'Claude')];
    if (platform === 'darwin') return [path.join(homeDir, '.claude'), path.join(homeDir, 'Library', 'Application Support', 'Claude')];
    return [path.join(homeDir, '.claude'), path.join(homeDir, '.config', 'Claude')];
}

function factorySignals(homeDir: string): string[] {
    return [path.join(homeDir, '.factory')];
}

function antigravitySignals(platform: NodeJS.Platform, homeDir: string, appDataDir: string): string[] {
    if (platform === 'win32') {
        return [path.join(homeDir, '.gemini'), path.join(homeDir, '.antigravity'), path.join(appDataDir, 'Antigravity')];
    }
    if (platform === 'darwin') {
        return [
            path.join(homeDir, '.gemini'),
            path.join(homeDir, '.antigravity'),
            path.join(homeDir, 'Library', 'Application Support', 'Antigravity')
        ];
    }
    return [
        path.join(homeDir, '.gemini'),
        path.join(homeDir, '.antigravity'),
        path.join(homeDir, '.config', 'Antigravity')
    ];
}

export function detectInstalledGaHookClients(options: {
    platform?: NodeJS.Platform;
    homeDir?: string;
    appDataDir?: string;
} = {}): HookInstallClient[] {
    const platform = options.platform || process.platform;
    const homeDir = options.homeDir || os.homedir();
    const appDataDir = resolveAppData(homeDir, options.appDataDir);
    const clients: HookInstallClient[] = [];

    if (claudeSignals(platform, homeDir, appDataDir).some(exists)) clients.push('claude');
    if (factorySignals(homeDir).some(exists)) clients.push('factory');
    if (antigravitySignals(platform, homeDir, appDataDir).some(exists)) clients.push('antigravity');

    return clients;
}

export function detectInstalledGaMcpClients(options: {
    platform?: NodeJS.Platform;
    homeDir?: string;
    appDataDir?: string;
} = {}): SupportedClient[] {
    const platform = options.platform || process.platform;
    const homeDir = options.homeDir || os.homedir();
    const appDataDir = resolveAppData(homeDir, options.appDataDir);
    const clients: SupportedClient[] = [];

    if (claudeSignals(platform, homeDir, appDataDir).some(exists)) clients.push('claude');
    if (antigravitySignals(platform, homeDir, appDataDir).some(exists)) clients.push('antigravity');

    return clients;
}
