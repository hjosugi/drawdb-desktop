param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = "Stop"

function Get-SignToolPath {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $kitRoots = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
    "${env:ProgramFiles}\Windows Kits\10\bin"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  foreach ($root in $kitRoots) {
    $tool = Get-ChildItem -Path $root -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($tool) {
      return $tool.FullName
    }
  }

  throw "signtool.exe was not found. Install the Windows SDK or add signtool.exe to PATH."
}

function Require-Success {
  param([string]$Action)
  if ($LASTEXITCODE -ne 0) {
    throw "$Action failed with exit code $LASTEXITCODE"
  }
}

function Has-ArtifactSigningConfig {
  return (
    -not [string]::IsNullOrWhiteSpace($env:AZURE_CLIENT_ID) -and
    -not [string]::IsNullOrWhiteSpace($env:AZURE_TENANT_ID) -and
    -not [string]::IsNullOrWhiteSpace($env:AZURE_CLIENT_SECRET) -and
    -not [string]::IsNullOrWhiteSpace($env:AZURE_ARTIFACT_SIGNING_ENDPOINT) -and
    -not [string]::IsNullOrWhiteSpace($env:AZURE_ARTIFACT_SIGNING_ACCOUNT) -and
    -not [string]::IsNullOrWhiteSpace($env:AZURE_ARTIFACT_SIGNING_CERT_PROFILE) -and
    $null -ne (Get-Command artifact-signing-cli -ErrorAction SilentlyContinue)
  )
}

if (-not (Test-Path -LiteralPath $Path)) {
  throw "Signing target does not exist: $Path"
}

$target = (Resolve-Path -LiteralPath $Path).Path
$artifactSigningConfigured = Has-ArtifactSigningConfig
$thumbprintConfigured = -not [string]::IsNullOrWhiteSpace($env:WINDOWS_CERTIFICATE_THUMBPRINT)

if (-not $artifactSigningConfigured -and -not $thumbprintConfigured) {
  Write-Host "No Windows signing configuration detected; leaving unsigned: $target"
  exit 0
}

$signtool = Get-SignToolPath
$timestampUrl = if ([string]::IsNullOrWhiteSpace($env:WINDOWS_TIMESTAMP_URL)) {
  "http://timestamp.acs.microsoft.com"
} else {
  $env:WINDOWS_TIMESTAMP_URL
}

if ($artifactSigningConfigured) {
  Write-Host "Signing with Azure Artifact Signing: $target"
  $artifactSigning = (Get-Command artifact-signing-cli -ErrorAction Stop).Source
  & $artifactSigning `
    -e $env:AZURE_ARTIFACT_SIGNING_ENDPOINT `
    -a $env:AZURE_ARTIFACT_SIGNING_ACCOUNT `
    -c $env:AZURE_ARTIFACT_SIGNING_CERT_PROFILE `
    -d "drawDB" `
    $target
  Require-Success "Azure Artifact Signing"
  & $signtool verify /pa $target
  Require-Success "Authenticode verification"
  exit 0
}

if ($thumbprintConfigured) {
  Write-Host "Signing with local certificate thumbprint: $target"
  & $signtool sign /v /fd SHA256 /tr $timestampUrl /td SHA256 /sha1 $env:WINDOWS_CERTIFICATE_THUMBPRINT $target
  Require-Success "Authenticode signing"
  & $signtool verify /pa $target
  Require-Success "Authenticode verification"
  exit 0
}
