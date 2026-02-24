<#
.SYNOPSIS
    OPS-001: Health check script for 0ctx services.

.DESCRIPTION
    Polls BFF and control-plane health endpoints. Sends webhook alerts on failure.
    Exit code 1 if any critical check fails.

.PARAMETER BffUrl
    Base URL of the BFF (default: http://localhost:3000).

.PARAMETER CpUrl
    Base URL of the control-plane (default: http://localhost:8787).

.PARAMETER WebhookUrl
    Optional webhook URL for alert notifications. Falls back to CTX_ALERT_WEBHOOK_URL env var.

.PARAMETER TimeoutSec
    HTTP request timeout in seconds (default: 5).
#>
param(
    [string]$BffUrl = "http://localhost:3000",
    [string]$CpUrl = "http://localhost:8787",
    [string]$WebhookUrl = $env:CTX_ALERT_WEBHOOK_URL,
    [int]$TimeoutSec = 5
)

$ErrorActionPreference = "Continue"
$failed = $false

function Send-Alert {
    param(
        [string]$Severity,
        [string]$Service,
        [string]$Alert,
        [string]$Message
    )

    $payload = @{
        severity  = $Severity
        service   = $Service
        alert     = $Alert
        message   = $Message
        timestamp = (Get-Date -Format "o")
        details   = @{}
    } | ConvertTo-Json -Depth 3

    Write-Host "[$Severity] $Service — $Message"

    if ($WebhookUrl) {
        try {
            Invoke-RestMethod -Uri $WebhookUrl -Method POST -Body $payload `
                -ContentType "application/json" -TimeoutSec $TimeoutSec | Out-Null
            Write-Host "  Alert sent to webhook."
        } catch {
            Write-Host "  WARNING: Failed to send webhook alert: $_"
        }
    }
}

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Url
    )

    try {
        $response = Invoke-RestMethod -Uri $Url -Method GET -TimeoutSec $TimeoutSec
        if ($response.status -eq "ok") {
            Write-Host "[OK] $Name — status=ok"
            return $true
        } else {
            Send-Alert -Severity "warning" -Service $Name -Alert "status_degraded" `
                -Message "$Name returned status=$($response.status)"
            return $false
        }
    } catch {
        Send-Alert -Severity "critical" -Service $Name -Alert "service_unreachable" `
            -Message "$Name health check failed: $_"
        return $false
    }
}

Write-Host "0ctx Health Check — $(Get-Date -Format 'o')"
Write-Host "BFF:            $BffUrl"
Write-Host "Control-Plane:  $CpUrl"
Write-Host ""

# Check control-plane
if (-not (Test-Endpoint -Name "control-plane" -Url "$CpUrl/v1/health")) {
    $failed = $true
}

# Check BFF
if (-not (Test-Endpoint -Name "bff" -Url "$BffUrl/api/v1/health")) {
    $failed = $true
}

Write-Host ""
if ($failed) {
    Write-Host "RESULT: One or more checks FAILED."
    exit 1
} else {
    Write-Host "RESULT: All checks passed."
    exit 0
}
