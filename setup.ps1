<#
.SYNOPSIS drawDB Desktop turnkey setup (Windows).
.NOTES Requires git, Node.js 18+, Rust 1.77.2+, VS Build Tools (C++).
#>
$ErrorActionPreference = "Stop"
$projectName = "drawDB-Desktop"
$repo = "https://github.com/khsuzan/drawDB-App.git"

Write-Host "==> Cloning $repo" -ForegroundColor Cyan
if (-not (Test-Path $projectName)) { git clone $repo $projectName }

$overlayDir = Join-Path $PSScriptRoot "overlay"
if (-not (Test-Path $overlayDir)) { throw "overlay folder not found at $overlayDir" }

Write-Host "==> Applying overlay" -ForegroundColor Cyan
Copy-Item -Path (Join-Path $overlayDir "*") -Destination $projectName -Recurse -Force

Set-Location $projectName

Write-Host "==> npm install" -ForegroundColor Cyan
npm i
npm i jszip exceljs @tauri-apps/api @tauri-apps/plugin-fs @tauri-apps/plugin-dialog @tauri-apps/plugin-single-instance @tauri-apps/plugin-sql
npm uninstall xlsx

Write-Host "==> Adding Rust plugins" -ForegroundColor Cyan
Push-Location src-tauri
cargo add tauri-plugin-fs
cargo add tauri-plugin-dialog
cargo add tauri-plugin-single-instance
cargo add tauri-plugin-sql --features sqlite
Pop-Location

Write-Host "==> Apply manual patches per src/patches/PATCHES.md & PATCHES_FULL.md" -ForegroundColor Yellow
Write-Host "    Then run: npm run tauri build" -ForegroundColor Yellow
