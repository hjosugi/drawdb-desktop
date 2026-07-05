<#
.SYNOPSIS drawDB Desktop turnkey setup (Windows).
.NOTES Requires git, Node.js 18+, Rust 1.77.2+, VS Build Tools (C++).
#>
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "scripts/setup.mjs"
node $script @args
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
