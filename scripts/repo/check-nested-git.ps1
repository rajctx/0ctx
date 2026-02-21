$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    try {
        return (git rev-parse --show-toplevel).Trim()
    } catch {
        throw "Not inside a git repository."
    }
}

$repoRoot = Get-RepoRoot
$rootGit = Join-Path $repoRoot ".git"
$skipDirNames = @(".git", "node_modules", ".next", "dist", "coverage")
$queue = New-Object System.Collections.Generic.Queue[string]
$queue.Enqueue($repoRoot)
$nested = New-Object System.Collections.Generic.List[string]

while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    $children = Get-ChildItem -LiteralPath $current -Directory -Force -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        if ($child.Name -eq ".git") {
            if ($child.FullName -ne $rootGit) {
                $nested.Add($child.FullName)
            }
            continue
        }

        if ($skipDirNames -contains $child.Name) {
            continue
        }

        $queue.Enqueue($child.FullName)
    }
}

if ($nested.Count -eq 0) {
    Write-Output "No nested .git directories found."
    exit 0
}

Write-Output "Nested .git directories detected:"
foreach ($path in $nested) {
    Write-Output "- $path"
}

Write-Output ""
Write-Output "Recommendation:"
Write-Output "1) Keep as monorepo package and remove nested .git."
Write-Output "2) Or convert to submodule/subtree with explicit strategy."
exit 1
