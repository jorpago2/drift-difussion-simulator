param(
  [string]$SourcePath = "native/ddm-core/ddm-core.c",
  [string]$WasmPath = "assets/wasm/ddm-core.wasm",
  [string]$Compiler = "clang",
  [string]$ExportNames = "poisson_relax",
  [switch]$UseLibm
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot $SourcePath
$wasm = Join-Path $repoRoot $WasmPath
$compilerCommand = Get-Command $Compiler -ErrorAction SilentlyContinue

if (-not $compilerCommand -and $Compiler -eq "clang" -and $env:WASI_SDK_PATH) {
  $candidate = Join-Path $env:WASI_SDK_PATH "bin\clang.exe"
  if (Test-Path -LiteralPath $candidate) {
    $compilerCommand = Get-Command $candidate -ErrorAction SilentlyContinue
  }
}

if (-not $compilerCommand -and $Compiler -eq "clang") {
  $userProfile = [Environment]::GetFolderPath("UserProfile")
  $toolRoot = Join-Path $userProfile ".cache\fdtd-tools"
  $candidate = Get-ChildItem -Path $toolRoot -Filter "wasi-sdk-*-windows" -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName "bin\clang.exe" } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
  if ($candidate) {
    $compilerCommand = Get-Command $candidate -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path -LiteralPath $source)) {
  throw "WASM source not found: $source"
}

if (-not $compilerCommand) {
  throw "Compiler '$Compiler' was not found. Install WASI SDK/LLVM, set WASI_SDK_PATH, or pass -Compiler with an absolute clang path."
}

New-Item -ItemType Directory -Force (Split-Path -Parent $wasm) | Out-Null

$target = if ($UseLibm) { "wasm32-wasip1" } else { "wasm32" }
$args = @(
  "--target=$target",
  "-O3",
  "-fno-builtin",
  "-Wl,--no-entry",
  "-Wl,--import-memory",
  "-Wl,--allow-undefined"
)
if ($UseLibm) {
  $args += "-DNPN_USE_LIBM=1"
} else {
  $args += "-nostdlib"
}
foreach ($exportName in $ExportNames.Split(",")) {
  $args += "-Wl,--export=$($exportName.Trim())"
}
$args += @("-o", $wasm, $source)
if ($UseLibm) {
  $args += "-lm"
}

& $compilerCommand.Source @args
if ($LASTEXITCODE -ne 0) {
  throw "WASM build failed with exit code $LASTEXITCODE"
}

Write-Output "Built $wasm ($((Get-Item -LiteralPath $wasm).Length) bytes)"
