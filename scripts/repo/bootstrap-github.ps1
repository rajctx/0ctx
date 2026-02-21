param(
    [string]$Owner,
    [string]$Repo,
    [string]$Branch = "main",
    [switch]$EnableCodeOwnerReviews,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Ensure-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Resolve-OwnerRepoFromGitRemote {
    try {
        $remote = (git remote get-url origin).Trim()
    } catch {
        return $null
    }

    if ($remote -match "github\.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+)(\.git)?$") {
        return @{
            Owner = $Matches.owner
            Repo = $Matches.repo
        }
    }

    return $null
}

function Invoke-OrPrint {
    param([string]$Command)
    if ($DryRun) {
        Write-Output "[dry-run] $Command"
    } else {
        Invoke-Expression $Command
    }
}

Ensure-Command -Name "gh"

if (-not $Owner -or -not $Repo) {
    $resolved = Resolve-OwnerRepoFromGitRemote
    if ($resolved) {
        if (-not $Owner) { $Owner = $resolved.Owner }
        if (-not $Repo) { $Repo = $resolved.Repo }
    }
}

if (-not $Owner -or -not $Repo) {
    throw "Owner/Repo not provided and could not be inferred from git origin. Use -Owner <owner> -Repo <repo>."
}

if (-not $DryRun) {
    gh auth status | Out-Null
}

$labels = @(
    @{ name = "type/feature"; color = "1D76DB"; description = "New feature work" },
    @{ name = "type/bug"; color = "D73A4A"; description = "Bug fix work" },
    @{ name = "type/docs"; color = "0E8A16"; description = "Documentation work" },
    @{ name = "type/chore"; color = "6A737D"; description = "Maintenance task" },
    @{ name = "priority/high"; color = "B60205"; description = "High priority item" },
    @{ name = "priority/medium"; color = "FBCA04"; description = "Medium priority item" },
    @{ name = "priority/low"; color = "0E8A16"; description = "Low priority item" },
    @{ name = "area/core"; color = "5319E7"; description = "Core package changes" },
    @{ name = "area/daemon"; color = "0052CC"; description = "Daemon package changes" },
    @{ name = "area/mcp"; color = "1D76DB"; description = "MCP package changes" },
    @{ name = "area/cli"; color = "0366D6"; description = "CLI package changes" },
    @{ name = "area/ui"; color = "A2EEEF"; description = "UI package changes" },
    @{ name = "status/needs-info"; color = "D4C5F9"; description = "Needs more info" },
    @{ name = "status/in-progress"; color = "0052CC"; description = "Work in progress" },
    @{ name = "status/review"; color = "FBCA04"; description = "Under review" },
    @{ name = "release-blocker"; color = "B60205"; description = "Blocks release" }
)

Write-Output "Bootstrapping labels for $Owner/$Repo..."
foreach ($label in $labels) {
    $name = $label.name
    $color = $label.color
    $description = $label.description
    $cmd = "gh label create `"$name`" --repo `"$Owner/$Repo`" --color `"$color`" --description `"$description`" --force"
    Invoke-OrPrint -Command $cmd
}

$protection = @{
    required_status_checks = @{
        strict = $true
        contexts = @(
            "CI / build-and-test",
            "PR Governance / check-pr-metadata"
        )
    }
    enforce_admins = $true
    required_pull_request_reviews = @{
        dismissal_restrictions = @{}
        dismiss_stale_reviews = $true
        require_code_owner_reviews = [bool]$EnableCodeOwnerReviews
        required_approving_review_count = 1
        bypass_pull_request_allowances = @{
            users = @()
            teams = @()
            apps = @()
        }
    }
    restrictions = $null
    required_linear_history = $true
    allow_force_pushes = $false
    allow_deletions = $false
    block_creations = $false
    required_conversation_resolution = $true
    lock_branch = $false
    allow_fork_syncing = $true
}

$json = $protection | ConvertTo-Json -Depth 20 -Compress
$apiCmd = "gh api --method PUT repos/$Owner/$Repo/branches/$Branch/protection --input -"

Write-Output "Configuring branch protection for $Owner/$Repo`:$Branch..."
if ($DryRun) {
    Write-Output "[dry-run] $apiCmd"
    Write-Output "[dry-run] payload: $json"
} else {
    $json | gh api --method PUT "repos/$Owner/$Repo/branches/$Branch/protection" --input -
}

Write-Output "Done."
