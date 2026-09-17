<#
.SYNOPSIS
Remove dsh-opencode-go-model-list from a dsh profile.

.DESCRIPTION
Unregisters the bundle, deletes the installed package, and with -RemoveCache the
fetched catalog cache too. The shipped pi-ai catalog is never modified on disk,
so removing the plugin restores the previous model list exactly.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web',
  [string]$DshHome = '',
  [switch]$RemoveCache
)

$ErrorActionPreference = 'Stop'
$packageName = 'dsh-opencode-go-model-list'
if (-not $DshHome) {
  $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
}
$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$manifestPath = Join-Path $profileDir 'package.json'
if (Test-Path $manifestPath) {
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $bundles = @($manifest.dsh.profile.bundles) | Where-Object { $_ -ne $packageName }
  $manifest.dsh.profile.bundles = @($bundles)
  [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "unregistered bundle in $manifestPath"
}
$target = Join-Path (Join-Path $profileDir 'node_modules') $packageName
if (Test-Path $target) { Remove-Item $target -Recurse -Force; Write-Host "removed $target" }
if ($RemoveCache) {
  $cache = Join-Path (Join-Path $DshHome 'cache') $packageName
  if (Test-Path $cache) { Remove-Item $cache -Recurse -Force; Write-Host "removed $cache" }
}
Write-Host 'Restart dsh to serve the shipped catalog again.'
