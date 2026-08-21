param(
  [string]$Version = "0.6.0",
  [string]$InstallerPath = "",
  [string]$PreviousInstallerPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (!$InstallerPath) {
  $InstallerPath = Join-Path $root "releases\$Version\installer\RandDeck-v$Version-offline-setup.exe"
}
if (!$PreviousInstallerPath) {
  $PreviousInstallerPath = Join-Path $root "releases\0.5.0\installer\掷数台-离线安装版-setup.exe"
}

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$previousInstaller = (Resolve-Path -LiteralPath $PreviousInstallerPath).Path
$appDataDir = [System.IO.Path]::GetFullPath((Join-Path $env:APPDATA "com.zhishutai.desktop"))
$tempRoot = [System.IO.Path]::GetFullPath((Join-Path $env:TEMP ("randdeck-v$($Version.Replace('.', ''))-upgrade-smoke-" + [guid]::NewGuid().ToString("N"))))
$installDir = Join-Path $tempRoot "app"
$backupDir = Join-Path $tempRoot "backup"
$appDataBackup = Join-Path $backupDir "app-data"
$sentinelPath = Join-Path $appDataDir "upgrade-smoke-sentinel.json"
$reportPath = Join-Path $root "reports\installer-smoke.json"
$relatedNamePattern = "^(RandDeck|掷数台|zhishutai)"
$tempBase = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd("\")
$appDataBase = [System.IO.Path]::GetFullPath($env:APPDATA).TrimEnd("\")

if (!$tempRoot.StartsWith("$tempBase\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "临时目录越界：$tempRoot"
}
if (!$appDataDir.StartsWith("$appDataBase\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "应用数据目录越界：$appDataDir"
}

New-Item -ItemType Directory -Path $installDir, $backupDir, (Split-Path -Parent $reportPath) -Force | Out-Null

function Get-UninstallEntries {
  $paths = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  @(
    Get-ItemProperty -Path $paths -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -match $relatedNamePattern } |
      ForEach-Object {
        [pscustomobject]@{
          key = $_.PSPath
          name = $_.DisplayName
          version = $_.DisplayVersion
          installLocation = $_.InstallLocation
          uninstallString = $_.UninstallString
        }
      }
  )
}

function Get-ProductShortcuts {
  $roots = @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs"))
  @(
    foreach ($shortcutRoot in $roots) {
      if (Test-Path -LiteralPath $shortcutRoot) {
        Get-ChildItem -LiteralPath $shortcutRoot -Filter "*.lnk" -File -Recurse -ErrorAction SilentlyContinue |
          Where-Object { $_.BaseName -match $relatedNamePattern } |
          Select-Object -ExpandProperty FullName
      }
    }
  )
}

function Invoke-Installer([string]$Path, [string]$Destination) {
  $process = Start-Process -FilePath $Path -ArgumentList @("/S", "/D=$Destination") -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "安装程序退出码为 $($process.ExitCode)：$([System.IO.Path]::GetFileName($Path))" }
  return $process.ExitCode
}

function Invoke-AppSmoke([string]$Executable, [string]$WorkingDirectory) {
  $process = Start-Process -FilePath $Executable -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru
  try {
    $deadline = (Get-Date).AddSeconds(30)
    do {
      Start-Sleep -Milliseconds 250
      $process.Refresh()
    } while (!$process.HasExited -and $process.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline)
    if ($process.HasExited -or $process.MainWindowHandle -eq 0 -or !$process.Responding) {
      throw "应用未在 30 秒内打开可响应窗口：$([System.IO.Path]::GetFileName($Executable))"
    }
    return $process.MainWindowTitle
  } finally {
    if (!$process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit()
    }
  }
}

function Invoke-InstalledUninstaller([string]$Directory) {
  $uninstaller = Get-ChildItem -LiteralPath $Directory -Filter "uninstall*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (!$uninstaller) { throw "没有找到卸载程序" }
  $process = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "卸载程序退出码为 $($process.ExitCode)" }
  return $process.ExitCode
}

$baselineEntries = Get-UninstallEntries
$baselineShortcuts = Get-ProductShortcuts
$runningProcesses = @(Get-Process -Name "randdeck", "zhishutai" -ErrorAction SilentlyContinue)
$stateExisted = Test-Path -LiteralPath $appDataDir
$stateHashBefore = $null
if ($stateExisted) {
  New-Item -ItemType Directory -Path $appDataBackup -Force | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $appDataDir -Force) {
    Copy-Item -LiteralPath $item.FullName -Destination $appDataBackup -Recurse -Force
  }
  $statePath = Join-Path $appDataDir "state-v5.json"
  if (Test-Path -LiteralPath $statePath) {
    $stateHashBefore = (Get-FileHash -LiteralPath $statePath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$report = [ordered]@{
  schema = "zhishutai.installer-upgrade-smoke.v2"
  version = $Version
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  mode = "current-user-temporary-directory"
  windowsSandboxAvailable = Test-Path -LiteralPath (Join-Path $env:WINDIR "System32\WindowsSandbox.exe")
  installerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  previousInstaller = [ordered]@{
    path = "releases\0.5.0\installer\掷数台-离线安装版-setup.exe"
    bytes = (Get-Item -LiteralPath $previousInstaller).Length
    sha256 = (Get-FileHash -LiteralPath $previousInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    deltaBytes = (Get-Item -LiteralPath $installer).Length - (Get-Item -LiteralPath $previousInstaller).Length
  }
  statePath = "%APPDATA%\com.zhishutai.desktop\state-v5.json"
  stateHashBefore = $stateHashBefore
  previousInstallExitCode = $null
  previousExecutable = $null
  previousLaunched = $false
  previousWindowTitle = $null
  installExitCode = $null
  installedExecutable = $null
  launched = $false
  windowTitle = $null
  oldExecutableRemoved = $false
  singleUninstallEntry = $false
  uninstallDisplayName = $null
  uninstallDisplayVersion = $null
  oldShortcutsRemoved = $false
  newShortcutCount = 0
  statePreservedAcrossUpgrade = $false
  uninstallExitCode = $null
  uninstallEntryAdded = $false
  uninstallEntryRemoved = $false
  shortcutsRemoved = $false
  stateHashAfterRestore = $null
  stateRestored = $false
  temporaryDirectoryRemoved = $false
  passed = $false
  error = $null
}

try {
  if ($runningProcesses.Count) { throw "检测到 RandDeck/掷数台正在运行，请关闭后重试安装升级烟测" }
  if ($baselineEntries.Count) { throw "检测到现有 RandDeck/掷数台安装项；为避免影响真实安装，已停止烟测" }

  if (Test-Path -LiteralPath $appDataDir) {
    Remove-Item -LiteralPath $appDataDir -Recurse -Force
  }

  $report.previousInstallExitCode = Invoke-Installer $previousInstaller $installDir
  $previousExe = Get-Item -LiteralPath (Join-Path $installDir "zhishutai.exe") -ErrorAction SilentlyContinue
  if (!$previousExe) { throw "v0.5.0 安装后未找到 zhishutai.exe" }
  $report.previousExecutable = $previousExe.Name
  $report.previousWindowTitle = Invoke-AppSmoke $previousExe.FullName $installDir
  $report.previousLaunched = [bool]$report.previousWindowTitle

  New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null
  $sentinel = [ordered]@{ id = [guid]::NewGuid().ToString("N"); createdAt = (Get-Date).ToUniversalTime().ToString("o") }
  $sentinel | ConvertTo-Json | Set-Content -LiteralPath $sentinelPath -Encoding UTF8
  $sentinelHash = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash.ToLowerInvariant()

  $report.installExitCode = Invoke-Installer $installer $installDir
  $entriesAfterUpgrade = Get-UninstallEntries
  $shortcutsAfterUpgrade = Get-ProductShortcuts
  $newShortcuts = @($shortcutsAfterUpgrade | Where-Object { $baselineShortcuts -notcontains $_ })
  $oldNewShortcuts = @($newShortcuts | Where-Object { [System.IO.Path]::GetFileNameWithoutExtension($_) -match "^(掷数台|zhishutai)$" })

  $installedExe = Get-Item -LiteralPath (Join-Path $installDir "RandDeck.exe") -ErrorAction SilentlyContinue
  if (!$installedExe) { throw "v0.6.0 升级后未找到 RandDeck.exe" }
  $report.installedExecutable = $installedExe.Name
  $report.oldExecutableRemoved = !(Test-Path -LiteralPath (Join-Path $installDir "zhishutai.exe"))
  $report.singleUninstallEntry = $entriesAfterUpgrade.Count -eq 1
  if ($entriesAfterUpgrade.Count -eq 1) {
    $report.uninstallDisplayName = $entriesAfterUpgrade[0].name
    $report.uninstallDisplayVersion = $entriesAfterUpgrade[0].version
  }
  $report.uninstallEntryAdded = $entriesAfterUpgrade.Count -eq 1
  $report.newShortcutCount = $newShortcuts.Count
  $report.oldShortcutsRemoved = $oldNewShortcuts.Count -eq 0
  $report.statePreservedAcrossUpgrade = (Test-Path -LiteralPath $sentinelPath) -and ((Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $sentinelHash)

  $report.windowTitle = Invoke-AppSmoke $installedExe.FullName $installDir
  $report.launched = [bool]$report.windowTitle

  $report.uninstallExitCode = Invoke-InstalledUninstaller $installDir
  Start-Sleep -Seconds 1
  $entriesAfterRemove = Get-UninstallEntries
  $shortcutsAfterRemove = Get-ProductShortcuts
  $report.uninstallEntryRemoved = $entriesAfterRemove.Count -eq 0
  $report.shortcutsRemoved = @($newShortcuts | Where-Object { $shortcutsAfterRemove -contains $_ }).Count -eq 0

  $report.passed =
    $report.previousLaunched -and
    $report.installedExecutable -eq "RandDeck.exe" -and
    $report.launched -and
    $report.oldExecutableRemoved -and
    $report.singleUninstallEntry -and
    $report.uninstallDisplayName -eq "RandDeck" -and
    $report.uninstallDisplayVersion -eq $Version -and
    $report.oldShortcutsRemoved -and
    $report.newShortcutCount -gt 0 -and
    $report.statePreservedAcrossUpgrade -and
    $report.uninstallEntryRemoved -and
    $report.shortcutsRemoved
} catch {
  $report.error = $_.Exception.Message
} finally {
  if (Test-Path -LiteralPath $installDir) {
    $fallbackUninstaller = Get-ChildItem -LiteralPath $installDir -Filter "uninstall*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($fallbackUninstaller) {
      Start-Process -FilePath $fallbackUninstaller.FullName -ArgumentList "/S" -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
    }
  }

  if (Test-Path -LiteralPath $appDataDir) {
    Remove-Item -LiteralPath $appDataDir -Recurse -Force
  }
  if ($stateExisted) {
    New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $appDataBackup -Force) {
      Copy-Item -LiteralPath $item.FullName -Destination $appDataDir -Recurse -Force
    }
    $restoredStatePath = Join-Path $appDataDir "state-v5.json"
    if ($stateHashBefore -and (Test-Path -LiteralPath $restoredStatePath)) {
      $report.stateHashAfterRestore = (Get-FileHash -LiteralPath $restoredStatePath -Algorithm SHA256).Hash.ToLowerInvariant()
      $report.stateRestored = $report.stateHashAfterRestore -eq $stateHashBefore
    } else {
      $report.stateRestored = Test-Path -LiteralPath $appDataDir
    }
  } else {
    $report.stateRestored = !(Test-Path -LiteralPath $appDataDir)
  }

  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
  $report.temporaryDirectoryRemoved = !(Test-Path -LiteralPath $tempRoot)
  $report.passed = $report.passed -and $report.stateRestored -and $report.temporaryDirectoryRemoved
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
}

$report | ConvertTo-Json -Depth 8
if (!$report.passed) { exit 1 }
