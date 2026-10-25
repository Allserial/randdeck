# Shared fail-closed checks for locally generated release evidence.
function Get-RequiredReleaseGates {
  @('npm-audit', 'i18n-verify', 'privacy-verify', 'icons-verify', 'lint', 'typecheck', 'unit-component', 'playwright', 'vite-build', 'cargo-fmt', 'cargo-test', 'cargo-check-locked', 'release-evidence-tests')
}

function Assert-EvidenceFile([string]$Root, [string]$RelativePath, [string]$Sha256) {
  if (!$RelativePath -or $Sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Evidence path or SHA256 is missing.' }
  $base = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $path = [System.IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
  if (!$path.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Evidence path escapes the repository: $RelativePath" }
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Evidence file does not exist: $RelativePath" }
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $Sha256) { throw "Evidence hash does not match: $RelativePath" }
}

function Assert-ReleaseVerification {
  param([string]$Root, $Verification, [string]$Version, [string]$SourceCommit, [string]$SourceBranch)
  if ($Verification.schema -ne 'zhishutai.verification.v1' -or $Verification.passed -isnot [bool] -or !$Verification.passed) { throw 'Release verification has not passed.' }
  if ($Verification.version -ne $Version -or $Verification.sourceCommit -ne $SourceCommit -or $Verification.sourceBranch -ne $SourceBranch) { throw 'Release verification does not match the current version, commit and branch.' }
  $required = @(Get-RequiredReleaseGates)
  $gates = @($Verification.gates)
  if ($gates.Count -ne $required.Count) { throw 'Release verification is missing the complete gate set.' }
  foreach ($id in $required) {
    $matches = @($gates | Where-Object id -eq $id)
    if ($matches.Count -ne 1) { throw "Gate is missing or duplicated: $id" }
    $gate = $matches[0]
    if ($gate.status -ne 'passed' -or $gate.exitCode -ne 0 -or $null -eq $gate.exitCode) { throw "Gate failed: $id" }
    Assert-EvidenceFile $Root $gate.log $gate.sha256
  }
  $runtime = $Verification.tauriRuntime
  if (!$runtime -or $runtime.status -ne 'passed' -or $runtime.sourceCommit -ne $SourceCommit) { throw 'Matching native runtime verification is required.' }
  Assert-EvidenceFile $Root $runtime.report $runtime.sha256
  $native = Get-Content -Raw -LiteralPath (Join-Path $Root $runtime.report) -Encoding UTF8 | ConvertFrom-Json
  if ($native.passed -isnot [bool] -or !$native.passed -or $native.cleanSource -isnot [bool] -or !$native.cleanSource -or $native.sourceCommit -ne $SourceCommit -or @($native.consoleErrors).Count -ne 0) { throw 'Native runtime report is stale or failed.' }
  Assert-EvidenceFile $Root $native.executablePath $native.executableSha256
}
