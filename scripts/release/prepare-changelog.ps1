param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$ChangelogPath = "CHANGELOG.md",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

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

function Trim-BlankLines {
    param([string[]]$Lines)

    if (-not $Lines -or $Lines.Count -eq 0) {
        return @()
    }

    $start = 0
    $end = $Lines.Count - 1

    while ($start -le $end -and [string]::IsNullOrWhiteSpace($Lines[$start])) {
        $start++
    }

    while ($end -ge $start -and [string]::IsNullOrWhiteSpace($Lines[$end])) {
        $end--
    }

    if ($start -gt $end) {
        return @()
    }

    return $Lines[$start..$end]
}

function Get-UnreleasedTemplate {
    return @(
        "## [Unreleased]",
        "",
        "### Platform (Core/Daemon/MCP)",
        "- _None recorded._",
        "",
        "### Product (CLI/UI)",
        "- _None recorded._",
        "",
        "### Governance & Release",
        "- _None recorded._",
        "",
        "### Security & Compliance",
        "- _None recorded._"
    )
}

if (-not (Test-Path -LiteralPath $ChangelogPath)) {
    throw "Changelog not found: $ChangelogPath"
}

$tag = Normalize-Tag -Value $Version
$date = Get-Date -Format "yyyy-MM-dd"
$lines = Get-Content -LiteralPath $ChangelogPath

$releaseHeaderPattern = "^## \[$([regex]::Escape($tag))\](\s+-\s+\d{4}-\d{2}-\d{2})?\s*$"
foreach ($line in $lines) {
    if ($line -match $releaseHeaderPattern) {
        throw "Release section already exists for $tag."
    }
}

$unreleasedIndex = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^## \[Unreleased\]\s*$") {
        $unreleasedIndex = $i
        break
    }
}

if ($unreleasedIndex -lt 0) {
    throw "Could not find '## [Unreleased]' in $ChangelogPath"
}

$nextSectionIndex = $lines.Count
for ($i = $unreleasedIndex + 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^## \[[^\]]+\]") {
        $nextSectionIndex = $i
        break
    }
}

$unreleasedBody = @()
if ($nextSectionIndex -gt ($unreleasedIndex + 1)) {
    $unreleasedBody = $lines[($unreleasedIndex + 1)..($nextSectionIndex - 1)]
}
$unreleasedBody = Trim-BlankLines -Lines $unreleasedBody

$updated = @()
if ($unreleasedIndex -gt 0) {
    $updated += $lines[0..($unreleasedIndex - 1)]
}

$updated += Get-UnreleasedTemplate
$updated += ""
$updated += "## [$tag] - $date"
$updated += ""

if ($unreleasedBody.Count -eq 0) {
    $updated += "### Notes"
    $updated += "- _No release notes were captured._"
} else {
    $updated += $unreleasedBody
}

if ($nextSectionIndex -lt $lines.Count) {
    $updated += ""
    $updated += $lines[$nextSectionIndex..($lines.Count - 1)]
}

if ($DryRun) {
    Write-Output "Dry run: changelog would be updated for $tag ($date)."
    Write-Output "Changelog path: $ChangelogPath"
    exit 0
}

Set-Content -LiteralPath $ChangelogPath -Value $updated -Encoding utf8
Write-Output "Updated $ChangelogPath with release section for $tag ($date)."
