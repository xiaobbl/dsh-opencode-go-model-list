<#
.SYNOPSIS
Prove the plugin works inside a real dsh process, without touching your profile.

.DESCRIPTION
Creates an isolated harness home under .verify/, initializes a throwaway
'headless' profile there, links this package in as a bundle beside a probe
plugin, and boots dsh so the probe can ask the harness's own llm service for the
opencode-go route's model list.

Two runs are printed: without the plugin (the shipped catalog only) and with it
(the live catalog). The probe exits the process as soon as it has its answer, so
no model request is ever made.

.PARAMETER Proxy
Proxy URL exported to the dsh process (HTTPS_PROXY/HTTP_PROXY), for hosts whose
network reaches opencode.ai and models.dev only through one.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\scripts\verify-in-isolated-home.ps1 -Proxy http://127.0.0.1:7897
#>
[CmdletBinding()]
param(
  [string]$Proxy = '',
  [string]$Profile = 'probe'
)

$ErrorActionPreference = 'Stop'
$packageName = 'dsh-opencode-go-model-list'
$repo = Split-Path -Parent $PSScriptRoot
$dshHome = Join-Path $repo '.verify\dsh-home'
$probeSource = Join-Path $PSScriptRoot 'probe-plugin'

if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) { throw 'dsh is not on PATH' }

# 1. An isolated harness home: nothing here is your profile.
New-Item -ItemType Directory -Force -Path $dshHome | Out-Null
$env:DSH_HOME = $dshHome
$profileDir = Join-Path (Join-Path $dshHome 'profiles') $Profile
if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
  dsh --profile $Profile --from-default-profile headless | Out-Null
}

# 2. A minimal settings.yaml: the route has to exist before any adapter owns it.
$settings = @'
# Verification-only settings: the opencode-go route, with a placeholder key so
# the headless app starts. The probe exits before any model request is made.
agent-default-model:
  provider: opencode-go
  model: deepseek-v4-flash-vision-exp
llm-pi-ai:
  providers:
    opencode-go:
      apiKeyEnv: OPENCODE_GO_API_KEY
'@
[System.IO.File]::WriteAllText((Join-Path $dshHome 'settings.yaml'), $settings, (New-Object System.Text.UTF8Encoding($false)))

# 3. Link the package and the probe into the throwaway profile.
$modules = Join-Path $profileDir 'node_modules'
New-Item -ItemType Directory -Force -Path $modules | Out-Null
foreach ($pair in @(@{ name = $packageName; target = $repo }, @{ name = 'dsh-model-list-probe'; target = $probeSource })) {
  $link = Join-Path $modules $pair.name
  if (Test-Path $link) { cmd /c rmdir "$link" | Out-Null }
  New-Item -ItemType Junction -Path $link -Target $pair.target | Out-Null
}

$manifestPath = Join-Path $profileDir 'package.json'
$patchPath = Join-Path $PSScriptRoot 'probe.patch.yml'
$patchYaml = @'
- insert:
    - id: model-list-probe
      name: 'dsh-model-list-probe'
'@
[System.IO.File]::WriteAllText($patchPath, $patchYaml, (New-Object System.Text.UTF8Encoding($false)))

function Set-Bundles([string[]]$bundles) {
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $manifest.dsh.profile.bundles = $bundles
  [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
}

if ($Proxy) { $env:HTTPS_PROXY = $Proxy; $env:HTTP_PROXY = $Proxy }
$env:OPENCODE_GO_API_KEY = 'verification-placeholder'

$base = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless')

# One boot, with its output redirected at the OS level: dsh writes its own
# diagnostics to stderr, and PowerShell would turn those lines into terminating
# errors under ErrorActionPreference = 'Stop'.
function Invoke-Probe([string]$name, [int]$deadlineMs) {
  $log = Join-Path $repo ('.verify\run-' + $name + '.log')
  $env:PROBE_DEADLINE_MS = [string]$deadlineMs
  $inner = 'dsh --profile ' + $Profile + ' --patch "' + $patchPath + '" "list models" > "' + $log + '" 2>&1'
  cmd /c $inner | Out-Null
  Get-Content $log | Select-String -Pattern '\[probe\]|opencode-go-model-list' | ForEach-Object { $_.Line }
}

Write-Host '===== without the plugin (shipped catalog) ====='
# The baseline has nothing to wait for: long enough to list the shipped catalog
# and no longer.
Set-Bundles $base
Invoke-Probe 'baseline' 25000

Write-Host ''
Write-Host '===== with the plugin (live catalog) ====='
Set-Bundles ($base + $packageName)
Invoke-Probe 'plugin' 90000
