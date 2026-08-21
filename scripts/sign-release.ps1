param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$CertificatePath = $env:ZHISHUTAI_SIGN_CERT,
  [string]$CertificatePassword = $env:ZHISHUTAI_SIGN_PASSWORD
)

$ErrorActionPreference = "Stop"
if (!(Test-Path -LiteralPath $Path)) { throw "待签名文件不存在：$Path" }
if (!$CertificatePath -or !(Test-Path -LiteralPath $CertificatePath)) {
  Write-Output "SKIPPED_UNSIGNED"
  return
}

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (!$signtool) {
  $kits = Get-ChildItem -LiteralPath "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
  foreach ($kit in $kits) {
    $candidate = Join-Path $kit.FullName "x64\signtool.exe"
    if (Test-Path -LiteralPath $candidate) { $signtool = Get-Item -LiteralPath $candidate; break }
  }
}
if (!$signtool) { throw "未找到 signtool.exe，但已提供证书。" }

$arguments = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", "http://timestamp.digicert.com", "/f", $CertificatePath)
if ($CertificatePassword) { $arguments += @("/p", $CertificatePassword) }
$arguments += $Path
& $signtool.Source @arguments
if ($LASTEXITCODE -ne 0) { throw "签名失败：$Path" }
Write-Output "SIGNED"
