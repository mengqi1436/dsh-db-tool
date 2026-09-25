# Apply or revert the DSH ResolutionRouter hotfix (dsh-app-boot routeScoped resolve.paths fix).
# Thin wrapper: all logic lives in scripts/hotfix-core.mjs (cross-platform, testable).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/apply-dsh-hotfix.ps1
#            [-DshRoot <dir>] [-PatchFile <file>] [-Force] [-Revert] [-DryRun]
param(
	[string]$DshRoot,
	[string]$PatchFile,
	[switch]$Force,
	[switch]$Revert,
	[switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$core = Join-Path $PSScriptRoot 'hotfix-core.mjs'
if (-not (Test-Path $core)) {
	Write-Error "hotfix-core.mjs not found next to this script ($PSScriptRoot)."
	exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
	Write-Error 'node is required but was not found on PATH.'
	exit 1
}

$argv = @($core)
if ($DshRoot) { $argv += @('--dsh-root', $DshRoot) }
if ($PatchFile) { $argv += @('--patch-file', $PatchFile) }
if ($Force) { $argv += '--force' }
if ($Revert) { $argv += '--revert' }
if ($DryRun) { $argv += '--dry-run' }

& $node.Source @argv
exit $LASTEXITCODE
