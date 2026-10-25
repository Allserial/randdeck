param(
  [string]$Version = "0.7.2"
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'release-evidence.ps1')
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
  @{ id = "unit-component"; command = "npm"; args = @("run", "test", "--", "--no-cache", "--configLoader", "native", "--maxWorkers=1"); cwd = $root },
  @{ id = "vite-build"; command = "npm"; args = @("run", "build"); cwd = $root },
  @{ id = "playwright"; command = "npm"; args = @("run", "test:e2e:offline"); cwd = $root },
  @{ id = "cargo-fmt"; command = "cargo"; args = @("fmt", "--check"); cwd = (Join-Path $root "src-tauri") },
  @{ id = "cargo-test"; command = "cargo"; args = @("test"); cwd = (Join-Path $root "src-tauri") },
  @{ id = "cargo-check-locked"; command = "cargo"; args = @("check", "--locked"); cwd = (Join-Path $root "src-tauri") },
  @{ id = "release-evidence-tests"; command = "node"; args = @("scripts/release-evidence.test.mjs"); cwd = $root },
  @{ id = "dependency-license-tests"; command = "node"; args = @("--test", "scripts/dependency-licenses.test.mjs"); cwd = $root }
)

$results = @()
foreach ($gate in $gates) {
  $started = Get-Date
  $logPath = Join-Path $logDir "$($gate.id).log"
  # Successful tools such as cargo fmt can be silent. Preserve an empty log
  # as real evidence too, rather than omitting its required SHA256 entirely.
  [System.IO.File]::WriteAllText($logPath, '', [System.Text.UTF8Encoding]::new($false))
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
    sha256 = if (Test-Path -LiteralPath $logPath) { (Get-FileHash -LiteralPath $logPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
  }
}

$runtimePath = Join-Path $reportDir "tauri-runtime\$Version\runtime-smoke.json"
$sourceCommit = (& git -C $root rev-parse HEAD 2>$null).Trim()
$sourceBranch = (& git -C $root branch --show-current 2>$null).Trim()
$runtime = if (Test-Path -LiteralPath $runtimePath) {
  try {
    $runtimeReport = Get-Content -Raw -LiteralPath $runtimePath -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    Assert-NativeRuntimeReport -Root $root -Native $runtimeReport -SourceCommit $sourceCommit
    [pscustomobject]@{
      status = "passed"
      report = "reports/tauri-runtime/$Version/runtime-smoke.json"
      sha256 = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
      sourceCommit = $runtimeReport.sourceCommit
      executableSha256 = $runtimeReport.executableSha256
    }
  } catch {
    [pscustomobject]@{ status = "stale-or-failed"; report = "reports/tauri-runtime/$Version/runtime-smoke.json"; sha256 = $null; error = $_.Exception.Message }
  }
} else {
  [pscustomobject]@{ status = "missing"; report = $null; sha256 = $null }
}

$report = [pscustomobject]@{
  schema = "zhishutai.verification.v1"
  version = $Version
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceCommit = $sourceCommit
  sourceBranch = $sourceBranch
  gates = $results
  tauriRuntime = $runtime
  passed = (($results | Where-Object status -ne "passed").Count -eq 0 -and $runtime.status -eq "passed")
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 8
if (!$report.passed) { exit 1 }
try { Assert-ReleaseVerification -Root $root -Verification $report -Version $Version -SourceCommit $sourceCommit -SourceBranch $sourceBranch }
catch { $report.passed = $false; $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8; throw }
