param(
  [string]$ArtifactRoot = "",
  [string]$BaseRef = "origin/main"
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

$violations = [System.Collections.Generic.List[string]]::new()

foreach ($pattern in $patterns) {
  $files = @(& git -C $root grep -I -l -E -- $pattern 2>$null)
  foreach ($file in $files) { $violations.Add("tracked:$file") }
}

$baseRefName = if ($BaseRef.StartsWith("origin/", [System.StringComparison]::OrdinalIgnoreCase)) {
  "refs/remotes/$BaseRef"
} else {
  $BaseRef
}
& git -C $root show-ref --verify --quiet $baseRefName
if ($LASTEXITCODE -ne 0) {
  throw "隐私扫描基准不存在：$BaseRef。CI 必须使用 fetch-depth: 0。"
}

$historyRange = "$baseRefName..HEAD"
$history = (& git -C $root log -p --no-ext-diff $historyRange -- . 2>$null) -join "`n"
foreach ($pattern in $patterns) {
  if ($history -match $pattern) { $violations.Add("history:$historyRange") }
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
