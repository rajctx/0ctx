param(
    [switch]$DryRun,
    [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-RepoRoot {
    try {
        return (git rev-parse --show-toplevel).Trim()
    } catch {
        throw "Not inside a git repository."
    }
}

function Invoke-CheckedCommand {
    param(
        [string]$Name,
        [string]$Command,
        [switch]$DryRun,
        [switch]$SafeInDryRun
    )

    Write-Output ""
    Write-Output "==> $Name"
    if ($DryRun) {
        if (-not $SafeInDryRun) {
            Write-Output "[dry-run] skip mutating command: $Command"
            return
        }

        Write-Output "[dry-run] run safe validation command: $Command"
    } else {
        Write-Output "[run] $Command"
    }
    cmd /c $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command"
    }
}

$repoRoot = Get-RepoRoot
Push-Location $repoRoot

try {
    Write-Output "Release validation mode: $(if ($DryRun) { 'dry-run' } else { 'execute' })"
    Write-Output "Repository root: $repoRoot"

    $requiredPaths = @(
        "CHANGELOG.md",
        "scripts/release/prepare-changelog.ps1",
        "scripts/release/tag-preview.ps1"
    )

    foreach ($path in $requiredPaths) {
        if (-not (Test-Path -LiteralPath $path)) {
            throw "Missing required release file: $path"
        }
    }

    $changelog = Get-Content -Raw -LiteralPath "CHANGELOG.md"
    if ($changelog -notmatch "(?m)^## \[Unreleased\]\s*$") {
        throw "CHANGELOG.md must include a '## [Unreleased]' section."
    }

    $status = git status --porcelain
    if ($status) {
        if ($AllowDirty) {
            Write-Warning "Working tree is not clean. Continuing because -AllowDirty was set."
        } else {
            throw "Working tree is not clean. Commit or stash changes, or re-run with -AllowDirty."
        }
    }

    $steps = @(
        @{ Name = "Release readiness report"; Command = "npm run release:report"; SafeInDryRun = $true }
    )

    foreach ($step in $steps) {
        Invoke-CheckedCommand -Name $step.Name -Command $step.Command -DryRun:$DryRun -SafeInDryRun:$step.SafeInDryRun
    }

    Write-Output ""
    Write-Output "Release validation completed successfully."
} finally {
    Pop-Location
}
