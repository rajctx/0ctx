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
        [switch]$DryRun
    )

    Write-Output ""
    Write-Output "==> $Name"
    if ($DryRun) {
        Write-Output "[dry-run] $Command"
        return
    }

    Write-Output "[run] $Command"
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
        "docs/RELEASE.md",
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
        @{ Name = "Typecheck"; Command = "npm run typecheck" },
        @{ Name = "Build"; Command = "npm run build" },
        @{ Name = "Test"; Command = "npm run test" },
        @{ Name = "GA agent e2e"; Command = "npm run release:e2e:ga" },
        @{ Name = "Desktop smoke"; Command = "npm run desktop:smoke" },
        @{ Name = "Nested git check"; Command = "npm run repo:check-nested-git" }
    )

    foreach ($step in $steps) {
        Invoke-CheckedCommand -Name $step.Name -Command $step.Command -DryRun:$DryRun
    }

    Write-Output ""
    Write-Output "Release validation completed successfully."
} finally {
    Pop-Location
}
