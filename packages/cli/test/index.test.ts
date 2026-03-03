import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('@0ctx/cli build artifact source', () => {
    it('includes expected command verbs in CLI source', () => {
        const sourcePath = path.resolve(__dirname, '..', 'src', 'index.ts');
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).toContain("case 'install'");
        expect(source).toContain("case 'bootstrap'");
        expect(source).toContain("case 'doctor'");
        expect(source).toContain("case 'status'");
        expect(source).toContain("case 'repair'");
        expect(source).toContain("case 'shell'");
        expect(source).toContain("case 'release'");
        expect(source).toContain("case 'connector'");
        expect(source).toContain("return commandShell();");
        expect(source).toContain("return commandReleasePublish(parsed.flags);");
        expect(source).toContain("connector register");
        expect(source).toContain("connector verify");
        expect(source).toContain("connector run");
        expect(source).toContain("0ctx shell");
        expect(source).toContain("0ctx release publish --version vX.Y.Z [--tag latest|next] [--otp 123456] [--dry-run] [--json]");
        expect(source).toContain("0ctx setup [--clients=all|claude,cursor,windsurf] [--no-open] [--json]");
        expect(source).toContain("[--skip-service] [--skip-bootstrap]");
        expect(source).toContain("[--dashboard-query[=k=v&...]]");
        expect(source).toContain("0ctx bootstrap [--dry-run] [--clients=...] [--entrypoint=/path/to/mcp-server.js] [--json]");
        expect(source).toContain("0ctx install [--clients=all|claude,cursor,windsurf] [--json] [--skip-bootstrap]");
        expect(source).toContain("0ctx connector service install|enable|disable|uninstall|status|start|stop|restart");
        expect(source).toContain("0ctx connector status [--json] [--cloud] [--require-bridge]");
        expect(source).toContain("0ctx connector verify [--require-cloud] [--json]");
        expect(source).toContain("0ctx connector register [--force] [--local-only] [--require-cloud] [--json]");
        expect(source).toContain("0ctx connector queue status [--json]");
        expect(source).toContain("0ctx sync policy get --context-id=<contextId>");
        expect(source).toContain("0ctx sync policy set <local_only|metadata_only|full_sync> --context-id=<contextId>");
        expect(source).toContain("0ctx connector queue drain [--max-batches=10] [--batch-size=200] [--wait] [--strict|--fail-on-retry] [--timeout-ms=120000] [--poll-ms=1000] [--json]");
        expect(source).toContain("0ctx connector queue logs [--limit=50] [--json] [--clear --confirm|--dry-run]");
        expect(source).toContain("result.status === 'failed'");
        expect(source).toContain("Restart your AI client app so it reloads MCP config changes.");
        expect(source).toContain("ops_log_writable");
        expect(source).toContain("parsed.subcommand === 'service'");
        expect(source).toContain("parsed.subcommand === 'queue'");
    });
});
