param(
  [string]$Version = "0.5.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root "releases\$Version\manifest.json"
$portableReportPath = Join-Path $root "reports\portable-smoke.json"
$installerReportPath = Join-Path $root "reports\installer-smoke.json"
foreach ($path in @($manifestPath, $portableReportPath, $installerReportPath)) {
  if (!(Test-Path -LiteralPath $path)) { throw "最终化所需文件不存在：$path" }
}

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$portableReport = Get-Content -Raw -LiteralPath $portableReportPath | ConvertFrom-Json
$installerReport = Get-Content -Raw -LiteralPath $installerReportPath | ConvertFrom-Json
if (!$portableReport.passed -or !$installerReport.passed) { throw "便携版或安装版冒烟报告未通过。" }
$portableArtifact = $manifest.artifacts | Where-Object kind -eq "portable"
$installerArtifact = $manifest.artifacts | Where-Object kind -eq "nsis-offline-installer"
if ($portableReport.sha256 -ne $portableArtifact.sha256) { throw "便携版冒烟哈希与发布清单不一致。" }
if ($installerReport.installerSha256 -ne $installerArtifact.sha256) { throw "安装版冒烟哈希与发布清单不一致。" }

$postBuild = [pscustomobject]@{
  portable = [pscustomobject]@{
    status = "passed"
    runs = @($portableReport.runs).Count
    report = "reports\portable-smoke.json"
    sha256 = (Get-FileHash -LiteralPath $portableReportPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  installer = [pscustomobject]@{
    status = "passed"
    mode = $installerReport.mode
    windowsSandboxAvailable = $installerReport.windowsSandboxAvailable
    networkIsolation = if ($installerReport.windowsSandboxAvailable) { "windows-sandbox" } else { "not-isolated" }
    report = "reports\installer-smoke.json"
    sha256 = (Get-FileHash -LiteralPath $installerReportPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$manifest | Add-Member -NotePropertyName finalizedAt -NotePropertyValue (Get-Date).ToUniversalTime().ToString("o") -Force
$manifest | Add-Member -NotePropertyName postBuildVerification -NotePropertyValue $postBuild -Force
$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$manifest | ConvertTo-Json -Depth 12
