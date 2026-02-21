$ErrorActionPreference = "Stop"

$home = [Environment]::GetFolderPath("UserProfile")
$appData = [Environment]::GetFolderPath("ApplicationData")

$targets = @(
    @{ Client = "claude"; Path = Join-Path $appData "Claude\claude_desktop_config.json" },
    @{ Client = "cursor"; Path = Join-Path $home ".cursor\mcp.json" },
    @{ Client = "windsurf"; Path = Join-Path $appData "Windsurf\User\mcp.json" }
)

foreach ($target in $targets) {
    if (-not (Test-Path $target.Path)) {
        Write-Output "$($target.Client): missing ($($target.Path))"
        continue
    }

    try {
        $json = Get-Content -Raw $target.Path | ConvertFrom-Json
        $server = $json.mcpServers.'0ctx'
        if ($null -eq $server) {
            Write-Output "$($target.Client): config found but mcpServers.0ctx missing"
            continue
        }

        $command = $server.command
        $args = @($server.args) -join " "
        Write-Output "$($target.Client): ok"
        Write-Output "  path: $($target.Path)"
        Write-Output "  command: $command"
        Write-Output "  args: $args"
    } catch {
        Write-Output "$($target.Client): invalid JSON or unreadable file ($($target.Path))"
    }
}
