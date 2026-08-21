param(
  [string]$Version = "0.5.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $root "releases\$Version"
$portable = Join-Path $releaseRoot "portable\掷数台.exe"
$manifestPath = Join-Path $releaseRoot "manifest.json"
$packageDir = Join-Path $releaseRoot "portable-package"
$zipPath = Join-Path $releaseRoot "掷数台-v$Version-便携完整包.zip"

foreach ($path in @($portable, $manifestPath, (Join-Path $root "LICENSE"), (Join-Path $root "docs\使用说明.md"))) {
  if (!(Test-Path -LiteralPath $path)) { throw "便携完整包缺少文件：$path" }
}
if (Test-Path -LiteralPath $packageDir) { throw "便携完整包目录已存在：$packageDir" }
if (Test-Path -LiteralPath $zipPath) { throw "便携完整包 ZIP 已存在：$zipPath" }

New-Item -ItemType Directory -Path $packageDir | Out-Null
Copy-Item -LiteralPath $portable -Destination (Join-Path $packageDir "掷数台.exe")
Copy-Item -LiteralPath (Join-Path $root "docs\使用说明.md") -Destination (Join-Path $packageDir "使用说明.md")
Copy-Item -LiteralPath (Join-Path $root "LICENSE") -Destination (Join-Path $packageDir "LICENSE.txt")

$checksums = @("掷数台.exe", "使用说明.md", "LICENSE.txt") | ForEach-Object {
  $path = Join-Path $packageDir $_
  "{0}  {1}" -f (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant(), $_
}
$checksums | Set-Content -LiteralPath (Join-Path $packageDir "SHA256SUMS.txt") -Encoding UTF8

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -CompressionLevel Optimal
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = @($archive.Entries | Where-Object { $_.Name })
  if ($entries.Count -ne 4) { throw "便携完整包条目数异常：$($entries.Count)" }
  if (@($entries | Where-Object Length -eq 0).Count) { throw "便携完整包包含空文件" }
} finally {
  $archive.Dispose()
}

$item = Get-Item -LiteralPath $zipPath
$artifact = [pscustomobject]@{
  kind = "portable-package-zip"
  path = $item.Name
  fileName = $item.Name
  bytes = $item.Length
  sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  buildTimeUtc = $item.LastWriteTimeUtc.ToString("o")
  webView2Mode = "system-evergreen-required"
}
$manifest = Get-Content -Raw -LiteralPath $manifestPath -Encoding UTF8 | ConvertFrom-Json
$manifest.artifacts = @($manifest.artifacts | Where-Object kind -ne "portable-package-zip") + @($artifact)
$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$packageManifest = [pscustomobject]@{
  schema = "zhishutai.portable-package.v1"
  version = $Version
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  entries = @($entries | ForEach-Object { [pscustomobject]@{ name = $_.FullName; bytes = $_.Length } })
  artifact = $artifact
}
$packageManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $packageDir "manifest.json") -Encoding UTF8
$packageManifest | ConvertTo-Json -Depth 8
