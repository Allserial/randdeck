# Shared fail-closed checks for locally generated release evidence.
function Get-RequiredReleaseGates {
  @('npm-audit', 'i18n-verify', 'privacy-verify', 'icons-verify', 'lint', 'typecheck', 'unit-component', 'playwright', 'vite-build', 'cargo-fmt', 'cargo-test', 'cargo-check-locked', 'release-evidence-tests', 'dependency-license-tests')
}

# Keep this list explicit: a report cannot choose which native checks count as a
# release. The contract test also compares it with the real smoke runner.
function Get-RequiredNativeRuntimeChecks {
  @('ui-generation', 'first-overlay-and-result-handshake', 'repeat-open-preserves-click-through', 'live-native-window-modes-and-drag-handle', 'localized-native-window-titles', 'display-particle-settings-and-canvas-clear', 'native-dense-dice-result-geometry', 'single-instance', 'native-close-during-slow-save', 'native-main-close-closes-display')
}

function Assert-EvidenceFile([string]$Root, [string]$RelativePath, [string]$Sha256) {
  if (!$RelativePath -or $Sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Evidence path or SHA256 is missing.' }
  $base = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $path = [System.IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
  if (!$path.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Evidence path escapes the repository: $RelativePath" }
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Evidence file does not exist: $RelativePath" }
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $Sha256) { throw "Evidence hash does not match: $RelativePath" }
}

function Get-ProtectedDesktopSessionPath([string]$Version) {
  if ($Version -cnotmatch '^\d+\.\d+\.\d+$') { throw 'A release version is required for protected desktop evidence.' }
  return "reports/tauri-runtime/$Version/protected-desktop-session.json"
}

function ConvertTo-EvidenceTimestamp($Value) {
  # PS 7 materializes JSON dates as DateTime; preserve Kind and fractions instead
  # of round-tripping them through the current culture's display format.
  if ($Value -is [DateTimeOffset]) { return $Value }
  if ($Value -is [DateTime] -and $Value.Kind -ne [DateTimeKind]::Unspecified) { return [DateTimeOffset]$Value }
  if ($Value -is [string] -and $Value -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$') {
    return [DateTimeOffset]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None)
  }
  throw 'Desktop evidence timestamps must include an explicit time zone.'
}

function Assert-LatestProtectedDesktopSession {
  param([string]$Root, $Native, [string]$Version)
  $path = Join-Path $Root (Get-ProtectedDesktopSessionPath $Version)
  $latest = Get-Content -LiteralPath $path -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ($latest -isnot [pscustomobject] -or $latest.schema -isnot [string] -or $latest.schema -cne 'zhishutai.protected-desktop-session.v1') { throw 'Latest protected desktop session schema is missing or unsupported.' }
  if ($latest.status -isnot [string] -or $latest.status -cne 'passed' -or $latest.error) { throw 'Latest protected desktop attempt is pending or failed.' }
  if ($latest.version -isnot [string] -or $latest.version -cne $Version) { throw 'Latest protected desktop session version does not match.' }
  foreach ($property in @('sessionId', 'sourceCommit', 'executablePath', 'executableSha256')) {
    if ($latest.$property -isnot [string] -or $latest.$property -cne $Native.$property) { throw "Native report does not belong to the latest protected session: $property" }
  }
  foreach ($property in @('savedStateMatched', 'reopenedStateMatched', 'stateRestored', 'applicationClosed', 'reopened', 'passed')) {
    if ($latest.$property -isnot [bool] -or !$latest.$property) { throw "Latest protected desktop session did not pass: $property" }
  }
  foreach ($value in @($latest.processId, $Native.processId)) {
    if (($value -isnot [int] -and $value -isnot [long]) -or $value -le 0) { throw 'Protected desktop process ID must be a positive integer.' }
  }
  if ($latest.processId -ne $Native.processId) { throw 'Native report process does not match the latest protected session.' }
  $started = ConvertTo-EvidenceTimestamp $latest.startedAt
  $completed = ConvertTo-EvidenceTimestamp $latest.completedAt
  $generated = ConvertTo-EvidenceTimestamp $Native.generatedAt
  if ($generated -lt $started -or $generated -gt $completed) { throw 'Native report was not recorded during the latest completed protected session.' }
}

function Assert-NativeRuntimeReport {
  param([string]$Root, $Native, [string]$SourceCommit, [string]$Version)
  if ($Native -isnot [pscustomobject] -or $Native.schema -isnot [string] -or $Native.schema -cne 'zhishutai.tauri-runtime-smoke.v1') { throw 'Native runtime report schema is missing or unsupported.' }
  if ($Native.passed -isnot [bool] -or !$Native.passed -or $Native.cleanSource -isnot [bool] -or !$Native.cleanSource) { throw 'Native runtime report is failed or was recorded from dirty source.' }
  if ($SourceCommit -cnotmatch '^[0-9a-f]{40}$' -or $Native.sourceCommit -isnot [string] -or $Native.sourceCommit -cne $SourceCommit) { throw 'Native runtime report does not match the current source commit.' }
  if ($Native.sessionId -isnot [string] -or $Native.sessionId -cnotmatch '^[0-9a-f]{32}$') { throw 'Native runtime report is missing a valid protected session identifier.' }
  # The UI/IPC runner finishes before its caller verifies disk, reopens the EXE
  # and restores user state. Only that completed protected session can authorize
  # a release; an otherwise passing intermediate runtime report is insufficient.
  if ($Native.protectedSession -isnot [pscustomobject]) { throw 'Native runtime report is missing its completed protected session.' }
  foreach ($property in @('savedStateMatched', 'reopenedStateMatched', 'stateRestored', 'applicationClosed', 'reopened', 'passed')) {
    $value = $Native.protectedSession.$property
    if ($value -isnot [bool] -or !$value) { throw "Native protected session did not pass: $property" }
  }
  foreach ($property in @('consoleErrors', 'ipcErrors')) {
    # Missing, null, scalar strings and objects must not masquerade as an empty
    # collection. Both properties are arrays in the versioned runner schema.
    $value = $Native.$property
    if ($value -isnot [System.Array] -or $value.Count -ne 0) { throw "Native runtime $property must be an empty array." }
  }
  $required = @(Get-RequiredNativeRuntimeChecks)
  if ($Native.checks -isnot [System.Array] -or $Native.checks.Count -ne $required.Count) { throw 'Native runtime report is missing the complete check set.' }
  foreach ($id in $required) {
    $matches = @($Native.checks | Where-Object { $_ -is [pscustomobject] -and $_.id -is [string] -and $_.id -ceq $id })
    if ($matches.Count -ne 1) { throw "Native runtime check is missing or duplicated: $id" }
    if ($matches[0].status -isnot [string] -or $matches[0].status -cne 'passed' -or $matches[0].error) { throw "Native runtime check failed: $id" }
  }
  # The publisher packages this exact build output. Evidence for some other
  # executable in the repository must never authorize packaging untested bytes.
  if ($Native.executablePath -isnot [string] -or $Native.executablePath.Replace('\', '/') -cne 'src-tauri/target/release/randdeck.exe') { throw 'Native runtime report does not identify the release executable.' }
  if ($Native.executableSha256 -isnot [string]) { throw 'Native executable SHA256 must be a string.' }
  Assert-EvidenceFile $Root $Native.executablePath $Native.executableSha256
  Assert-LatestProtectedDesktopSession -Root $Root -Native $Native -Version $Version
}

function Assert-ReleaseVerification {
  param([string]$Root, $Verification, [string]$Version, [string]$SourceCommit, [string]$SourceBranch)
  if ($Verification.schema -isnot [string] -or $Verification.schema -cne 'zhishutai.verification.v1' -or $Verification.passed -isnot [bool] -or !$Verification.passed) { throw 'Release verification has not passed.' }
  if ($Verification.version -isnot [string] -or $Verification.version -cne $Version -or $Verification.sourceCommit -isnot [string] -or $Verification.sourceCommit -cne $SourceCommit -or $Verification.sourceBranch -isnot [string] -or $Verification.sourceBranch -cne $SourceBranch) { throw 'Release verification does not match the current version, commit and branch.' }
  $required = @(Get-RequiredReleaseGates)
  $gates = $Verification.gates
  if ($gates -isnot [System.Array] -or $gates.Count -ne $required.Count) { throw 'Release verification is missing the complete gate set.' }
  foreach ($id in $required) {
    $matches = @($gates | Where-Object { $_.id -is [string] -and $_.id -ceq $id })
    if ($matches.Count -ne 1) { throw "Gate is missing or duplicated: $id" }
    $gate = $matches[0]
    if ($gate.status -isnot [string] -or $gate.status -cne 'passed' -or ($gate.exitCode -isnot [int] -and $gate.exitCode -isnot [long]) -or $gate.exitCode -ne 0) { throw "Gate failed: $id" }
    Assert-EvidenceFile $Root $gate.log $gate.sha256
  }
  $runtime = $Verification.tauriRuntime
  if (!$runtime -or $runtime.status -isnot [string] -or $runtime.status -cne 'passed' -or $runtime.sourceCommit -isnot [string] -or $runtime.sourceCommit -cne $SourceCommit) { throw 'Matching native runtime verification is required.' }
  Assert-EvidenceFile $Root $runtime.report $runtime.sha256
  $protectedPath = Get-ProtectedDesktopSessionPath $Version
  if ($runtime.protectedSession -isnot [pscustomobject] -or $runtime.protectedSession.report -isnot [string] -or $runtime.protectedSession.report -cne $protectedPath -or $runtime.protectedSession.sha256 -isnot [string]) { throw 'Release verification must bind the latest protected desktop session.' }
  Assert-EvidenceFile $Root $protectedPath $runtime.protectedSession.sha256
  $native = Get-Content -Raw -LiteralPath (Join-Path $Root $runtime.report) -Encoding UTF8 | ConvertFrom-Json
  Assert-NativeRuntimeReport -Root $Root -Native $native -SourceCommit $SourceCommit -Version $Version
  if ($runtime.executableSha256 -isnot [string] -or $runtime.executableSha256 -ne $native.executableSha256) { throw 'Native runtime executable metadata does not match its hashed report.' }
}
