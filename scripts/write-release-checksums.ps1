param(
  [string]$Version = "0.7.1",
  [string]$ReleaseRoot = ""
)

$ErrorActionPreference = "Stop"
if (!$ReleaseRoot) { $ReleaseRoot = Join-Path (Split-Path -Parent $PSScriptRoot) "releases\$Version" }
$releaseDirectory = [System.IO.Path]::GetFullPath($ReleaseRoot).TrimEnd('\')
$manifestPath = Join-Path $releaseDirectory 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schema -ne 'zhishutai.release.v2' -or $manifest.version -ne $Version) {
  throw 'Release manifest schema or version does not match the checksum request.'
}

$files = @{}
$files['manifest.json'] = $manifestPath
$artifacts = @($manifest.artifacts) + @($manifest.dependencies.report)
if (@($manifest.artifacts).Count -eq 0 -or !$manifest.dependencies.report) { throw 'Release artifacts and dependency report are required.' }
foreach ($artifact in $artifacts) {
  $relativePath = [string]$artifact.path
  $fileName = [string]$artifact.fileName
  if (!$relativePath -or [System.IO.Path]::IsPathRooted($relativePath)) { throw 'Artifact path must be relative to the release directory.' }
  if (!$fileName -or $fileName -ne [System.IO.Path]::GetFileName($fileName) -or $fileName -match '[\r\n]' -or $fileName -eq 'SHA256SUMS.txt') {
    throw 'Artifact upload filename is invalid.'
  }
  if ($files.ContainsKey($fileName)) { throw "Duplicate upload filename: $fileName" }
  $path = [System.IO.Path]::GetFullPath((Join-Path $releaseDirectory $relativePath))
  if (!$path.StartsWith("$releaseDirectory\", [System.StringComparison]::OrdinalIgnoreCase)) { throw "Artifact path escapes the release directory: $relativePath" }
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Release file does not exist: $relativePath" }
  $item = Get-Item -LiteralPath $path
  $actualHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($artifact.sha256 -notmatch '^[0-9a-fA-F]{64}$' -or $actualHash -ne $artifact.sha256 -or $item.Length -ne $artifact.bytes) {
    throw "Release file does not match its manifest: $relativePath"
  }
  $files[$fileName] = $path
}

$lines = @(
  foreach ($name in ($files.Keys | Sort-Object)) {
    '{0}  {1}' -f (Get-FileHash -LiteralPath $files[$name] -Algorithm SHA256).Hash.ToLowerInvariant(), $name
  }
)
$checksumPath = Join-Path $releaseDirectory 'SHA256SUMS.txt'
[System.IO.File]::WriteAllLines($checksumPath, [string[]]$lines, [System.Text.UTF8Encoding]::new($false))

# Re-read exactly the bytes that will be uploaded; the manifest is never changed
# after its digest is computed in this step.
$verified = @{}
foreach ($line in (Get-Content -LiteralPath $checksumPath -Encoding UTF8)) {
  if ($line -notmatch '^([0-9a-f]{64})  (.+)$') { throw 'Generated checksum file has an invalid line.' }
  $expectedHash = $Matches[1]
  $name = $Matches[2]
  if (!$files.ContainsKey($name) -or $verified.ContainsKey($name)) { throw "Checksum entry is unknown or duplicated: $name" }
  if ((Get-FileHash -LiteralPath $files[$name] -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw "Checksum self-verification failed: $name" }
  $verified[$name] = $true
}
if ($verified.Count -ne $files.Count) { throw 'Checksum file does not cover every upload asset.' }
[pscustomobject]@{ path = $checksumPath; files = $verified.Count; selfVerified = $true } | ConvertTo-Json
