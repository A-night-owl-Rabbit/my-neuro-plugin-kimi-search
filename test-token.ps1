param(
    [Parameter(Mandatory=$true)]
    [string]$Token,

    [string]$BaseUrl = "http://localhost:8000/v1",
    [string]$Model = "kimi-search-silent",
    [string]$Query = "What is the date today? Please answer in one sentence with the source.",
    [switch]$SkipWriteConfig
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ConfigPath = Join-Path $ScriptDir "plugin_config.json"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "===== Kimi-Search plugin token test =====" -ForegroundColor Cyan
Write-Host "Backend  : $BaseUrl" -ForegroundColor Gray
Write-Host "Model    : $Model" -ForegroundColor Gray
$preview = $Token.Substring(0, [Math]::Min(20, $Token.Length))
Write-Host "Token    : $preview...(len=$($Token.Length))" -ForegroundColor Gray
Write-Host ""

Write-Host "[1/3] Checking backend ..." -ForegroundColor Yellow
try {
    $pingUrl = ($BaseUrl -replace '/v1$','') + '/ping'
    $ping = Invoke-WebRequest -Uri $pingUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($ping.StatusCode -eq 200) {
        Write-Host "  OK backend online" -ForegroundColor Green
    } else {
        Write-Host "  ! ping status $($ping.StatusCode), continuing" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  X cannot connect to $BaseUrl" -ForegroundColor Red
    Write-Host "    Start it with: cd k:\neruo\_kimi-free-api ; node dist/index.js" -ForegroundColor Red
    exit 1
}

Write-Host "[2/3] Calling Kimi (with web search) ..." -ForegroundColor Yellow
$body = @{
    model = $Model
    messages = @(@{ role = "user"; content = $Query })
    use_search = $true
    stream = $false
} | ConvertTo-Json -Depth 5 -Compress

try {
    $resp = Invoke-RestMethod -Uri "$BaseUrl/chat/completions" `
        -Method Post `
        -Headers @{ "Authorization" = "Bearer $Token"; "Content-Type" = "application/json" } `
        -Body $body `
        -TimeoutSec 90 `
        -ErrorAction Stop

    $answer = $resp.choices[0].message.content
    if (-not $answer) {
        Write-Host "  X Kimi returned empty content (token expired or rate-limited)" -ForegroundColor Red
        Write-Host ($resp | ConvertTo-Json -Depth 5)
        exit 1
    }

    Write-Host "  OK got answer ($($answer.Length) chars)" -ForegroundColor Green
    Write-Host ""
    Write-Host "----- Kimi answer -----" -ForegroundColor Magenta
    Write-Host $answer
    Write-Host "-----------------------" -ForegroundColor Magenta
    Write-Host ""
} catch {
    $msg = $_.Exception.Message
    $detail = ""
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        if ($stream) {
            $reader = New-Object System.IO.StreamReader($stream)
            $detail = $reader.ReadToEnd()
        }
    } catch {}
    Write-Host "  X call failed: $msg" -ForegroundColor Red
    if ($detail) { Write-Host "    Detail: $detail" -ForegroundColor Red }
    if ($msg -match "401|403|Unauthorized") {
        Write-Host "    >>> token invalid, please re-copy from kimi.moonshot.cn" -ForegroundColor Red
    }
    exit 1
}

if ($SkipWriteConfig) {
    Write-Host "[3/3] Skipped writing config (-SkipWriteConfig)" -ForegroundColor Yellow
} else {
    Write-Host "[3/3] Writing plugin config ..." -ForegroundColor Yellow
    if (-not (Test-Path $ConfigPath)) {
        Write-Host "  X cannot find $ConfigPath" -ForegroundColor Red
        exit 1
    }
    $rawText = Get-Content $ConfigPath -Raw -Encoding UTF8
    if ($rawText.Length -gt 0 -and $rawText[0] -eq [char]0xFEFF) { $rawText = $rawText.Substring(1) }
    $cfg = $rawText | ConvertFrom-Json
    $cfg.refresh_token.value = $Token
    if ($BaseUrl) { $cfg.base_url.value = $BaseUrl }
    if ($Model)   { $cfg.model.value = $Model }
    $jsonOut = $cfg | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($ConfigPath, $jsonOut, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  OK written to $ConfigPath (UTF-8 no BOM)" -ForegroundColor Green
}

Write-Host ""
Write-Host "===== ALL PASSED, plugin is ready =====" -ForegroundColor Cyan
