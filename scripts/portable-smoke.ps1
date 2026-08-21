param(
  [string]$Version = "0.5.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$source = (Resolve-Path -LiteralPath (Join-Path $root "releases\$Version\portable\掷数台.exe")).Path
$reportPath = Join-Path $root "reports\portable-smoke.json"
$tempRoot = Join-Path $env:TEMP ("zhishutai-portable-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$runs = @()

try {
  foreach ($index in 1..2) {
    $runDir = Join-Path $tempRoot "run-$index"
    New-Item -ItemType Directory -Path $runDir | Out-Null
    $target = Join-Path $runDir "掷数台.exe"
    Copy-Item -LiteralPath $source -Destination $target
    $onlyExecutable = @(Get-ChildItem -LiteralPath $runDir -File).Count -eq 1
    $process = Start-Process -FilePath $target -WorkingDirectory $runDir -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(20)
    do { Start-Sleep -Milliseconds 250; $process.Refresh() } while (!$process.HasExited -and $process.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline)
    $started = !$process.HasExited -and $process.MainWindowHandle -ne 0 -and $process.Responding
    $runs += [pscustomobject]@{ run = $index; isolatedDirectory = "run-$index"; onlyExecutablePresent = $onlyExecutable; started = $started; windowTitle = $process.MainWindowTitle }
    if (!$process.HasExited) { Stop-Process -Id $process.Id -Force; $process.WaitForExit() }
    if (!$started) { throw "第 $index 次独立启动失败" }
  }
  $report = [pscustomobject]@{
    schema = "zhishutai.portable-smoke.v1"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    sourceFile = "releases\$Version\portable\掷数台.exe"
    sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    runs = $runs
    passed = $true
  }
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
  $report | ConvertTo-Json -Depth 6
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    $resolved = (Resolve-Path -LiteralPath $tempRoot).Path
    $tempBase = (Resolve-Path -LiteralPath $env:TEMP).Path
    if (!$resolved.StartsWith("$tempBase\", [System.StringComparison]::OrdinalIgnoreCase)) { throw "临时目录越界：$resolved" }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
