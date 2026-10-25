# Start one agents run, save the report and diff, and print the touched-only score.
# Does not run Docker Compose. A worktree checkout is safe for this script.
$ErrorActionPreference = "Continue"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dryRun = $false
$batch = ""
$memory = ""
$agentsUrl = "http://localhost:8080"
$outDir = ""
$timeoutMin = "45"

for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        "--dry-run" { $dryRun = $true }
        "--batch" {
            if ($i + 1 -ge $args.Count) { Write-Error "Missing value for --batch"; exit 2 }
            $i++
            $batch = $args[$i]
        }
        "--memory" {
            if ($i + 1 -ge $args.Count) { Write-Error "Missing value for --memory"; exit 2 }
            $i++
            $memory = $args[$i]
        }
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
        default {
            Write-Error "Unknown argument: $($args[$i])"
            exit 2
        }
    }
}

if ($batch -ne "A" -and $batch -ne "B") {
    Write-Error "Expected --batch A or B"
    exit 2
}
if ($memory -ne "on" -and $memory -ne "off") {
    Write-Error "Expected --memory on or off"
    exit 2
}
if ($timeoutMin -notmatch '^\d+$' -or [int]$timeoutMin -lt 1) {
    Write-Error "Expected --timeout-min to be a positive integer"
    exit 2
}
$timeoutMin = [int]$timeoutMin

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

$useMemory = if ($memory -eq "on") { "true" } else { "false" }
$body = "{`"scope`":{`"batch`":`"$batch`"},`"useMemory`":$useMemory}"
$score = Join-Path $root "eval\score.py"

if ($dryRun) {
    Write-Output "curl -sS --max-time 60 -X POST $agentsUrl/runs -H content-type:application/json --data $body"
    Write-Output "curl -sS --max-time 30 $agentsUrl/runs/<runId>/report"
    Write-Output "curl -sS --max-time 60 -o $outDir\$batch-$memory-<runId8>\diff.csv $agentsUrl/runs/<runId>/diff.csv"
    Write-Output "py -3 $score --diff $outDir\$batch-$memory-<runId8>\diff.csv --touched-only"
    exit 0
}

$postFile = New-TemporaryFile
$bodyFile = New-TemporaryFile
$reportFile = New-TemporaryFile
try {
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($bodyFile.FullName, $body, $utf8)
    $code = & curl.exe -sS --max-time 60 -o $postFile.FullName -w "%{http_code}" -X POST "$agentsUrl/runs" `
        -H "content-type: application/json" --data-binary "@$($bodyFile.FullName)"
    if ($LASTEXITCODE -ne 0 -or "$code".Trim() -ne "200") {
        Write-Output "POST /runs error $("$code".Trim())"
        if (Test-Path $postFile.FullName) { Write-Output ([IO.File]::ReadAllText($postFile.FullName)) }
        exit 1
    }
    $started = [IO.File]::ReadAllText($postFile.FullName) | ConvertFrom-Json
    $runId = [string]$started.runId
    if (-not $runId) {
        Write-Error "POST /runs did not return runId"
        exit 1
    }
    Write-Output $runId

    $clock = Get-Date
    $deadline = $clock.AddMinutes($timeoutMin)
    $report = $null
    while ($true) {
        if ((Get-Date) -ge $deadline) {
            Write-Error "timed out after $timeoutMin minutes"
            exit 1
        }
        $elapsed = [int]((Get-Date) - $clock).TotalSeconds
        Write-Output "elapsed ${elapsed}s"
        $code = & curl.exe -sS --max-time 30 -o $reportFile.FullName -w "%{http_code}" "$agentsUrl/runs/$runId/report"
        $code = "$code".Trim()
        if ($LASTEXITCODE -ne 0 -or -not $code) {
            Write-Output "report poll failed"
            Start-Sleep -Seconds 10
            continue
        }
        if ($code -eq "404") {
            Start-Sleep -Seconds 10
            continue
        }
        if ($code -ne "200") {
            Write-Output "report error $code"
            Write-Output ([IO.File]::ReadAllText($reportFile.FullName))
            exit 1
        }
        $report = [IO.File]::ReadAllText($reportFile.FullName) | ConvertFrom-Json
        break
    }

    if ([string]$report.status -eq "failed") {
        $message = [string]$report.error
        if (-not $message) { $message = "run failed" }
        Write-Output $message
        exit 1
    }

    $runId8 = $runId.Substring(0, [Math]::Min(8, $runId.Length))
    $dest = Join-Path $outDir "$batch-$memory-$runId8"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $reportPath = Join-Path $dest "report.json"
    [IO.File]::Copy($reportFile.FullName, $reportPath, $true)
    $diffPath = Join-Path $dest "diff.csv"
    $code = & curl.exe -sS --max-time 60 -o $diffPath -w "%{http_code}" "$agentsUrl/runs/$runId/diff.csv"
    if ($LASTEXITCODE -ne 0 -or "$code".Trim() -ne "200") {
        Write-Output "diff error $("$code".Trim())"
        exit 1
    }
} finally {
    Remove-Item $postFile.FullName -ErrorAction SilentlyContinue
    Remove-Item $bodyFile.FullName -ErrorAction SilentlyContinue
    Remove-Item $reportFile.FullName -ErrorAction SilentlyContinue
}

& py -3 $score --diff $diffPath --touched-only
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
exit 0
