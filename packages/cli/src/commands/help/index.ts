export function printHelp(showAdvanced = false): void {
    if (!showAdvanced) {
        console.log(`0ctx CLI

Usage:
  0ctx                    Auto-enable inside a repo. Outside a repo, show readiness/help.
  0ctx enable [--repo-root=<path>] [--name=<workspace>] [--json]
              [--clients=ga|claude,factory,antigravity] [--mcp-clients=none|ga|claude,antigravity]
              [--skip-bootstrap] [--skip-hooks] [--mcp-profile=core|recall|ops]

Daily use:
  0ctx workstreams [--repo-root=<path>] [--limit=100] [--json]
  0ctx workstreams current [--repo-root=<path>] [--branch=<name>] [--worktree-path=<path>]
                         [--session-limit=3] [--checkpoint-limit=2] [--json]
  0ctx workstreams compare [--repo-root=<path>] --source=<branch> --target=<branch>
                          [--source-worktree-path=<path>] [--target-worktree-path=<path>]
                          [--session-limit=3] [--checkpoint-limit=2] [--json]
  0ctx workspaces compare [--repo-root=<path>|--source-context-id=<id>]
                         (--target-context-id=<id>|--target-repo-root=<path>) [--json]
  0ctx sessions [--repo-root=<path>] [--branch=<name>] [--session-id=<id>] [--worktree-path=<path>] [--limit=100] [--json]
  0ctx checkpoints [list] [--repo-root=<path>] [--branch=<name>] [--worktree-path=<path>] [--limit=100] [--json]
  0ctx checkpoints create [--repo-root=<path>] [--session-id=<id>] [--name="..."] [--summary="..."] [--json]
  0ctx checkpoints show [--repo-root=<path>] [--checkpoint-id=<id>] [--json]
  0ctx insights promote --repo-root=<path> --node-id=<id> --target-context-id=<id>
                        [--branch=<name>] [--worktree-path=<path>] [--json]
  0ctx resume [--repo-root=<path>] [--session-id=<id>] [--json]
  0ctx rewind [--repo-root=<path>] [--checkpoint-id=<id>] [--json]
  0ctx explain [--repo-root=<path>] [--checkpoint-id=<id>] [--json]
  0ctx status [--json] [--compact]
  0ctx shell
  0ctx version [--verbose] [--json]
  0ctx --version | -v

Supported integrations:
  GA: Claude, Factory, Antigravity

Authentication:
  0ctx auth login
  0ctx auth logout
  0ctx auth status [--json]

Need machine management or deeper diagnostics?
  0ctx help --advanced
`);
        return;
    }

    console.log(`0ctx CLI

Usage:
  0ctx                    Auto-enable inside a repo. Outside a repo, show readiness/help.
  0ctx shell
  0ctx version [--verbose] [--json]
  0ctx --version | -v

Recommended daily flow:
  0ctx enable [--repo-root=<path>] [--name=<workspace>] [--json]
              [--clients=ga|claude,factory,antigravity] [--mcp-clients=none|ga|claude,antigravity]
              [--skip-bootstrap] [--skip-hooks] [--mcp-profile=core|recall|ops]

Advanced / machine management:
  0ctx setup [--clients=ga|<explicit-list>] [--no-open] [--json] [--validate]
             [--require-cloud] [--wait-cloud-ready]
             [--cloud-wait-timeout-ms=60000] [--cloud-wait-interval-ms=2000]
             [--create-context=<name>] [--dashboard-query[=k=v&...]]
             [--skip-service] [--skip-bootstrap] [--skip-hooks] [--hooks-dry-run]
             [--mcp-profile=all|core|recall|ops]
  0ctx install [--clients=ga|<explicit-list>] [--json] [--skip-bootstrap] [--mcp-profile=all|core|recall|ops]
  0ctx bootstrap [--dry-run] [--clients=ga|<explicit-list>] [--entrypoint=/path/to/mcp-server.js]
                 [--mcp-profile=all|core|recall|ops] [--json]
  0ctx mcp [bootstrap]
  0ctx mcp                     Interactive MCP bootstrap for GA clients
  0ctx mcp bootstrap [--dry-run] [--clients=ga|<explicit-list>] [--mcp-profile=all|core|recall|ops]
  0ctx doctor [--json] [--clients=...]
  0ctx status [--json] [--compact]
  0ctx repair [--clients=...] [--deep] [--json]
  0ctx reset [--confirm] [--full] [--include-auth] [--json]
  0ctx workstreams [--repo-root=<path>] [--limit=100] [--json]
  0ctx workstreams current [--repo-root=<path>] [--branch=<name>] [--worktree-path=<path>]
                           [--session-limit=3] [--checkpoint-limit=2] [--json]
  0ctx workstreams compare [--repo-root=<path>] --source=<branch> --target=<branch>
                        [--source-worktree-path=<path>] [--target-worktree-path=<path>]
                        [--session-limit=3] [--checkpoint-limit=2] [--json]
  0ctx workspaces compare [--repo-root=<path>|--source-context-id=<id>]
                        (--target-context-id=<id>|--target-repo-root=<path>) [--json]
  0ctx branches [--repo-root=<path>] [--limit=100] [--json]
  0ctx branches compare [--repo-root=<path>] --source=<branch> --target=<branch>
                     [--source-worktree-path=<path>] [--target-worktree-path=<path>]
                     [--session-limit=3] [--checkpoint-limit=2] [--json]
  0ctx sessions [--repo-root=<path>] [--branch=<name>] [--session-id=<id>] [--worktree-path=<path>] [--limit=100] [--json]
  0ctx checkpoints [list] [--repo-root=<path>] [--branch=<name>] [--worktree-path=<path>] [--limit=100] [--json]
  0ctx checkpoints create [--repo-root=<path>] [--session-id=<id>] [--name="..."] [--summary="..."] [--json]
  0ctx checkpoints show [--repo-root=<path>] [--checkpoint-id=<id>] [--json]
  0ctx extract session [--repo-root=<path>] [--session-id=<id>] [--preview] [--keys=key1,key2] [--max-nodes=12] [--json]
  0ctx extract checkpoint [--repo-root=<path>] [--checkpoint-id=<id>] [--preview] [--keys=key1,key2] [--max-nodes=12] [--json]
  0ctx resume [--repo-root=<path>] [--session-id=<id>] [--json]
  0ctx rewind [--repo-root=<path>] [--checkpoint-id=<id>] [--json]
  0ctx explain [--repo-root=<path>] [--checkpoint-id=<id>] [--json]
  0ctx logs [--no-open] [--snapshot] [--limit=50] [--since-hours=N] [--grep=text] [--errors-only]
  0ctx recall [--mode=auto|temporal|topic|graph] [--query="..."] [--since-hours=24] [--limit=10] [--depth=2] [--max-nodes=30] [--start] [--json]
  0ctx recall feedback --node-id=<id> (--helpful|--not-helpful) [--reason="..."] [--context-id=<id>] [--json]
  0ctx recall feedback list|stats [--context-id=<id>] [--node-id=<id>] [--helpful|--not-helpful] [--limit=50] [--json]
  0ctx dashboard [--no-open] [--dashboard-query=k=v&...]
  0ctx release publish --version vX.Y.Z [--tag latest|next] [--otp 123456] [--dry-run] [--json]
  0ctx daemon start

Capture support:
  GA:      claude, factory, antigravity
  Preview: available only by explicit opt-in

Client scope defaults:
  ga      Supported-by-default product path
  Preview integrations must be named explicitly when you opt into them.
  Example: --clients=codex or --clients=cursor,windsurf

Authentication:
  0ctx auth login    Start device-code login flow
  0ctx auth logout   Clear stored credentials
  0ctx auth status   Show current auth state
  0ctx auth status --json

Configuration:
  0ctx config list              Show all settings
  0ctx config get <key>         Get a specific setting
  0ctx config set <key> <value> Set a specific setting
  0ctx data-policy [--repo-root=<path>] [--json]
  0ctx data-policy set [--repo-root=<path>] [--sync-policy=<local_only|metadata_only|full_sync>]
                       [--capture-retention-days=<days>] [--debug-retention-days=<days>]
                       [--debug-artifacts=<on|off>] [--json]

  Config keys: auth.server, sync.enabled, sync.endpoint, ui.url,
               capture.retentionDays, capture.debugRetentionDays, capture.debugArtifacts,
               integration.chatgpt.enabled, integration.chatgpt.requireApproval, integration.autoBootstrap

Sync:
  0ctx sync status   Show sync engine health and queue
  0ctx sync policy get [--repo-root=<path>] [--json]
  0ctx sync policy set <local_only|metadata_only|full_sync> [--repo-root=<path>] [--json]
                    metadata_only is the normal default; full_sync is explicit opt-in

Connector:
  0ctx connector service install|enable|disable|uninstall|status|start|stop|restart
  0ctx connector install|enable|disable|uninstall|status|start|stop|restart
  0ctx connector status [--json] [--cloud] [--require-bridge]
  0ctx connector verify [--require-cloud] [--json]
  0ctx connector register [--force] [--local-only] [--require-cloud] [--json]
  0ctx connector run [--once] [--interval-ms=5000] [--no-daemon-autostart]
  0ctx connector hook install [--clients=ga|<explicit-list>] [--repo-root=<path>] [--global]
  0ctx connector hook status [--json] [--include-preview]
  0ctx connector hook prune [--days=14] [--json]
  0ctx connector hook session-start --agent=claude|factory|antigravity [--repo-root=<path>]
                                     [--input-file=<path>|--payload='<json>'|stdin] [--json]
  0ctx connector hook ingest --agent=claude|windsurf|codex|cursor|factory|antigravity [--repo-root=<path>]
                              [--input-file=<path>|--payload='<json>'|stdin]
  0ctx hook install|status|prune|session-start|ingest  Alias for "0ctx connector hook ..."
  0ctx connector queue status [--json]
  0ctx connector queue drain [--max-batches=10] [--batch-size=200] [--wait] [--strict|--fail-on-retry] [--timeout-ms=120000] [--poll-ms=1000] [--json]
  0ctx connector queue purge [--all|--older-than-hours=N|--min-attempts=N] [--dry-run|--confirm] [--json]
  0ctx connector queue logs [--limit=50] [--json] [--clear --confirm|--dry-run]
  0ctx connector logs [--service|--system] [--no-open] [--snapshot] [--limit=50] [--since-hours=N] [--grep=text] [--errors-only]

Support overrides:
  Use --context-id only for support, debugging, or automation outside a bound repo.

Service management compatibility (requires Admin on Windows):
  Both command paths manage the same underlying OS service.
  Preferred: 0ctx connector service <action>
  Legacy:    0ctx daemon service <action>

Legacy daemon service commands:
  0ctx daemon service install    Register daemon as a service
  0ctx daemon service enable     Set service start type to Automatic
  0ctx daemon service disable    Set service start type to Manual
  0ctx daemon service start      Start the service
  0ctx daemon service stop       Stop the service
  0ctx daemon service restart    Stop then start the service
  0ctx daemon service status     Show current service state
  0ctx daemon service uninstall  Remove service registration

Advanced utilities:
  0ctx agent-context [--repo-root=<path>] [--branch=<name>] [--worktree-path=<path>]
                     [--session-limit=3] [--checkpoint-limit=2] [--handoff-limit=5] [--json]
`);
}
