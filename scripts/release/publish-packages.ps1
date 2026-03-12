param(
    [switch]$DryRun,
    [string]$OTP,
    [string]$Tag = "latest",
    [switch]$AllowDirty,
    [switch]$AllowVersionDrift
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
    param(
        [string]$RepoRoot,
        [switch]$AllowVersionDrift
    )

    $packages = @("core", "daemon", "mcp", "cli")
    $versions = @{}

    foreach ($pkg in $packages) {
        $path = Join-Path $RepoRoot "packages/$pkg/package.json"
        $versions[$pkg] = Get-PackageVersion -PackageJsonPath $path
    }
    $versions["desktop"] = Get-PackageVersion -PackageJsonPath (Join-Path $RepoRoot "desktop-app/package.json")
    $tauriConfig = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot "desktop-app/src-tauri/tauri.conf.json") | ConvertFrom-Json
    $versions["tauri"] = $tauriConfig.version

    $unique = @($versions.Values | Sort-Object -Unique)
    if ($unique.Count -gt 1) {
        $message = "Release surface versions are not consistent:"
        Write-Error $message
        foreach ($kv in $versions.GetEnumerator()) {
            Write-Error "  $($kv.Key): $($kv.Value)"
        }
        if (-not $AllowVersionDrift) {
            throw "Version alignment failed. Re-run with -AllowVersionDrift only if you intentionally need to bypass the release gate."
        }
        Write-Warning "Proceeding because -AllowVersionDrift was set."
    } else {
        Write-Output "Version: $($unique[0]) (all release surfaces consistent)"
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
    Assert-VersionsConsistent -RepoRoot $repoRoot -AllowVersionDrift:$AllowVersionDrift

    # --- Deterministic publish order (single package) ---
    $publishOrder = @(
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
