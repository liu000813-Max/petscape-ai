param(
    [Parameter(Position = 0)]
    [ValidateSet('install', 'start', 'test', 'status', 'stop')]
    [string]$Action = 'status',
    [string]$NodePath
)

$ErrorActionPreference = 'Stop'
$nodeCandidates = @()
if ($NodePath) {
    $nodeCandidates += $NodePath
} else {
    if ($env:PETSCAPE_NODE_BIN) { $nodeCandidates += $env:PETSCAPE_NODE_BIN }
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
    $nodeCandidates += Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
}

$selectedNode = $null
foreach ($candidate in $nodeCandidates) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    $version = & $candidate --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.(\d+)\.') { continue }
    if ([int]$Matches[1] -gt 24 -or ([int]$Matches[1] -eq 24 -and [int]$Matches[2] -ge 7)) {
        $selectedNode = $candidate
        break
    }
}
if (-not $selectedNode) { throw 'Node >=24.7 is required. Pass -NodePath or set PETSCAPE_NODE_BIN.' }

& $selectedNode (Join-Path $PSScriptRoot 'local-postgres.mjs') $Action
exit $LASTEXITCODE
