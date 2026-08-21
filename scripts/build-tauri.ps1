param(
  [ValidateSet("portable", "offline")]
  [string]$Target
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$tauri = Join-Path $root "node_modules\.bin\tauri.cmd"
if (!(Test-Path -LiteralPath $tauri)) { throw "Tauri CLI 不存在，请先运行 npm install：$tauri" }

$cargoHome = if ($env:CARGO_HOME) {
  [System.IO.Path]::GetFullPath($env:CARGO_HOME)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".cargo"))
}

# Rust and MSVC otherwise embed local source and PDB paths in release binaries.
$encodedFlags = @(
  "--remap-path-prefix=$root=WORKSPACE",
  "--remap-path-prefix=$cargoHome=CARGO_HOME",
  "--remap-path-prefix=$env:USERPROFILE=USERPROFILE",
  "-C",
  "link-arg=/PDBALTPATH:%_PDB%"
) -join [char]0x1f

$previousEncoded = $env:CARGO_ENCODED_RUSTFLAGS
$previousRustFlags = $env:RUSTFLAGS
try {
  $env:CARGO_ENCODED_RUSTFLAGS = $encodedFlags
  Remove-Item Env:RUSTFLAGS -ErrorAction SilentlyContinue
  Push-Location $root
  try {
    if ($Target -eq "portable") {
      & $tauri build --no-bundle --config "src-tauri/tauri.portable.conf.json"
    } else {
      & $tauri build --bundles nsis --config "src-tauri/tauri.offline.conf.json"
    }
    if ($LASTEXITCODE -ne 0) { throw "Tauri $Target 构建失败，退出码 $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
} finally {
  if ($null -eq $previousEncoded) { Remove-Item Env:CARGO_ENCODED_RUSTFLAGS -ErrorAction SilentlyContinue }
  else { $env:CARGO_ENCODED_RUSTFLAGS = $previousEncoded }
  if ($null -eq $previousRustFlags) { Remove-Item Env:RUSTFLAGS -ErrorAction SilentlyContinue }
  else { $env:RUSTFLAGS = $previousRustFlags }
}
