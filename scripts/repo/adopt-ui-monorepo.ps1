param(
    [switch]$Apply,
    [string]$PackagePath = "packages/ui",
    [string]$BackupDir = ".repo-backups"
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    try {
        return (git rev-parse --show-toplevel).Trim()
    } catch {
        throw "Not inside a git repository."
    }
}

function Write-Plan {
    param(
        [string]$RepoRoot,
        [string]$UiPath,
        [string]$NestedGitPath,
        [string]$BundlePath,
        [string]$HeadPath
    )

    Write-Output "Dry run: no files changed."
    Write-Output "Detected nested git repo: $NestedGitPath"
    Write-Output "Backup bundle path: $BundlePath"
    Write-Output "Backup HEAD path: $HeadPath"
    Write-Output ""
    Write-Output "If you want to apply:"
    Write-Output "1) powershell -ExecutionPolicy Bypass -File scripts/repo/adopt-ui-monorepo.ps1 -Apply"
    Write-Output "2) git add $PackagePath"
    Write-Output '3) git commit -m "chore(repo): adopt packages/ui into monorepo"'
    Write-Output ""
    Write-Output "Rollback after apply:"
    Write-Output "1) Remove-Item -Recurse -Force $UiPath"
    Write-Output "2) git clone $BundlePath $UiPath"
    Write-Output "3) git -C $UiPath checkout (Get-Content $HeadPath)"
}

$repoRoot = Get-RepoRoot
$uiPath = Join-Path $repoRoot $PackagePath
$nestedGitPath = Join-Path $uiPath ".git"

if (-not (Test-Path -LiteralPath $uiPath)) {
    throw "Path not found: $uiPath"
}

if (-not (Test-Path -LiteralPath $nestedGitPath)) {
    Write-Output "No nested git metadata found at $nestedGitPath. Nothing to do."
    exit 0
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $repoRoot $BackupDir
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$bundlePath = Join-Path $backupRoot "ui-history-$timestamp.bundle"
$headPath = Join-Path $backupRoot "ui-head-$timestamp.txt"

$rootStatus = git -C $repoRoot status --porcelain
if ($rootStatus) {
    Write-Warning "Root repository has uncommitted changes."
}

$uiStatus = git -C $uiPath status --porcelain
if ($uiStatus) {
    Write-Warning "Nested UI repository has uncommitted changes."
}

if (-not $Apply) {
    Write-Plan -RepoRoot $repoRoot -UiPath $uiPath -NestedGitPath $nestedGitPath -BundlePath $bundlePath -HeadPath $headPath
    exit 0
}

try {
    $uiHead = (git -C $uiPath rev-parse HEAD).Trim()
    Set-Content -LiteralPath $headPath -Value $uiHead -NoNewline
    git -C $uiPath bundle create $bundlePath --all
} catch {
    throw "Failed to backup nested UI repository history: $($_.Exception.Message)"
}

Remove-Item -Recurse -Force $nestedGitPath

Write-Output "Nested git metadata removed from $nestedGitPath."
Write-Output "Backup bundle created at: $bundlePath"
Write-Output "Backup HEAD saved at: $headPath"
Write-Output ""
Write-Output "Next steps:"
Write-Output "1) git add $PackagePath"
Write-Output "2) git status -- $PackagePath"
Write-Output '3) git commit -m "chore(repo): adopt packages/ui into monorepo"'
