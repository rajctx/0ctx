param(
    [switch]$DryRun,
    [string]$OTP,
    [string]$Tag = "latest",
    [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Get-RepoRoot {
    try {
        return (git rev-parse --show-toplevel).Trim()
    } catch {
        throw "Not inside a git repository."
    }
}

function Get-PackageVersion {
    param([string]$PackageJsonPath)
    $content = Get-Content -Raw -LiteralPath $PackageJsonPath | ConvertFrom-Json
    return $content.version
}

function Assert-VersionsConsistent {
    param([string]$RepoRoot)

    $packages = @("core", "daemon", "mcp", "cli")
    $versions = @{}

    foreach ($pkg in $packages) {
        $path = Join-Path $RepoRoot "packages/$pkg/package.json"
        $versions[$pkg] = Get-PackageVersion -PackageJsonPath $path
    }

    $unique = @($versions.Values | Sort-Object -Unique)
    if ($unique.Count -gt 1) {
        Write-Warning "Package versions are not consistent:"
        foreach ($kv in $versions.GetEnumerator()) {
            Write-Warning "  @0ctx/$($kv.Key): $($kv.Value)"
        }
        Write-Warning "Proceeding anyway. Consider aligning versions before publishing."
    } else {
        Write-Output "Version: $($unique[0]) (all packages consistent)"
    }
}

function Publish-Package {
    param(
        [string]$Workspace,
        [switch]$DryRun,
        [string]$OTP,
        [string]$Tag
    )

    if ($DryRun) {
        Write-Output ""
        Write-Output "==> [dry-run] $Workspace"
        Write-Output "    Would run: npm publish --workspace=$Workspace --access=public --tag=$Tag$(if ($OTP) { " --otp=<OTP>" })"
        $packArgs = @("pack", "--workspace=$Workspace", "--dry-run")
        & npm @packArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Pack dry-run failed for $Workspace (exit $LASTEXITCODE)"
        }
        return
    }

    Write-Output ""
    Write-Output "==> Publishing $Workspace"
    $publishArgs = @("publish", "--workspace=$Workspace", "--access=public", "--tag=$Tag")
    if ($OTP) {
        $publishArgs += "--otp=$OTP"
    }
    & npm @publishArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Publish failed for $Workspace (exit $LASTEXITCODE)"
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

$repoRoot = Get-RepoRoot
Push-Location $repoRoot

try {
    $mode = if ($DryRun) { "DRY RUN (pack only, no registry writes)" } else { "EXECUTE (publishing to npm registry)" }
    Write-Output "0ctx publish pipeline"
    Write-Output "Mode: $mode"
    Write-Output "Tag: $Tag"
    Write-Output "Repository root: $repoRoot"
    Write-Output ""

    # --- Working tree check ---
    $status = git status --porcelain
    if ($status) {
        if ($AllowDirty) {
            Write-Warning "Working tree is not clean. Continuing because -AllowDirty was set."
        } else {
            throw "Working tree is not clean. Commit or stash changes, or re-run with -AllowDirty."
        }
    } else {
        Write-Output "Working tree: clean"
    }

    # --- Version consistency check ---
    Assert-VersionsConsistent -RepoRoot $repoRoot

    # --- Deterministic publish order (dependency graph order) ---
    $publishOrder = @(
        "@0ctx/core",
        "@0ctx/daemon",
        "@0ctx/mcp",
        "@0ctx/cli"
    )

    foreach ($workspace in $publishOrder) {
        Publish-Package -Workspace $workspace -DryRun:$DryRun -OTP $OTP -Tag $Tag
    }

    Write-Output ""
    if ($DryRun) {
        Write-Output "Dry run complete. No packages were published."
        Write-Output "Re-run without -DryRun (and with -OTP <code> if 2FA is enabled) to publish."
    } else {
        Write-Output "All packages published successfully."
    }
} finally {
    Pop-Location
}
