param(
  [string]$Version = "0.6.0",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$releaseBase = Join-Path $root "releases"
$releaseRoot = Join-Path $releaseBase $Version
$portableSource = Join-Path $root "src-tauri\target\release\randdeck.exe"
$nsisDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
$verificationPath = Join-Path $root "reports\v$Version-verification.json"

function Get-SafeRelativePath([string]$BasePath, [string]$TargetPath) {
  $baseFull = [System.IO.Path]::GetFullPath($BasePath).TrimEnd("\") + "\"
  $targetFull = [System.IO.Path]::GetFullPath($TargetPath)
  if (!$targetFull.StartsWith($baseFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "相对路径目标越界：$targetFull"
  }
  return $targetFull.Substring($baseFull.Length)
}

if (!(Test-Path -LiteralPath $portableSource)) { throw "便携版构建文件不存在：$portableSource" }
if (!(Test-Path -LiteralPath $nsisDir)) { throw "NSIS 构建目录不存在：$nsisDir" }
$installerSource = Get-ChildItem -LiteralPath $nsisDir -File -Filter "*$Version*setup.exe" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (!$installerSource) { throw "未找到 $Version 的 NSIS 安装程序。" }
if (!(Test-Path -LiteralPath $verificationPath)) { throw "发布验证报告不存在：$verificationPath" }
$verification = Get-Content -Raw -LiteralPath $verificationPath | ConvertFrom-Json
if (!$verification.passed) { throw "发布验证报告未通过，停止整理发布文件。" }

$sourceCommit = ((& git -C $root rev-parse HEAD 2>$null) -join "").Trim()
$branch = ((& git -C $root branch --show-current 2>$null) -join "").Trim()
$statusBefore = ((& git -C $root status --porcelain --untracked-files=normal -- . ":(exclude)releases/$Version" 2>$null) -join "`n").Trim()
if ($statusBefore) { throw "源码工作树不是干净状态，停止发布：`n$statusBefore" }

if (Test-Path -LiteralPath $releaseRoot) {
  if (!$Force) { throw "发布目录已存在：$releaseRoot。需要覆盖时请显式使用 -Force。" }
  $resolvedRelease = (Resolve-Path -LiteralPath $releaseRoot).Path
  $resolvedBase = (Resolve-Path -LiteralPath $releaseBase).Path
  if (!$resolvedRelease.StartsWith("$resolvedBase\", [System.StringComparison]::OrdinalIgnoreCase)) { throw "发布目录越界：$resolvedRelease" }
  Remove-Item -LiteralPath $resolvedRelease -Recurse -Force
}

$portableDir = Join-Path $releaseRoot "portable"
$installerDir = Join-Path $releaseRoot "installer"
New-Item -ItemType Directory -Path $portableDir, $installerDir -Force | Out-Null
$portableTarget = Join-Path $portableDir "RandDeck.exe"
$installerTarget = Join-Path $installerDir "RandDeck-v$Version-offline-setup.exe"
Copy-Item -LiteralPath $portableSource -Destination $portableTarget
Copy-Item -LiteralPath $installerSource.FullName -Destination $installerTarget
$signScript = Join-Path $PSScriptRoot "sign-release.ps1"
$signedPortable = $false
$signedInstaller = $false
if (Test-Path -LiteralPath $signScript) {
  $portableSign = & $signScript -Path $portableTarget
  $installerSign = & $signScript -Path $installerTarget
  $signedPortable = (($portableSign | Out-String) -match "(?m)^SIGNED\s*$")
  $signedInstaller = (($installerSign | Out-String) -match "(?m)^SIGNED\s*$")
}
$releaseSigned = $signedPortable -and $signedInstaller

function Get-Artifact([string]$Path, [string]$Kind, [string]$WebView2Mode) {
  $item = Get-Item -LiteralPath $Path
  [pscustomobject]@{
    kind = $Kind
    path = Get-SafeRelativePath $releaseRoot $item.FullName
    fileName = $item.Name
    bytes = $item.Length
    sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    buildTimeUtc = $item.LastWriteTimeUtc.ToString("o")
    webView2Mode = $WebView2Mode
  }
}

function Get-ToolVersion([string]$Command, [string[]]$Arguments) {
  try { return ((& $Command @Arguments 2>$null) -join " ").Trim() } catch { return "unavailable" }
}

$portable = Get-Artifact $portableTarget "portable" "system-evergreen-required"
$installer = Get-Artifact $installerTarget "nsis-offline-installer" "offlineInstaller"
$portableMiB = [math]::Round($portable.bytes / 1MB, 2)
if ($portable.bytes -gt 35MB) { throw "便携版为 $portableMiB MiB，超过 35 MiB 暂停线。" }

$previousInstaller = Join-Path $releaseBase "0.5.0\installer\掷数台-离线安装版-setup.exe"
$installerDeltaMiB = $null
if (Test-Path -LiteralPath $previousInstaller) {
  $installerDeltaMiB = [math]::Round(($installer.bytes - (Get-Item -LiteralPath $previousInstaller).Length) / 1MB, 2)
}

$package = Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json
$directNames = @($package.dependencies.PSObject.Properties.Name) + @($package.devDependencies.PSObject.Properties.Name) | Sort-Object -Unique
$npmDependencies = foreach ($name in $directNames) {
  $packagePath = Join-Path $root "node_modules\$name\package.json"
  if (Test-Path -LiteralPath $packagePath) {
    $metadata = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
    [pscustomobject]@{ name = $metadata.name; version = $metadata.version; license = $metadata.license; development = [bool]($package.devDependencies.PSObject.Properties.Name -contains $name) }
  }
}

Push-Location (Join-Path $root "src-tauri")
$cargoMetadataPath = Join-Path $env:TEMP ("zhishutai-cargo-metadata-" + [guid]::NewGuid().ToString("N") + ".json")
$cargoMetadataErr = "$cargoMetadataPath.err"
try {
  $cargoMeta = Start-Process -FilePath "cargo" -ArgumentList @("metadata", "--locked", "--format-version", "1") -WorkingDirectory (Get-Location) -RedirectStandardOutput $cargoMetadataPath -RedirectStandardError $cargoMetadataErr -NoNewWindow -Wait -PassThru
  if ($cargoMeta.ExitCode -ne 0) { throw "cargo metadata 执行失败。" }
  $cargoMetadata = Get-Content -Raw -LiteralPath $cargoMetadataPath -Encoding UTF8 | ConvertFrom-Json
} finally {
  Pop-Location
  Remove-Item -LiteralPath $cargoMetadataPath, $cargoMetadataErr -Force -ErrorAction SilentlyContinue
}
$rustDependencies = $cargoMetadata.packages | Sort-Object name, version | ForEach-Object {
  [pscustomobject]@{ name = $_.name; version = $_.version; license = $_.license; source = $_.source }
}
$dependencyReport = [pscustomobject]@{
  schema = "zhishutai.dependencies.v1"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceCommit = $sourceCommit
  npmDirect = $npmDependencies
  rustResolved = $rustDependencies
}
$dependencyPath = Join-Path $releaseRoot "dependencies-licenses.json"
$dependencyReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $dependencyPath -Encoding UTF8
$dependencyArtifact = Get-Artifact $dependencyPath "dependency-license-report" "not-applicable"

$webView2Version = "unknown"
$webView2Keys = @(
  "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
  "HKLM:\Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
)
foreach ($key in $webView2Keys) {
  if (Test-Path $key) { $webView2Version = (Get-ItemProperty -Path $key).pv; if ($webView2Version) { break } }
}

$tauriCommand = Join-Path $root "node_modules\.bin\tauri.cmd"
$verificationArtifact = [pscustomobject]@{
  path = Get-SafeRelativePath $root $verificationPath
  sha256 = (Get-FileHash -LiteralPath $verificationPath -Algorithm SHA256).Hash.ToLowerInvariant()
  sourceCommit = $verification.sourceCommit
}
$manifest = [pscustomobject]@{
  schema = "zhishutai.release.v2"
  version = $Version
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceCommit = $sourceCommit
  releaseTag = "v$Version"
  branch = $branch
  cleanSource = $true
  signed = [bool]$releaseSigned
  smartScreenNote = if ($releaseSigned) { "已使用本机证书进行 Authenticode 签名。" } else { "未进行代码签名，Windows SmartScreen 可能显示未知发布者。" }
  platform = "windows-x86_64"
  webView2 = [pscustomobject]@{ detectedRuntimeVersion = $webView2Version; portable = "system-evergreen-required"; installer = "offlineInstaller" }
  sizeAssessment = [pscustomobject]@{ portableMiB = $portableMiB; portableTargetMiB = 25; installerMiB = [math]::Round($installer.bytes / 1MB, 2); installerDeltaFromV050MiB = $installerDeltaMiB; installerDeltaTargetMiB = 30 }
  toolchain = [pscustomobject]@{
    node = Get-ToolVersion "node" @("--version")
    npm = Get-ToolVersion "npm" @("--version")
    rustc = Get-ToolVersion "rustc" @("--version")
    cargo = Get-ToolVersion "cargo" @("--version")
    tauri = Get-ToolVersion $tauriCommand @("--version")
  }
  verification = $verificationArtifact
  dependencies = [pscustomobject]@{ npmDirectCount = @($npmDependencies).Count; rustResolvedCount = @($rustDependencies).Count; report = $dependencyArtifact }
  artifacts = @($portable, $installer)
}

foreach ($artifact in @($portable, $installer)) {
  $artifactManifest = [pscustomobject]@{
    schema = "zhishutai.release-artifact.v1"
    version = $Version
    sourceCommit = $sourceCommit
    generatedAt = $manifest.generatedAt
    signed = [bool]$releaseSigned
    artifact = $artifact
  }
  $targetDir = if ($artifact.kind -eq "portable") { $portableDir } else { $installerDir }
  $artifactManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $targetDir "manifest.json") -Encoding UTF8
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $releaseRoot "manifest.json") -Encoding UTF8
$manifest | ConvertTo-Json -Depth 10
