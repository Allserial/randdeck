param(
  [string]$Version = "0.7.3"
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$source = (Resolve-Path -LiteralPath (Join-Path $root "releases\$Version\portable\RandDeck.exe")).Path
$reportPath = Join-Path $root "reports\portable-smoke.json"
$session = Join-Path $root ("reports\tauri-runtime\$Version\protected-portable-session-" + [guid]::NewGuid().ToString("N"))
$backup = Join-Path $session "original-app-data"
$appData = [System.IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath("ApplicationData")) "com.zhishutai.desktop"))
$tempBase = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$tempRoot = Join-Path $tempBase ("zhishutai-portable-smoke-" + [guid]::NewGuid().ToString("N"))
$existed = $false
$before = @{}
$backupVerified = $false
$runs = @()
$processes = @()
$previousEnvironment = @{}
foreach ($name in @("WEBVIEW2_USER_DATA_FOLDER", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}
$report = [ordered]@{
  schema = "zhishutai.portable-smoke.v1"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceFile = "releases\$Version\portable\RandDeck.exe"
  sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  baselineBackup = $backup
  baselineExisted = $existed
  baselineHashes = $before
  stateFileCount = 0
  stateRestored = $false
  restoredHashes = $null
  isolatedWebViewProfiles = $true
  temporaryDirectoryRemoved = $false
  cleanupAttempts = 0
  runs = @()
  passed = $false
  error = $null
}

function Get-DirectoryHashes([string]$Directory) {
  $hashes = @{}
  if (Test-Path -LiteralPath $Directory) {
    foreach ($file in Get-ChildItem -LiteralPath $Directory -File -Recurse -Force) {
      $hashes[$file.FullName.Substring($Directory.TrimEnd('\').Length + 1)] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  return $hashes
}

function Test-EqualHashes([hashtable]$Expected, [hashtable]$Actual) {
  if ($Expected.Count -ne $Actual.Count) { return $false }
  foreach ($name in $Expected.Keys) {
    if (!$Actual.ContainsKey($name) -or $Actual[$name] -ne $Expected[$name]) { return $false }
  }
  return $true
}

function Assert-NoExistingApplication {
  if (@(Get-Process randdeck,zhishutai -ErrorAction SilentlyContinue).Count) {
    throw "An existing RandDeck process is running; application data will not be overwritten."
  }
}

try {
  Assert-NoExistingApplication
  New-Item -ItemType Directory -Path $session -Force | Out-Null
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  $existed = Test-Path -LiteralPath $appData
  $report.baselineExisted = $existed
  $before = Get-DirectoryHashes $appData
  if ($existed) {
    if ((Get-Item -LiteralPath $appData -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Application data is a reparse point; portable verification was not started." }
    Copy-Item -LiteralPath $appData -Destination $backup -Recurse -Force
    if (!(Test-EqualHashes $before (Get-DirectoryHashes $backup))) { throw "Application data backup hashes do not match the baseline." }
  }
  if (!(Test-EqualHashes $before (Get-DirectoryHashes $appData))) { throw "Application data changed during backup; portable verification was not started." }
  $backupVerified = $true
  $report.baselineHashes = $before
  $report.stateFileCount = $before.Count
  [ordered]@{ originalDirectory=$appData; existed=$existed; hashes=$before } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $session "original-app-data-sha256.json") -Encoding UTF8
  foreach ($index in 1..2) {
    $runDir = Join-Path $tempRoot "run-$index"
    New-Item -ItemType Directory -Path $runDir | Out-Null
    $target = Join-Path $runDir "RandDeck.exe"
    Copy-Item -LiteralPath $source -Destination $target
    $onlyExecutable = @(Get-ChildItem -LiteralPath $runDir -File).Count -eq 1
    if (!$onlyExecutable) { throw "The isolated portable directory contains unexpected files." }
    # Each launch gets a separate disposable WebView2 profile. Never reuse the
    # user's profile or inherit a debugging port from another desktop test.
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $tempRoot "webview-profile-$index"
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--no-first-run"
    Assert-NoExistingApplication
    $process = Start-Process -FilePath $target -WorkingDirectory $runDir -WindowStyle Hidden -PassThru
    $processes += $process
    $deadline = (Get-Date).AddSeconds(20)
    do { Start-Sleep -Milliseconds 250; $process.Refresh() } while (!$process.HasExited -and $process.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline)
    $started = !$process.HasExited -and $process.MainWindowHandle -ne 0 -and $process.Responding
    $runs += [pscustomobject]@{ run = $index; isolatedDirectory = "run-$index"; onlyExecutablePresent = $onlyExecutable; started = $started; windowTitle = $process.MainWindowTitle }
    if (!$process.HasExited) {
      Stop-Process -Id $process.Id -Force
      if (!$process.WaitForExit(5000)) { throw "The owned portable process did not exit." }
    }
    if (!$started) { throw "第 $index 次独立启动失败" }
  }
} catch {
  $report.error = $_.Exception.Message
} finally {
  foreach ($process in $processes) {
    try {
      if (!$process.HasExited) {
        Stop-Process -Id $process.Id -Force
        if (!$process.WaitForExit(5000)) { throw "The owned portable process did not exit." }
      }
    } catch { $report.error = @($report.error, $_.Exception.Message | Where-Object { $_ }) -join "; " }
  }
  foreach ($name in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process") }
  if ($backupVerified) {
    try {
      $expected = [System.IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath("ApplicationData")) "com.zhishutai.desktop"))
      if ($appData -ne $expected -or [System.IO.Path]::GetFileName($appData) -ne "com.zhishutai.desktop") { throw "Application data restore path mismatch." }
      Assert-NoExistingApplication
      $current = Get-DirectoryHashes $appData
      if (!(Test-EqualHashes $before $current) -or $existed -ne (Test-Path -LiteralPath $appData)) {
        # Only remove the exact checked application directory. The persistent,
        # independently hashed backup remains available after every outcome.
        if ($existed -and !(Test-EqualHashes $before (Get-DirectoryHashes $backup))) { throw "The persistent backup changed; automatic restore was not attempted." }
        if (Test-Path -LiteralPath $appData) {
          if ((Get-Item -LiteralPath $appData -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Application data became a reparse point; automatic restore was not attempted." }
          Remove-Item -LiteralPath $appData -Recurse -Force
        }
        if ($existed) { Copy-Item -LiteralPath $backup -Destination $appData -Recurse -Force }
      }
      $after = Get-DirectoryHashes $appData
      $report.restoredHashes = $after
      $report.stateRestored = (Test-EqualHashes $before $after) -and $existed -eq (Test-Path -LiteralPath $appData)
      if (!$report.stateRestored) { throw "Restored application data hashes do not match the baseline." }
    } catch { $report.error = @($report.error, $_.Exception.Message | Where-Object { $_ }) -join "; " }
  }
  try {
    if (Test-Path -LiteralPath $tempRoot) {
      $resolved = (Resolve-Path -LiteralPath $tempRoot).Path
      if (!$resolved.StartsWith("$tempBase\", [System.StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetFileName($resolved) -notlike "zhishutai-portable-smoke-*") { throw "临时目录越界：$resolved" }
      # WebView2 may release its profile handles shortly after the owned EXE exits.
      # Retry deletion of this already-validated private directory; never kill
      # unrelated WebView2 processes to obtain a clean test result.
      foreach ($attempt in 1..20) {
        $report.cleanupAttempts = $attempt
        try {
          if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
          break
        } catch {
          if ($attempt -eq 20) { throw }
          Start-Sleep -Milliseconds 500
        }
      }
    }
    $report.temporaryDirectoryRemoved = !(Test-Path -LiteralPath $tempRoot)
  } catch { $report.error = @($report.error, $_.Exception.Message | Where-Object { $_ }) -join "; " }
  $report.runs = $runs
  $report.passed = !$report.error -and $report.stateRestored -and $report.temporaryDirectoryRemoved -and $runs.Count -eq 2 -and @($runs | Where-Object { !$_.started -or !$_.onlyExecutablePresent }).Count -eq 0
  if (Test-Path -LiteralPath (Split-Path -Parent $reportPath)) {
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
  }
  if (Test-Path -LiteralPath $session) {
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $session "protected-portable-session.json") -Encoding UTF8
  }
}
$report | ConvertTo-Json -Depth 6
if (!$report.passed) { exit 1 }
