param(
  [string]$ArtifactRoot = "",
  [string]$BaseRef = "origin/main",
  [string]$HeadRef = "HEAD"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$patterns = @(
  [regex]::Escape($env:USERPROFILE),
  [regex]::Escape($root),
  [regex]::Escape([Environment]::UserName),
  '[A-Za-z]:\\Users\\[^\\]+\\',
  'github_pat_[A-Za-z0-9_]{20,}',
  'gh[pousr]_[A-Za-z0-9]{20,}',
  'npm_[A-Za-z0-9]{20,}',
  'sk-[A-Za-z0-9_-]{20,}',
  'AKIA[0-9A-Z]{16}',
  'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'
) | Where-Object { $_ }
$emailPattern = '\b[A-Za-z0-9._%+-]+@[A-Za-z][A-Za-z0-9.-]*\.[A-Za-z]{2,}\b'

$violations = [System.Collections.Generic.List[string]]::new()

foreach ($pattern in $patterns) {
  $files = @(& git -C $root grep -I -l -E -- $pattern 2>$null)
  foreach ($file in $files) { $violations.Add("tracked:$file") }
}

foreach ($match in @(& git -C $root grep -I -n -E -- $emailPattern 2>$null)) {
  if ($match -notmatch '@users\.noreply\.github\.com\b') { $violations.Add("tracked-email") }
}

function Resolve-GitCommit([string]$Reference, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Reference)) { throw "隐私扫描$Label为空。" }
  $output = @(& git -C $root rev-parse --verify --quiet "${Reference}^{commit}" 2>$null)
  $exitCode = $LASTEXITCODE
  $commit = $output[0]
  if ($exitCode -ne 0 -or !$commit) {
    throw "隐私扫描$Label不存在：$Reference。CI 必须使用 fetch-depth: 0。"
  }
  return $commit
}

$baseCommit = Resolve-GitCommit $BaseRef "基准"
$headCommit = Resolve-GitCommit $HeadRef "目标"
$historyRange = "$baseCommit..$headCommit"
$history = (& git -C $root log -p --no-ext-diff $historyRange -- . 2>$null) -join "`n"
foreach ($pattern in $patterns) {
  if ($history -match $pattern) { $violations.Add("history:$historyRange") }
}
foreach ($match in [regex]::Matches($history, $emailPattern)) {
  if ($match.Value -notmatch '@users\.noreply\.github\.com$') { $violations.Add("history-email:$historyRange") }
}

$commitEmails = @(& git -C $root log --format=%ae $historyRange 2>$null | Where-Object { $_ })
foreach ($email in $commitEmails) {
  if ($email -notmatch '@users\.noreply\.github\.com$') { $violations.Add("commit-email:non-noreply") }
}

function Test-ArtifactFile([string]$Path) {
  $extension = [System.IO.Path]::GetExtension($Path)
  if ($extension -ieq ".pdb") {
    $violations.Add("artifact-pdb:$([System.IO.Path]::GetFileName($Path))")
    return
  }
  foreach ($pattern in $patterns) {
    & rg -a -l -e $pattern -- $Path 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $violations.Add("artifact:$([System.IO.Path]::GetFileName($Path))")
      break
    }
    if ($extension -in @(".exe", ".dll")) {
      & rg -a --encoding utf-16le -l -e $pattern -- $Path 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) {
        $violations.Add("artifact-utf16:$([System.IO.Path]::GetFileName($Path))")
        break
      }
    }
  }
}

if ($ArtifactRoot) {
  $artifactPath = (Resolve-Path -LiteralPath $ArtifactRoot).Path
  $releaseBase = [System.IO.Path]::GetFullPath((Join-Path $root "releases")).TrimEnd("\")
  if (!$artifactPath.StartsWith("$releaseBase\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "产物扫描目录必须位于 releases 内：$artifactPath"
  }

  foreach ($file in Get-ChildItem -LiteralPath $artifactPath -File -Recurse) {
    Test-ArtifactFile $file.FullName
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  foreach ($zip in Get-ChildItem -LiteralPath $artifactPath -Filter "*.zip" -File -Recurse) {
    $extractRoot = Join-Path $env:TEMP ("randdeck-privacy-" + [guid]::NewGuid().ToString("N"))
    try {
      [System.IO.Compression.ZipFile]::ExtractToDirectory($zip.FullName, $extractRoot)
      foreach ($file in Get-ChildItem -LiteralPath $extractRoot -File -Recurse) {
        Test-ArtifactFile $file.FullName
      }
    } finally {
      if (Test-Path -LiteralPath $extractRoot) {
        $resolvedExtract = (Resolve-Path -LiteralPath $extractRoot).Path
        $tempBase = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd("\")
        if (!$resolvedExtract.StartsWith("$tempBase\", [System.StringComparison]::OrdinalIgnoreCase)) {
          throw "临时解压目录越界：$resolvedExtract"
        }
        Remove-Item -LiteralPath $resolvedExtract -Recurse -Force
      }
    }
  }
}

$unique = @($violations | Sort-Object -Unique)
if ($unique.Count) {
  $unique | ForEach-Object { Write-Error "隐私扫描失败：$_" }
  exit 1
}

[pscustomobject]@{
  schema = "randdeck.privacy-scan.v1"
  source = "passed"
  historyRange = $historyRange
  commitEmails = "github-noreply-only"
  artifacts = if ($ArtifactRoot) { "passed" } else { "not-requested" }
} | ConvertTo-Json
