param(
  [string]$Version = "0.6.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $root "releases\$Version"
$portable = Join-Path $releaseRoot "portable\RandDeck.exe"
$manifestPath = Join-Path $releaseRoot "manifest.json"
$packageDir = Join-Path $releaseRoot "portable-package"
$zipPath = Join-Path $releaseRoot "RandDeck-v$Version-portable.zip"
$licensePath = Join-Path $root "LICENSE"

$packageFiles = @(
  "RandDeck.exe",
  "README.md",
  "README.zh-CN.md",
  "LICENSE.txt",
  "manifest.json"
)

foreach ($path in @($portable, $manifestPath, $licensePath, (Join-Path $root "README.md"), (Join-Path $root "README.zh-CN.md"))) {
  if (!(Test-Path -LiteralPath $path)) { throw "便携完整包缺少文件：$path" }
}
if (Test-Path -LiteralPath $packageDir) { throw "便携完整包目录已存在：$packageDir" }
if (Test-Path -LiteralPath $zipPath) { throw "便携完整包 ZIP 已存在：$zipPath" }

New-Item -ItemType Directory -Path $packageDir | Out-Null
Copy-Item -LiteralPath $portable -Destination (Join-Path $packageDir "RandDeck.exe")
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination (Join-Path $packageDir "README.md")
Copy-Item -LiteralPath (Join-Path $root "README.zh-CN.md") -Destination (Join-Path $packageDir "README.zh-CN.md")
Copy-Item -LiteralPath $licensePath -Destination (Join-Path $packageDir "LICENSE.txt")

$rootManifest = Get-Content -Raw -LiteralPath $manifestPath -Encoding UTF8 | ConvertFrom-Json
$packageManifest = [ordered]@{
  schema = "zhishutai.portable-package.v1"
  version = $Version
  product = "RandDeck / 掷数台"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceManifestSchema = $rootManifest.schema
  entries = @()
}
$packageManifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $packageDir "manifest.json") -Encoding UTF8

$checksummedFiles = @("RandDeck.exe", "README.md", "README.zh-CN.md", "LICENSE.txt", "manifest.json")
$manifestEntryFiles = @("RandDeck.exe", "README.md", "README.zh-CN.md", "LICENSE.txt")
$checksums = foreach ($name in $checksummedFiles) {
  $path = Join-Path $packageDir $name
  "{0}  {1}" -f (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant(), $name
}
$checksums | Set-Content -LiteralPath (Join-Path $packageDir "SHA256SUMS.txt") -Encoding UTF8

$packageManifest.entries = @(
  foreach ($name in $manifestEntryFiles) {
    $path = Join-Path $packageDir $name
    $item = Get-Item -LiteralPath $path
    [pscustomobject]@{
      name = $name
      bytes = $item.Length
      sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
)
$packageManifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $packageDir "manifest.json") -Encoding UTF8

# manifest.json changed after the first checksum pass, so regenerate the checksum list once.
$checksums = foreach ($name in $checksummedFiles) {
  $path = Join-Path $packageDir $name
  "{0}  {1}" -f (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant(), $name
}
$checksums | Set-Content -LiteralPath (Join-Path $packageDir "SHA256SUMS.txt") -Encoding UTF8

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -CompressionLevel Optimal
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = @($archive.Entries | Where-Object { $_.Name } | Sort-Object FullName)
  $expectedEntries = @($packageFiles + "SHA256SUMS.txt" | Sort-Object)
  $actualEntries = @($entries | ForEach-Object FullName)
  if ((ConvertTo-Json $actualEntries -Compress) -ne (ConvertTo-Json $expectedEntries -Compress)) {
    throw "便携完整包条目不符合发布合同：实际 $($actualEntries -join ', ')；预期 $($expectedEntries -join ', ')"
  }
  if (@($entries | Where-Object Length -eq 0).Count) { throw "便携完整包包含空文件" }

  $checksumEntry = $archive.GetEntry("SHA256SUMS.txt")
  $reader = [System.IO.StreamReader]::new($checksumEntry.Open())
  try { $checksumText = $reader.ReadToEnd() } finally { $reader.Dispose() }
  foreach ($line in ($checksumText -split "`r?`n" | Where-Object { $_.Trim() })) {
    $parts = $line -split "  ", 2
    if ($parts.Count -ne 2) { throw "SHA256SUMS.txt 格式错误：$line" }
    $entry = $archive.GetEntry($parts[1])
    if (!$entry) { throw "SHA256SUMS.txt 引用了不存在的条目：$($parts[1])" }
    $stream = $entry.Open()
    try {
      $sha = [System.Security.Cryptography.SHA256]::Create()
      try { $actualHash = ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() }
      finally { $sha.Dispose() }
    } finally { $stream.Dispose() }
    if ($actualHash -ne $parts[0].ToLowerInvariant()) { throw "条目哈希不匹配：$($parts[1])" }
  }
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
$packageManifest | ConvertTo-Json -Depth 10
