param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$Remote = "origin"
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

function Normalize-Tag {
    param([string]$Value)

    $trimmed = $Value.Trim()
    if (-not $trimmed) {
        throw "Version cannot be empty."
    }

    if ($trimmed.StartsWith("v")) {
        return $trimmed
    }

    return "v$trimmed"
}

$repoRoot = Get-RepoRoot
Push-Location $repoRoot

try {
    $tag = Normalize-Tag -Value $Version
    $head = (git rev-parse --short HEAD).Trim()
    $branch = (git rev-parse --abbrev-ref HEAD).Trim()
    $status = (@(git status --porcelain) -join "`n").Trim()
    $localTagMatch = (@(git tag --list $tag) -join "`n").Trim()
    $localTagExists = -not [string]::IsNullOrWhiteSpace($localTagMatch)

    $remoteTagExists = $false
    try {
        $remoteTagMatch = (@(git ls-remote --tags $Remote "refs/tags/$tag") -join "`n").Trim()
        $remoteTagExists = -not [string]::IsNullOrWhiteSpace($remoteTagMatch)
    } catch {
        Write-Warning "Remote tag lookup failed for '$Remote': $($_.Exception.Message)"
    }

    $changelogHasSection = $false
    if (Test-Path -LiteralPath "CHANGELOG.md") {
        $pattern = "^## \[$([regex]::Escape($tag))\](\s+-\s+\d{4}-\d{2}-\d{2})?\s*$"
        foreach ($line in (Get-Content -LiteralPath "CHANGELOG.md")) {
            if ($line -match $pattern) {
                $changelogHasSection = $true
                break
            }
        }
    }

    Write-Output "Release tag dry-run preview"
    Write-Output "Repository root: $repoRoot"
    Write-Output "Branch: $branch"
    Write-Output "HEAD: $head"
    Write-Output "Tag candidate: $tag"
    Write-Output "Working tree clean: $([string]::IsNullOrWhiteSpace($status))"
    Write-Output "Local tag exists: $localTagExists"
    Write-Output "Remote tag exists ($Remote): $remoteTagExists"
    Write-Output "CHANGELOG section present: $changelogHasSection"
    Write-Output ""
    Write-Output "Planned commands:"
    Write-Output "git tag -a $tag -m `"release: $tag`""
    Write-Output "git push $Remote $tag"

    if (-not $branch.StartsWith("release/")) {
        Write-Warning "Current branch does not match 'release/*'."
    }

    if (-not $changelogHasSection) {
        Write-Warning "CHANGELOG.md does not yet contain a section for $tag."
    }

    if ($localTagExists -or $remoteTagExists) {
        throw "Tag $tag already exists locally or on $Remote."
    }
} finally {
    Pop-Location
}
