<#
.SYNOPSIS
Install dsh-opencode-go-model-list into a dsh profile.

.DESCRIPTION
Copies the plugin package into the profile's node_modules and registers it as a
profile bundle - exactly what a package-manager install of a local plugin
produces. Nothing else is touched: no settings.yaml entry, no provider route, no
credential, and no file inside the dsh installation.

.PARAMETER Profile
Profile name under $DSH_HOME/profiles. Defaults to 'web'.

.PARAMETER DshHome
Harness home. Defaults to $env:DSH_HOME, then to ~/.dsh.

.PARAMETER Source
The package directory to install. Defaults to this script's directory.

.PARAMETER Force
Replace an already installed copy.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web',
  [string]$DshHome = '',
  [string]$Source = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$packageName = 'dsh-opencode-go-model-list'
if (-not $Source) {
  $Source = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
}

if (-not $DshHome) {
  $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
}
$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$manifestPath = Join-Path $profileDir 'package.json'
if (-not (Test-Path $manifestPath)) {
  throw "no profile manifest at $manifestPath; boot the profile once so dsh creates it"
}
if (-not (Test-Path (Join-Path $Source 'cordis.patch.yml'))) {
  throw "$Source does not look like the plugin package (no cordis.patch.yml)"
}

$target = Join-Path (Join-Path $profileDir 'node_modules') $packageName
if (Test-Path $target) {
  if (-not $Force) { throw "$target already exists; re-run with -Force to replace it" }
  Remove-Item $target -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($item in @('package.json', 'cordis.patch.yml', 'README.md', 'README.zh.md')) {
  $from = Join-Path $Source $item
  if (Test-Path $from) { Copy-Item $from (Join-Path $target $item) -Force }
}
Copy-Item (Join-Path $Source 'lib') (Join-Path $target 'lib') -Recurse -Force
Write-Host "installed $packageName -> $target"

# A profile's bundle list is its composition order. The plugin only reads and
# extends what earlier bundles mounted, so it belongs last.
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$bundles = @($manifest.dsh.profile.bundles)
if ($bundles -contains $packageName) {
  Write-Host "bundle already registered in $manifestPath"
} else {
  $manifest.dsh.profile.bundles = @($bundles + $packageName)
  $json = $manifest | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "registered bundle in $manifestPath"
}
Write-Host ''
Write-Host 'Restart dsh, then look for these lines at startup:'
Write-Host '  [opencode-go-model-list] mounted: route=opencode-go ...'
Write-Host '  [opencode-go-model-list] gateway=38, catalog=37 -> 11 contributed (27 already served)'
Write-Host ''
Write-Host 'Uninstall with: powershell -ExecutionPolicy Bypass -File .\uninstall.ps1'
