param([string]$Version = '0.7.2', [int]$Port = 9222)
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$executable = Join-Path $root 'src-tauri\target\release\randdeck.exe'
if (!(Test-Path -LiteralPath $executable)) { throw 'Build the release executable before desktop verification.' }
if (@(Get-Process randdeck,zhishutai -ErrorAction SilentlyContinue).Count) { throw 'An existing RandDeck process is running; no application data was changed.' }
$appData = [System.IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.zhishutai.desktop'))
$output = Join-Path $root "reports\tauri-runtime\$Version"
$sessionId = [guid]::NewGuid().ToString('N')
$sessionStartedAt = [DateTimeOffset]::UtcNow
$session = Join-Path $output ('protected-session-' + $sessionId)
$backup = Join-Path $session 'original-app-data'
New-Item -ItemType Directory -Path $session -Force | Out-Null
$existed = Test-Path -LiteralPath $appData
$before = @{}
if ($existed) {
  Copy-Item -LiteralPath $appData -Destination $backup -Recurse
  foreach ($file in Get-ChildItem -LiteralPath $appData -File -Recurse -Force) {
    $before[$file.FullName.Substring($appData.Length + 1)] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  }
}
$previousEnvironment = @{}
foreach ($name in @('WEBVIEW2_USER_DATA_FOLDER','WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','TAURI_CDP_URL','TAURI_EXECUTABLE','TAURI_RUNTIME_REPORT_DIR','TAURI_PROCESS_ID','TAURI_STATE_FILE','TAURI_RUNTIME_SESSION_ID')) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$application = $null
$reopened = $null
$report = [ordered]@{ version=$Version; sessionId=$sessionId; baselineBackup=$backup; baselineHashes=$before; stateFileCount=$before.Count; applicationClosed=$false; savedStateMatched=$false; reopened=$false; reopenedStateMatched=$false; stateRestored=$false; restoredHashes=$null; passed=$false; error=$null }
$sourceCommit = (& git -C $root rev-parse HEAD).Trim()
$executableSha256 = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
try {
  # Use fresh disposable application state, independent of the user's draw pool.
  # The complete baseline remains in the persistent backup and is restored below.
  if ($existed) {
    foreach ($name in $before.Keys) {
      if ((Get-FileHash -LiteralPath (Join-Path $backup $name) -Algorithm SHA256).Hash -ne $before[$name]) { throw 'Application data backup hash mismatch.' }
    }
    $expected = [System.IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.zhishutai.desktop'))
    if ($appData -ne $expected -or (Get-Item -LiteralPath $appData).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Unsafe application data path.' }
    Remove-Item -LiteralPath $appData -Recurse -Force
  }
  $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $session 'webview-profile'
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port --remote-debugging-address=127.0.0.1 --no-first-run"
  $env:TAURI_CDP_URL = "http://127.0.0.1:$Port"
  $env:TAURI_EXECUTABLE = $executable
  $env:TAURI_RUNTIME_REPORT_DIR = $output
  $env:TAURI_STATE_FILE = Join-Path $appData 'state-v5.json'
  $env:TAURI_RUNTIME_SESSION_ID = $sessionId
  $application = Start-Process -FilePath $executable -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $env:TAURI_PROCESS_ID = [string]$application.Id
  $ready = $false
  $deadline = (Get-Date).AddSeconds(35)
  while ((Get-Date) -lt $deadline) {
    if ($application.HasExited) { throw 'Application exited before WebView2 was ready.' }
    try { Invoke-RestMethod -Uri "$env:TAURI_CDP_URL/json/version" -NoProxy -TimeoutSec 1 | Out-Null; $ready=$true; break } catch { Start-Sleep -Milliseconds 250 }
  }
  if (!$ready) { throw 'The isolated WebView2 debugging endpoint did not become ready.' }
  Push-Location $root
  try { & node (Join-Path $PSScriptRoot 'tauri-runtime-smoke.mjs'); if ($LASTEXITCODE -ne 0) { throw 'Native runtime regression failed.' } }
  finally { Pop-Location }
  $report.applicationClosed = $application.WaitForExit(12000)
  if (!$report.applicationClosed) { throw 'Closing the main window left an application process running.' }
  # Inspect the real native current snapshot before initialization on a fresh
  # process intentionally normalizes the startup view and current-result pointer.
  & node (Join-Path $PSScriptRoot 'tauri-runtime-smoke.mjs') --verify-saved-state
  if ($LASTEXITCODE -ne 0) { throw 'The real native close lost or changed the accepted persistent state.' }
  $report.savedStateMatched = $true
  # A fresh process must create a responsive main window after the close test.
  $reopened = Start-Process -FilePath $executable -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds(25)
  do { Start-Sleep -Milliseconds 250; $reopened.Refresh() } while (!$reopened.HasExited -and !$reopened.MainWindowHandle -and (Get-Date) -lt $deadline)
  $report.reopened = !$reopened.HasExited -and $reopened.MainWindowHandle -ne 0 -and $reopened.Responding
  if (!$report.reopened) { throw 'The main window could not be opened after a complete close.' }
  $env:TAURI_PROCESS_ID = [string]$reopened.Id
  $ready = $false
  $deadline = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $deadline) {
    if ($reopened.HasExited) { throw 'The reopened application exited before its persisted state could be verified.' }
    try { Invoke-RestMethod -Uri "$env:TAURI_CDP_URL/json/version" -NoProxy -TimeoutSec 1 | Out-Null; $ready=$true; break } catch { Start-Sleep -Milliseconds 250 }
  }
  if (!$ready) { throw 'The reopened WebView2 debugging endpoint did not become ready.' }
  & node (Join-Path $PSScriptRoot 'tauri-runtime-smoke.mjs') --verify-reopen
  if ($LASTEXITCODE -ne 0) { throw 'The reopened real application did not hydrate the saved state.' }
  $report.reopenedStateMatched = $true
} catch { $report.error = $_.Exception.Message }
finally {
  foreach ($process in @($reopened, $application)) {
    if ($process -and !$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $process.WaitForExit() }
  }
  foreach ($name in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
  # Restore only this application's exact directory after its owned processes stop.
  # Keep the backup even on success so the restore remains independently recoverable.
  try {
    $expected = [System.IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.zhishutai.desktop'))
    if ($appData -ne $expected -or [System.IO.Path]::GetFileName($appData) -ne 'com.zhishutai.desktop') { throw 'Application data restore path mismatch.' }
    if (@(Get-Process randdeck,zhishutai -ErrorAction SilentlyContinue).Count) { throw 'Another application instance appeared; restore paused to avoid overwriting concurrent changes.' }
    if (Test-Path -LiteralPath $appData) { Remove-Item -LiteralPath $appData -Recurse -Force }
    if ($existed) { Copy-Item -LiteralPath $backup -Destination $appData -Recurse }
    $after = @{}
    if (Test-Path -LiteralPath $appData) {
      foreach ($file in Get-ChildItem -LiteralPath $appData -File -Recurse -Force) { $after[$file.FullName.Substring($appData.Length + 1)] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
    }
    $report.stateRestored = $before.Count -eq $after.Count
    foreach ($name in $before.Keys) { if (!$after.ContainsKey($name) -or $after[$name] -ne $before[$name]) { $report.stateRestored=$false } }
    $report.restoredHashes=$after
    if (!$existed -and (Test-Path -LiteralPath $appData)) { $report.stateRestored=$false }
    if (!$report.stateRestored) { throw 'Restored application state hashes do not match the baseline.' }
  } catch { $report.error = @($report.error, $_.Exception.Message | Where-Object { $_ }) -join '; ' }
  $report.passed = !$report.error -and $report.applicationClosed -and $report.savedStateMatched -and $report.reopened -and $report.reopenedStateMatched -and $report.stateRestored
  # Seal only this exact process/session's real report. A report from a previous
  # attempt must never be rewritten when this attempt failed before recording one.
  # Conversely, a later saved-state/reopen/restore failure must invalidate the
  # otherwise completed runtime checks rather than leave reusable passed evidence.
  try {
    $nativePath = Join-Path $output 'runtime-smoke.json'
    if ($application -and (Test-Path -LiteralPath $nativePath -PathType Leaf)) {
      $nativeReport = Get-Content -LiteralPath $nativePath -Raw -Encoding UTF8 | ConvertFrom-Json
      # PS 7 materializes JSON timestamps as DateTime. Parsing that object again
      # first formats it in the current culture, losing Kind and fractional
      # seconds; cast typed timestamps directly to preserve their real instant.
      $generatedAtValue = $nativeReport.generatedAt
      if ($generatedAtValue -is [DateTimeOffset]) { $nativeGeneratedAt = $generatedAtValue }
      elseif ($generatedAtValue -is [DateTime] -and $generatedAtValue.Kind -ne [DateTimeKind]::Unspecified) { $nativeGeneratedAt = [DateTimeOffset]$generatedAtValue }
      elseif ($generatedAtValue -is [string] -and $generatedAtValue -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$') {
        $nativeGeneratedAt = [DateTimeOffset]::Parse($generatedAtValue, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None)
      } else { throw 'Native report generatedAt must be a timestamp with an explicit time zone.' }
      $belongsToSession = $nativeReport.sessionId -is [string] -and $nativeReport.sessionId -ceq $sessionId `
        -and $nativeReport.sourceCommit -ceq $sourceCommit -and $nativeReport.executableSha256 -ceq $executableSha256 `
        -and $nativeReport.processId -eq $application.Id `
        -and $nativeGeneratedAt -ge $sessionStartedAt
      if ($belongsToSession) {
        $seal = [pscustomobject]@{ savedStateMatched=[bool]$report.savedStateMatched; reopenedStateMatched=[bool]$report.reopenedStateMatched;
          stateRestored=[bool]$report.stateRestored; applicationClosed=[bool]$report.applicationClosed;
          reopened=[bool]$report.reopened; passed=[bool]$report.passed }
        $nativeReport | Add-Member -NotePropertyName protectedSession -NotePropertyValue $seal -Force
        if (!$report.passed) { $nativeReport.passed = $false }
        $nativeReport | ConvertTo-Json -Depth 60 | Set-Content -LiteralPath $nativePath -Encoding utf8
      } elseif ($report.passed) { throw 'No matching native report was recorded for this exact protected session.' }
    } elseif ($report.passed) { throw 'The current protected session did not record a native runtime report.' }
  } catch {
    $report.error = @($report.error, $_.Exception.Message | Where-Object { $_ }) -join '; '
    $report.passed = $false
  }
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'protected-desktop-session.json') -Encoding utf8
}
$report | ConvertTo-Json -Depth 6
if (!$report.passed) { exit 1 }
