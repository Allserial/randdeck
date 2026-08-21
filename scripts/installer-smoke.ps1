param(
  [string]$Version = "0.5.0",
  [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (!$InstallerPath) { $InstallerPath = Join-Path $root "releases\$Version\installer\掷数台-离线安装版-setup.exe" }
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$appDataDir = Join-Path $env:APPDATA "com.zhishutai.desktop"
$statePath = Join-Path $appDataDir "state-v5.json"
$legacyStatePath = Join-Path $appDataDir "state-v4.json"
$tempRoot = Join-Path $env:TEMP ("zhishutai-v$($Version.Replace('.', ''))-installer-smoke-" + [guid]::NewGuid().ToString("N"))
$installDir = Join-Path $tempRoot "app"
$backupDir = Join-Path $tempRoot "backup"
$reportPath = Join-Path $root "reports\installer-smoke.json"
New-Item -ItemType Directory -Path $installDir, $backupDir -Force | Out-Null

function Get-UninstallEntries {
  $paths = @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*")
  @(Get-ItemProperty -Path $paths -ErrorAction SilentlyContinue | Where-Object DisplayName -Like "*掷数台*" | ForEach-Object { "$($_.PSPath)|$($_.DisplayVersion)|$($_.InstallLocation)" })
}

function Get-ProductShortcuts {
  $roots = @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs"))
  @(foreach ($shortcutRoot in $roots) { if (Test-Path -LiteralPath $shortcutRoot) { Get-ChildItem -LiteralPath $shortcutRoot -Filter "*掷数台*.lnk" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName } })
}

$sandbox = Test-Path -LiteralPath (Join-Path $env:WINDIR "System32\WindowsSandbox.exe")
$stateExisted = Test-Path -LiteralPath $statePath
$stateHashBefore = if ($stateExisted) { (Get-FileHash -LiteralPath $statePath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
if ($stateExisted) { Copy-Item -LiteralPath $statePath -Destination (Join-Path $backupDir "state-v5.json") }
elseif (Test-Path -LiteralPath $legacyStatePath) { Copy-Item -LiteralPath $legacyStatePath -Destination (Join-Path $backupDir "state-v4.json") }
$uninstallBefore = Get-UninstallEntries
$shortcutsBefore = Get-ProductShortcuts
$process = $null
$uninstaller = $null
$report = [ordered]@{
  schema = "zhishutai.installer-smoke.v1"
  version = $Version
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  mode = if ($sandbox) { "windows-sandbox-available-but-current-user-fallback" } else { "current-user-temporary-directory" }
  windowsSandboxAvailable = $sandbox
  installerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  installExitCode = $null
  installedExecutable = $null
  launched = $false
  windowTitle = $null
  uninstallExitCode = $null
  uninstallEntryAdded = $false
  uninstallEntryRemoved = $false
  newShortcutCount = 0
  shortcutsRemoved = $false
  stateHashBefore = $stateHashBefore
  stateHashAfterRestore = $null
  stateRestored = $false
  temporaryDirectoryRemoved = $false
  passed = $false
  error = $null
}

try {
  $install = Start-Process -FilePath $installer -ArgumentList @("/S", "/D=$installDir") -WindowStyle Hidden -Wait -PassThru
  $report.installExitCode = $install.ExitCode
  if ($install.ExitCode -ne 0) { throw "安装程序退出码为 $($install.ExitCode)" }

  $uninstallAfterInstall = Get-UninstallEntries
  $shortcutsAfterInstall = Get-ProductShortcuts
  $report.uninstallEntryAdded = @($uninstallAfterInstall | Where-Object { $uninstallBefore -notcontains $_ }).Count -gt 0
  $report.newShortcutCount = @($shortcutsAfterInstall | Where-Object { $shortcutsBefore -notcontains $_ }).Count

  $installedExe = Get-ChildItem -LiteralPath $installDir -Filter "*.exe" -File | Where-Object Name -NotLike "uninstall*" | Select-Object -First 1
  if (!$installedExe) { throw "临时安装目录中没有找到应用 EXE" }
  $report.installedExecutable = $installedExe.Name
  $process = Start-Process -FilePath $installedExe.FullName -WorkingDirectory $installDir -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds(20)
  do { Start-Sleep -Milliseconds 250; $process.Refresh() } while (!$process.HasExited -and $process.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline)
  $report.launched = !$process.HasExited -and $process.MainWindowHandle -ne 0 -and $process.Responding
  $report.windowTitle = $process.MainWindowTitle
  if (!$report.launched) { throw "安装后的应用未正常启动" }
  Stop-Process -Id $process.Id -Force
  $process.WaitForExit()
  $process = $null

  $uninstaller = Get-ChildItem -LiteralPath $installDir -Filter "uninstall*.exe" -File | Select-Object -First 1
  if (!$uninstaller) { throw "没有找到卸载程序" }
  $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -WindowStyle Hidden -Wait -PassThru
  $report.uninstallExitCode = $uninstall.ExitCode
  if ($uninstall.ExitCode -ne 0) { throw "卸载程序退出码为 $($uninstall.ExitCode)" }
  Start-Sleep -Seconds 1
  $uninstallAfterRemove = Get-UninstallEntries
  $shortcutsAfterRemove = Get-ProductShortcuts
  $report.uninstallEntryRemoved = @($uninstallAfterInstall | Where-Object { $uninstallBefore -notcontains $_ -and $uninstallAfterRemove -notcontains $_ }).Count -eq @($uninstallAfterInstall | Where-Object { $uninstallBefore -notcontains $_ }).Count
  $report.shortcutsRemoved = @($shortcutsAfterInstall | Where-Object { $shortcutsBefore -notcontains $_ -and $shortcutsAfterRemove -contains $_ }).Count -eq 0
  $report.passed = $report.launched -and $report.uninstallEntryRemoved -and $report.shortcutsRemoved
} catch {
  $report.error = $_.Exception.Message
} finally {
  if ($process -and !$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  if ((Test-Path -LiteralPath $installDir) -and !$report.uninstallExitCode) {
    $fallbackUninstaller = Get-ChildItem -LiteralPath $installDir -Filter "uninstall*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($fallbackUninstaller) { Start-Process -FilePath $fallbackUninstaller.FullName -ArgumentList "/S" -WindowStyle Hidden -Wait | Out-Null }
  }
  if ($stateExisted) {
    New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $backupDir "state-v5.json") -Destination $statePath -Force
    $report.stateHashAfterRestore = (Get-FileHash -LiteralPath $statePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $report.stateRestored = $report.stateHashAfterRestore -eq $stateHashBefore
  } else {
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath -Force }
    $report.stateRestored = !(Test-Path -LiteralPath $statePath)
  }
  $resolvedTemp = (Resolve-Path -LiteralPath $tempRoot).Path
  $resolvedTempBase = (Resolve-Path -LiteralPath $env:TEMP).Path
  if (!$resolvedTemp.StartsWith("$resolvedTempBase\", [System.StringComparison]::OrdinalIgnoreCase)) { throw "临时目录越界：$resolvedTemp" }
  Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  $report.temporaryDirectoryRemoved = !(Test-Path -LiteralPath $resolvedTemp)
  $report.passed = $report.passed -and $report.stateRestored -and $report.temporaryDirectoryRemoved
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
}

$report | ConvertTo-Json -Depth 8
if (!$report.passed) { exit 1 }
