# Attach Frida to running game (avoid spawn anti-debug)
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$adb = "C:\Program Files\Netease\MuMu\nx_main\adb.exe"
$device = "127.0.0.1:16384"
$pkg = "com.pinkcore.tkfm"

if (-not (Test-Path $adb)) {
    Write-Host "MuMu adb not found: $adb" -ForegroundColor Red
    exit 1
}

function Invoke-AdbText {
    param([string[]]$AdbArgs)
    try {
        $out = & $adb @AdbArgs 2>&1
    } catch {
        return ""
    }
    if ($null -eq $out) { return "" }
    if ($out -is [System.Array]) { return ($out -join "`n").Trim() }
    return "$out".Trim()
}

function Ensure-Device {
    Invoke-AdbText -AdbArgs @("connect", $device) | Out-Null
    Invoke-AdbText -AdbArgs @("-s", $device, "root") | Out-Null
    Start-Sleep -Milliseconds 500
}

function Test-FridaServer {
    $pid = Invoke-AdbText -AdbArgs @("-s", $device, "shell", "pidof frida-server")
    return [bool]$pid
}

function Test-PidAlive {
    param([int]$ProcId)
    return (Invoke-AdbText -AdbArgs @("-s", $device, "shell", "kill -0 $ProcId 2>/dev/null && echo ok") -eq "ok")
}

function Test-HasIl2Cpp {
    param([int]$ProcId)
    $out = Invoke-AdbText -AdbArgs @(
        "-s", $device, "shell",
        "if [ -r /proc/$ProcId/maps ]; then grep -E 'libil2cpp\.so|libunity\.so' /proc/$ProcId/maps 2>/dev/null | head -1; fi"
    )
    return [bool]$out
}

function Get-GamePids {
    $raw = Invoke-AdbText -AdbArgs @("-s", $device, "shell", "ps -A -o PID,RSS,NAME | grep $pkg")
    $procs = @()
    foreach ($line in ($raw -split "`n")) {
        $line = $line.Trim()
        if (-not $line) { continue }
        $t = $line -split '\s+', 3
        if ($t.Count -lt 2 -or $t[0] -notmatch '^\d+$') { continue }
        $id = [int]$t[0]
        $rss = 0
        [void][int]::TryParse($t[1], [ref]$rss)
        $procs += [pscustomobject]@{ PID = $id; RSS = $rss; HasIl2Cpp = $false }
    }
    if ($procs.Count -eq 0) {
        $pidof = Invoke-AdbText -AdbArgs @("-s", $device, "shell", "pidof $pkg")
        foreach ($id in ($pidof -split '\s+')) {
            if ($id -match '^\d+$') {
                $procs += [pscustomobject]@{ PID = [int]$id; RSS = 0; HasIl2Cpp = $false }
            }
        }
    }
    return @($procs | Sort-Object RSS -Descending)
}

function Try-Attach {
    param([int]$ProcId)
    for ($i = 1; $i -le 3; $i++) {
        if (-not (Test-PidAlive $ProcId)) {
            Write-Host "    PID $ProcId not alive (try $i)" -ForegroundColor DarkYellow
            return $false
        }
        Write-Host "    frida attach attempt $i ..." -ForegroundColor Gray
        frida -D $device -p $ProcId -l scripts/frida_dump_metadata.js
        if ($LASTEXITCODE -eq 0) { return $true }
        Start-Sleep -Milliseconds 800
    }
    return $false
}

Ensure-Device

if (-not (Test-FridaServer)) {
    Write-Host "frida-server not running. Start it first:" -ForegroundColor Yellow
    Write-Host "  python scripts/setup_mumu_frida.py" -ForegroundColor Cyan
    Write-Host ""
}

$all = @(Get-GamePids)
if ($all.Count -eq 0) {
    Write-Host ""
    Write-Host "Game not running. Open Tenka in MuMu, wait for main menu." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

foreach ($p in $all) {
    if (Test-PidAlive $p.PID) {
        $p | Add-Member -NotePropertyName HasIl2Cpp -NotePropertyValue (Test-HasIl2Cpp $p.PID) -Force
    }
}

$candidates = @($all | Where-Object { $_.HasIl2Cpp })
if ($candidates.Count -eq 0) { $candidates = @($all) }

Write-Host "Found processes:" -ForegroundColor Cyan
foreach ($p in $all) {
    $tag = if ($p.HasIl2Cpp) { " [il2cpp]" } else { "" }
    Write-Host "  PID $($p.PID)  RSS $($p.RSS) KB$tag"
}

if (-not ($all | Where-Object { $_.HasIl2Cpp })) {
    Write-Host ""
    Write-Host "No il2cpp in any PID yet - enter castle UI, click Summon, re-run." -ForegroundColor Yellow
    Write-Host ""
}

$attached = $false
foreach ($proc in $candidates) {
    Write-Host ">>> Attach PID $($proc.PID) ..." -ForegroundColor Cyan
    if (Try-Attach $proc.PID) {
        $attached = $true
        break
    }
}

if (-not $attached) {
    Write-Host ""
    Write-Host "Frida attach blocked (AppGuard anti-debug). Use adb memory dump instead:" -ForegroundColor Yellow
    Write-Host "  python scripts/dump_metadata_adb.py" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Manual Frida (usually fails on this game):" -ForegroundColor Gray
    $best = ($candidates | Select-Object -First 1).PID
    if (-not $best) { $best = ($all | Select-Object -First 1).PID }
    Write-Host "  frida -D $device -p $best -l scripts/frida_dump_metadata.js" -ForegroundColor DarkGray
    exit 1
}
