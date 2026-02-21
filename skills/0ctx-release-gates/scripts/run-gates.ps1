$ErrorActionPreference = "Stop"

$commands = @(
    "npm run typecheck",
    "npm run build",
    "npm run test",
    "npm run bootstrap:mcp:dry"
)

$failed = $false

foreach ($command in $commands) {
    Write-Output ""
    Write-Output "=== $command ==="

    try {
        Invoke-Expression $command
        Write-Output "status: pass"
    } catch {
        Write-Output "status: fail"
        Write-Output "error: $($_.Exception.Message)"
        $failed = $true
        break
    }
}

if ($failed) {
    Write-Output ""
    Write-Output "release_recommendation: hold"
    exit 1
}

Write-Output ""
Write-Output "release_recommendation: ship"
exit 0
