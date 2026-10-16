param(
    [string]$DevtoolsCli = 'C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat',
    [string]$OutputRoot = 'G:\Max麦麦\codex\petscape-dev-runtime\wechat-previews'
)

$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../miniapp'))
if (-not (Test-Path -LiteralPath $DevtoolsCli -PathType Leaf)) { throw 'WeChat official CLI not found; pass -DevtoolsCli.' }
$runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$run = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) $runId
New-Item -Path $run -ItemType Directory -ErrorAction Stop | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $run /inheritance:r /grant:r ($identity + ':(OI)(CI)F') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to protect preview output directory.' }
$qr = Join-Path $run 'preview.png'
$info = Join-Path $run 'official-info.json'
$output = & $DevtoolsCli preview --project $project --qr-format image --qr-output $qr --info-output $info 2>&1 | Out-String
$cliExitCode = $LASTEXITCODE
[IO.File]::WriteAllText((Join-Path $run 'cli.log'), $output, [Text.UTF8Encoding]::new($false))
$reason = 'cli-failed'
if ($output -match 'service port disabled|服务端口已关闭') { $reason = 'service-port-disabled' }
elseif ($output -match 'wait IDE port timeout') { $reason = 'ide-port-timeout' }
$validPng = $false
if (Test-Path -LiteralPath $qr -PathType Leaf) {
    $bytes = [IO.File]::ReadAllBytes($qr)
    $validPng = $bytes.Length -gt 8 -and [BitConverter]::ToString($bytes, 0, 8).Replace('-', '') -eq '89504E470D0A1A0A'
}
# Some Windows official CLI versions return exit 0 even when initialization fails.
$success = $cliExitCode -eq 0 -and $output -notmatch '\[error\]|initialize error' -and $validPng
$receipt = [ordered]@{
    runId = $runId
    recordedAt = [DateTimeOffset]::Now.ToString('o')
    status = $(if ($success) { 'preview-generated' } else { 'failed' })
    reason = $(if ($success) { $null } else { $reason })
    cliExitCode = $cliExitCode
    qrSha256 = $(if ($success) { (Get-FileHash -LiteralPath $qr -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null })
    phoneVerified = $false
}
$receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $run 'receipt.json') -Encoding utf8
if (-not $success) { throw "WeChat preview failed ($reason); private diagnostics: $run. No new QR delivered." }
Write-Output "WeChat preview generated: $qr"
Write-Output 'Scan with an authorized WeChat account; phone verification and experience upload are separate steps.'
