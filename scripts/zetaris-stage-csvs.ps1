# Copy roster.csv and claims.csv into the Zetaris shared folder, then print the five file-store statements.
# Never reads .env and never prints a password.
$ErrorActionPreference = "Continue"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dryRun = $false
$compose = ""
$mainCheckout = "C:\Users\mysti\Projects\ghost-network-auditor"

for ($i = 0; $i -lt $args.Count; $i++) {
    $arg = $args[$i]
    if ($arg -eq "--dry-run") {
        $dryRun = $true
    } elseif ($arg -like "-*") {
        Write-Error "Unknown argument: $arg"
        exit 2
    } elseif ($compose) {
        Write-Error "Unexpected argument: $arg"
        exit 2
    } else {
        $compose = $arg
    }
}

function Test-Worktree {
    param([string]$Path)
    return $Path -match '[\\/]\.cursor[\\/]worktrees([\\/]|$)'
}

if (Test-Worktree $root) {
    if ($dryRun) {
        Write-Output "Dry-run from a Cursor worktree. Docker is not run. Run this script from $mainCheckout to use Docker."
    } else {
        [Console]::Error.WriteLine("Refusing to run Docker from a Cursor worktree ($root).")
        [Console]::Error.WriteLine("Run this script from $mainCheckout so Compose does not start a second project on ports 5432 and 8081.")
        exit 1
    }
}

if (-not $compose) {
    Write-Error "Usage: scripts/zetaris-stage-csvs.ps1 [--dry-run] <zetaris-compose-folder>"
    exit 2
}

function Invoke-Docker {
    param([string[]]$Command)
    $rendered = ($Command | ForEach-Object {
        if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
    }) -join " "
    if ($dryRun) {
        Write-Output $rendered
        return
    }
    $exe = $Command[0]
    $rest = @($Command[1..($Command.Length - 1)])
    & $exe @rest
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

Invoke-Docker @("docker", "compose", "--project-directory", $compose, "exec", "driver", "mkdir", "-p", "/home/zetaris/customer-data/shared")
Invoke-Docker @("docker", "compose", "--project-directory", $compose, "cp", (Join-Path $root "data\sample\roster.csv"), "driver:/home/zetaris/customer-data/shared/roster.csv")
Invoke-Docker @("docker", "compose", "--project-directory", $compose, "cp", (Join-Path $root "data\sample\claims.csv"), "driver:/home/zetaris/customer-data/shared/claims.csv")

Write-Output @'
CREATE LIGHTNING DATABASE GNA_FILES DESCRIBE BY "roster and claims extracts";
CREATE LIGHTNING FILESTORE TABLE roster FROM GNA_FILES FORMAT CSV OPTIONS (PATH "/home/zetaris/customer-data/shared/roster.csv", header "true", inferSchema "false");
CACHE TABLE GNA_FILES.roster;
CREATE LIGHTNING FILESTORE TABLE claims FROM GNA_FILES FORMAT CSV OPTIONS (PATH "/home/zetaris/customer-data/shared/claims.csv", header "true", inferSchema "false");
CACHE TABLE GNA_FILES.claims;
'@
