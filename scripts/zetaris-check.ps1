# POST the three live templates. Prints "<template> <mode> <rowCount>".
# Does not run Docker Compose. A worktree checkout is safe for this script.
$ErrorActionPreference = "Continue"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dryRun = $false
$gateway = "http://localhost:8081"

for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        "--dry-run" { $dryRun = $true }
        "--gateway" {
            if ($i + 1 -ge $args.Count) {
                Write-Error "Missing value for --gateway"
                exit 2
            }
            $i++
            $gateway = $args[$i]
        }
        default {
            Write-Error "Unknown argument: $($args[$i])"
            exit 2
        }
    }
}

$gateway = $gateway.TrimEnd("/")
if (-not (Test-Path (Join-Path $root "docker-compose.yml"))) {
    Write-Error "Repo root does not contain docker-compose.yml: $root"
    exit 2
}
$fail = 0

function Invoke-Template {
    param([string]$Name, [string]$Body)
    if ($dryRun) {
        Write-Output "curl -sS --max-time 60 -X POST $gateway/query -H content-type:application/json --data $Body"
        return
    }
    $tmp = New-TemporaryFile
    try {
        $bodyFile = New-TemporaryFile
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllText($bodyFile.FullName, $Body, $utf8)
        try {
            $code = & curl.exe -sS --max-time 60 -o $tmp.FullName -w "%{http_code}" -X POST "$gateway/query" `
                -H "content-type: application/json" --data-binary "@$($bodyFile.FullName)"
        } finally {
            Remove-Item $bodyFile.FullName -ErrorAction SilentlyContinue
        }
        $code = "$code".Trim()
        if ($code -ne "200") {
            Write-Output "$Name error $code"
            $script:fail = 1
            return
        }
        $raw = [IO.File]::ReadAllText($tmp.FullName)
        $doc = $raw | ConvertFrom-Json
        $mode = [string]$doc.receipt.mode
        $count = $doc.receipt.rowCount
        Write-Output "$Name $mode $count"
        if ($mode -ne "live") {
            $script:fail = 1
        }
    } finally {
        Remove-Item $tmp.FullName -ErrorAction SilentlyContinue
    }
}

Invoke-Template "directory_batch" '{"templateId":"directory_batch","params":{"batch":"A","limit":5},"runId":"zetaris-check","requestedBy":"lane1"}'
Invoke-Template "roster_by_npis" '{"templateId":"roster_by_npis","params":{"npis":["8000000009"]},"runId":"zetaris-check","requestedBy":"lane1"}'
Invoke-Template "claims_by_npis" '{"templateId":"claims_by_npis","params":{"npis":["8000000009"],"fromMonth":"2025-05","toMonth":"2025-06"},"runId":"zetaris-check","requestedBy":"lane1"}'

if ($dryRun) {
    exit 0
}
exit $fail
