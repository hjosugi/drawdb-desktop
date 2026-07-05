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
npm i jszip exceljs @tauri-apps/cli@2.9.6 @tauri-apps/api@2.9.1 @tauri-apps/plugin-fs@2.4.3 @tauri-apps/plugin-dialog@2.4.0 @tauri-apps/plugin-sql@2.3.0
npm pkg set scripts.tauri=tauri
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
