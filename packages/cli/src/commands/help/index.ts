export function printHelp(showAdvanced = false): void {
    if (!showAdvanced) {
        console.log(`0ctx CLI

Usage:
  0ctx                    Auto-enable inside a repo. Outside a repo, show readiness/help.
  0ctx enable [--repo-root=<path>] [--name=<workspace>] [--data-policy=<lean|review|debug>] [--json]
              [--clients=ga|claude,factory,antigravity]

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
  0ctx enable [--repo-root=<path>] [--name=<workspace>] [--data-policy=<lean|review|debug>] [--json]
              [--clients=ga|claude,factory,antigravity] [--mcp-clients=none|ga|claude,antigravity]
              [--skip-bootstrap] [--skip-hooks] [--mcp-profile=core|recall|ops]

Advanced / machine management:
  0ctx setup [--clients=ga|claude,factory,antigravity] [--json] [--validate]
             [--create-context=<name>]
             [--skip-service] [--skip-bootstrap] [--skip-hooks] [--hooks-dry-run]
             [--mcp-profile=all|core|recall|ops]
  0ctx install [--clients=ga|claude,factory,antigravity] [--json] [--skip-bootstrap] [--mcp-profile=all|core|recall|ops]
  0ctx bootstrap [--dry-run] [--clients=ga|claude,antigravity] [--entrypoint=/path/to/mcp-server.js]
                 [--mcp-profile=all|core|recall|ops] [--json]
  0ctx mcp [bootstrap]
  0ctx mcp                     Interactive supported-agent retrieval bootstrap
  0ctx mcp bootstrap [--dry-run] [--clients=ga|claude,antigravity] [--mcp-profile=all|core|recall|ops]
  0ctx doctor [--json] [--clients=...]
  0ctx status [--json] [--compact]
  0ctx repair [--clients=...] [--deep] [--json]
  0ctx reset [--confirm] [--full] [--json]
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
  0ctx release publish --version vX.Y.Z [--tag latest|next] [--otp 123456] [--dry-run]
                       [--allow-dirty] [--skip-validate] [--skip-changelog] [--json]
                       Bumps packages/core, daemon, mcp, cli, and desktop-app together,
                       packages desktop release artifacts locally, and publishes @0ctx/cli.
  0ctx daemon start

Capture support:
  GA:                    claude, factory, antigravity
  Explicit opt-in only:  non-GA integrations stay outside the normal enable path

Client scope defaults:
  ga      Supported-by-default product path
  Preview integrations stay outside the normal product path and require explicit advanced opt-in.

Preview overrides:
  Use --allow-preview only when you explicitly name preview integrations such as codex,cursor,windsurf.
  Keep preview installs and preview retrieval out of the normal enable/bootstrap path.

Configuration:
  0ctx config list              Show all settings
  0ctx config get <key>         Get a specific setting
  0ctx config set <key> <value> Set a specific setting
  0ctx data-policy [--repo-root=<path>] [--json]
  0ctx data-policy presets [--json]
  0ctx data-policy cleanup [--repo-root=<path>] [--json]
  0ctx data-policy set [--repo-root=<path>] [--preset=<lean|review|debug>]
                       [--capture-retention-days=<days>] [--debug-retention-days=<days>]
                       [--debug-artifacts=<on|off>] [--json]
  0ctx data-policy <lean|review|debug> [--repo-root=<path>] [--json]

  Config keys: capture.retentionDays, capture.debugRetentionDays, capture.debugArtifacts,
               integration.chatgpt.enabled, integration.chatgpt.requireApproval, integration.autoBootstrap

Support overrides:
  Use --context-id only for support, debugging, or automation outside a bound repo.

Local capture hooks:
  0ctx hook install [--clients=ga|claude,factory,antigravity] [--repo-root=<path>] [--global]
  0ctx hook status [--json] [--include-preview]
  0ctx hook prune [--days=14] [--json]
  0ctx hook session-start --agent=claude|factory|antigravity [--repo-root=<path>]
                          [--input-file=<path>|--payload='<json>'|stdin] [--json]
  0ctx hook ingest --agent=claude|factory|antigravity [--repo-root=<path>]
                   [--input-file=<path>|--payload='<json>'|stdin]

Daemon service commands (requires Admin on Windows):
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
