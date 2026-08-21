param(
  [string]$Version = "0.6.0"
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$reportDir = Join-Path $root "reports"
$logDir = Join-Path $reportDir "gates"
$reportPath = Join-Path $reportDir "v$Version-verification.json"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$gates = @(
  @{ id = "npm-audit"; command = "npm"; args = @("audit", "--audit-level=low"); cwd = $root },
  @{ id = "i18n-verify"; command = "npm"; args = @("run", "i18n:verify"); cwd = $root },
  @{ id = "privacy-verify"; command = "npm"; args = @("run", "privacy:verify"); cwd = $root },
  @{ id = "icons-verify"; command = "npm"; args = @("run", "icons:verify"); cwd = $root },
  @{ id = "lint"; command = "npm"; args = @("run", "lint"); cwd = $root },
  @{ id = "typecheck"; command = "npm"; args = @("run", "typecheck"); cwd = $root },
  @{ id = "unit-component"; command = "npm"; args = @("run", "test"); cwd = $root },
  @{ id = "playwright"; command = "npm"; args = @("run", "test:e2e"); cwd = $root },
  @{ id = "vite-build"; command = "npm"; args = @("run", "build"); cwd = $root },
  @{ id = "cargo-fmt"; command = "cargo"; args = @("fmt", "--check"); cwd = (Join-Path $root "src-tauri") },
  @{ id = "cargo-test"; command = "cargo"; args = @("test"); cwd = (Join-Path $root "src-tauri") },
  @{ id = "cargo-check-locked"; command = "cargo"; args = @("check", "--locked"); cwd = (Join-Path $root "src-tauri") }
)

$results = @()
foreach ($gate in $gates) {
  $started = Get-Date
  $logPath = Join-Path $logDir "$($gate.id).log"
  Push-Location $gate.cwd
  try {
    & $gate.command @($gate.args) 2>&1 | Tee-Object -FilePath $logPath
    $exitCode = $LASTEXITCODE
  } catch {
    $_ | Out-String | Tee-Object -FilePath $logPath -Append
    $exitCode = 1
  } finally {
    Pop-Location
  }
  $results += [pscustomobject]@{
    id = $gate.id
    status = if ($exitCode -eq 0) { "passed" } else { "failed" }
    exitCode = $exitCode
    durationSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 3)
    log = "reports/gates/$($gate.id).log"
  }
}

$runtimePath = Join-Path $reportDir "tauri-runtime\runtime-smoke.json"
$sourceCommit = (& git -C $root rev-parse HEAD 2>$null).Trim()
$runtime = if (Test-Path -LiteralPath $runtimePath) {
  $runtimeReport = Get-Content -Raw -LiteralPath $runtimePath | ConvertFrom-Json
  $runtimeHash = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $runtimePassed = $runtimeReport.sourceCommit -eq $sourceCommit -and $runtimeReport.cleanSource -eq $true -and @($runtimeReport.consoleErrors).Count -eq 0
  [pscustomobject]@{
    status = if ($runtimePassed) { "passed" } else { "stale-or-failed" }
    report = "reports/tauri-runtime/runtime-smoke.json"
    sha256 = $runtimeHash
    sourceCommit = $runtimeReport.sourceCommit
    debugExecutableSha256 = $runtimeReport.debugExecutableSha256
  }
} else {
  [pscustomobject]@{ status = "missing"; report = $null; sha256 = $null }
}

$report = [pscustomobject]@{
  schema = "zhishutai.verification.v1"
  version = $Version
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceCommit = $sourceCommit
  gates = $results
  tauriRuntime = $runtime
  passed = (($results | Where-Object status -ne "passed").Count -eq 0 -and $runtime.status -eq "passed")
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 8
if (!$report.passed) { exit 1 }
