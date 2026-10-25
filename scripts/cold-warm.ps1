# Cold batch A, simulated analyst, warm batch B. Optional cold batch B control.
# Does not start or restart the agents server. Memory stays in that process.
# Does not run Docker Compose. A worktree checkout is safe for this script.
$ErrorActionPreference = "Continue"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dryRun = $false
$withControl = $false
$agentsUrl = "http://localhost:8080"
$outDir = ""
$timeoutMin = "45"
$max = "30"

for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        "--dry-run" { $dryRun = $true }
        "--with-control" { $withControl = $true }
        "--agents-url" {
            if ($i + 1 -ge $args.Count) { Write-Error "Missing value for --agents-url"; exit 2 }
            $i++
            $agentsUrl = $args[$i]
        }
        "--out-dir" {
            if ($i + 1 -ge $args.Count) { Write-Error "Missing value for --out-dir"; exit 2 }
            $i++
            $outDir = $args[$i]
        }
        "--timeout-min" {
            if ($i + 1 -ge $args.Count) { Write-Error "Missing value for --timeout-min"; exit 2 }
            $i++
            $timeoutMin = $args[$i]
        }
        "--max" {
            if ($i + 1 -ge $args.Count) { Write-Error "Missing value for --max"; exit 2 }
            $i++
            $max = $args[$i]
        }
        default {
            Write-Error "Unknown argument: $($args[$i])"
            exit 2
        }
    }
}

if ($timeoutMin -notmatch '^\d+$' -or [int]$timeoutMin -lt 1) {
    Write-Error "Expected --timeout-min to be a positive integer"
    exit 2
}
if ($max -notmatch '^\d+$' -or [int]$max -lt 1) {
    Write-Error "Expected --max to be a positive integer"
    exit 2
}

$agentsUrl = $agentsUrl.TrimEnd("/")
if (-not $outDir) {
    $outDir = Join-Path $root "eval\runs"
} elseif (-not [IO.Path]::IsPathRooted($outDir)) {
    $outDir = Join-Path $root $outDir
}
if (-not (Test-Path (Join-Path $root "docker-compose.yml"))) {
    Write-Error "Repo root does not contain docker-compose.yml: $root"
    exit 2
}

$evalRun = Join-Path $root "scripts\eval-run.ps1"
$analyst = Join-Path $root "eval\simulate_analyst.py"
$score = Join-Path $root "eval\score.py"
$script:lastDiff = ""

function Invoke-EvalRun {
    param([string]$Batch, [string]$Memory, [int]$Offset, [int]$Limit)
    $evalArgs = @(
        "--batch", $Batch,
        "--memory", $Memory,
        "--offset", "$Offset",
        "--limit", "$Limit",
        "--agents-url", $agentsUrl,
        "--timeout-min", "$timeoutMin",
        "--out-dir", $outDir
    )
    if ($dryRun) {
        & powershell.exe -NoProfile -File $evalRun --dry-run @evalArgs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        return
    }
    $output = & powershell.exe -NoProfile -File $evalRun @evalArgs
    $code = $LASTEXITCODE
    foreach ($line in @($output)) { Write-Output "$line" }
    if ($code -ne 0) { exit $code }
    $runId = $null
    foreach ($line in @($output)) {
        $text = "$line".Trim()
        if ($text -match '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') {
            $runId = $text
            break
        }
    }
    if (-not $runId) {
        Write-Error "eval-run did not print a runId"
        exit 1
    }
    $runId8 = $runId.Substring(0, 8)
    $script:lastRunId = $runId
    $script:lastDiff = Join-Path (Join-Path $outDir "$Batch-$Memory-$runId8") "diff.csv"
    if (-not (Test-Path $script:lastDiff)) {
        Write-Error "Missing diff $($script:lastDiff)"
        exit 1
    }
}

function Write-Score {
    param([string]$ColdDiff, [string]$WarmDiff, [string]$OutName)
    $out = Join-Path $root "eval\reports\$OutName"
    Write-Output "py -3 $score --diff $ColdDiff --diff $WarmDiff --touched-only --out $out"
    if ($dryRun) { return }
    & py -3 $score --diff $ColdDiff --diff $WarmDiff --touched-only --out $out
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$coldDiff = Join-Path $outDir "A-off-<runId8>\diff.csv"
$warmDiff = Join-Path $outDir "B-on-<runId8>\diff.csv"
$controlDiff = Join-Path $outDir "B-off-<runId8>\diff.csv"

Invoke-EvalRun "A" "off" 0 30
if ($dryRun) {
    Write-Output "py -3 $analyst --run-id <runId> --agents-url $agentsUrl --max $max --dry-run"
} else {
    $coldDiff = $script:lastDiff
    & py -3 $analyst --run-id $script:lastRunId --agents-url $agentsUrl --max $max
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Invoke-EvalRun "B" "on" 160 30
if (-not $dryRun) { $warmDiff = $script:lastDiff }

if ($withControl) {
    Invoke-EvalRun "B" "off" 160 30
    if (-not $dryRun) { $controlDiff = $script:lastDiff }
}

Write-Score $coldDiff $warmDiff "cold_vs_warm.md"
if ($withControl) {
    Write-Score $controlDiff $warmDiff "batch_b_control.md"
}
exit 0
