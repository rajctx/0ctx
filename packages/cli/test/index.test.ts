import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

function readCliFile(...segments: string[]): string {
    return readFileSync(path.resolve(__dirname, '..', 'src', ...segments), 'utf8');
}

describe('@0ctx/cli local-only surface', () => {
    it('keeps the documented command surface focused on local workflows', () => {
        const helpSource = readCliFile('commands', 'help', 'index.ts');
        const dispatchSource = readCliFile('entry', 'dispatch.ts');
        const noArgsSource = readCliFile('entry', 'no-args.ts');
        const hookConfigSource = readCliFile('hooks', 'config.ts');
        const serviceSource = readCliFile('service-windows.ts');

        expect(helpSource).toContain('0ctx enable [--repo-root=<path>] [--name=<workspace>] [--data-policy=<lean|review|debug>] [--json]');
        expect(helpSource).toContain('0ctx hook install [--clients=ga|claude,factory,antigravity] [--repo-root=<path>] [--global]');
        expect(helpSource).toContain('0ctx daemon service install    Register daemon as a service');
        expect(helpSource).not.toContain('0ctx sync status');
        expect(helpSource).not.toContain('0ctx connector register');
        expect(helpSource).not.toContain('0ctx data-policy shared');

        expect(dispatchSource).toContain("case 'hook': return deps.commandConnectorHook(parsed.positionalArgs[0], parsed.flags);");
        expect(dispatchSource).toContain('`0ctx sync` has been removed from the local-only product surface.');
        expect(dispatchSource).toContain('`0ctx connector` is no longer part of the normal local product surface.');
        expect(dispatchSource).toContain('Use `0ctx hook ...` for capture hooks, `0ctx daemon service ...` for service management, and `0ctx logs` for runtime diagnostics.');
        expect(dispatchSource).toContain('Use `0ctx enable` inside a repo for the normal local product flow.');

        expect(noArgsSource).toContain("reason: 'repo_entrypoint'");

        expect(hookConfigSource).toContain("return `${cliCommand} hook ingest --quiet --agent=codex --payload`;");
        expect(hookConfigSource).toContain("return `${cliCommand} hook session-start --agent=${agent}`;");

        expect(serviceSource).toContain('<name>0ctx Local Runtime</name>');
        expect(serviceSource).toContain('<arguments>"%DAEMON_ENTRY%"</arguments>');
    });
});
