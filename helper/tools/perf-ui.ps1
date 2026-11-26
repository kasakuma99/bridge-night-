# Times the work the window does on the UI thread, with the real PC features of the TEST build (read-only calls only).
# Offscreen: the window is created but never shown. Settings and games.json go to a temp folder (BN_HELPER_DIR).
# Usage (PowerShell, from the repo folder):
#   .\helper\build.ps1 -Test
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\helper\tools\perf-ui.ps1
param([string]$Exe = (Join-Path $PSScriptRoot "..\dist\bridge-night-helper-test.exe"))
$ErrorActionPreference = "Stop"
if ((Split-Path -Leaf $Exe) -ne "bridge-night-helper-test.exe") { throw "Only the TEST build may be loaded: $Exe" }
$env:BN_HELPER_DIR = Join-Path ([IO.Path]::GetTempPath()) "bn-perf-ui"
New-Item -ItemType Directory -Force $env:BN_HELPER_DIR | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$asm = [Reflection.Assembly]::LoadFile((Resolve-Path $Exe).Path)
if ($asm.GetType("BridgeNight.Program").GetField("Id").GetRawConstantValue() -ne "BridgeNightHelperTest") { throw "This is not the TEST build" }
$fl = [Reflection.BindingFlags]"Public,NonPublic,Static,Instance"
function T($n) { $asm.GetType("BridgeNight.$n", $true) }
function Time($label, [scriptblock]$b, $n = 5) {
    & $b | Out-Null # warm up
    $sw = [Diagnostics.Stopwatch]::StartNew(); for ($i = 0; $i -lt $n; $i++) { & $b | Out-Null }
    Write-Host ("  {0,-34} {1,8:0.0} ms" -f $label, ($sw.Elapsed.TotalMilliseconds / $n))
}

# Five full-size game reports, so LastGames has a realistic file to read.
$samples = (0..299 | ForEach-Object { '{"t":"2026-11-20T21:00:00","c":40,"g":80,"mu":10,"mt":16,"vu":3,"vt":12,"dr":1,"dw":1,"nd":0.1,"nu":0.1,"mc":4,"mf":2}' }) -join ","
$one = '{"start":"2026-11-20T21:00:00","end":"2026-11-20T21:25:00","cpuAvg":40,"cpuPeak":70,"gpuAvg":80,"gpuPeak":99,"memPeak":12,"memTotal":16,"limit":"x","samples":[' + $samples + ']}'
[IO.File]::WriteAllText((Join-Path $env:BN_HELPER_DIR "games.json"), "[" + ((@($one) * 5) -join ",") + "]")

Write-Host "`n== Feature calls"
$PM = T "PerfMon"; $GM = T "GameMode"; $AC = T "AudioCtl"
Time "PerfMon.LastGames" { $PM.GetMethod("LastGames").Invoke($null, $null) }
Time "PerfMon.TopApps(6)" { $PM.GetMethod("TopApps").Invoke($null, @(6)) }
Time "GameMode.BeforeNight" { $GM.GetMethod("BeforeNight").Invoke($null, $null) }
Time "GameMode.Fixes" { $GM.GetMethod("Fixes").Invoke($null, $null) }
Time "AudioCtl.Outputs" { $AC.GetMethod("Outputs").Invoke($null, $null) }
Time "AudioCtl mic + output names" { $AC.GetProperty("MicName").GetValue($null, $null); $AC.GetProperty("MicMuted").GetValue($null, $null); $AC.GetProperty("OutputName").GetValue($null, $null) }

Write-Host "`n== Page ticks (once a second while the page is on screen)"
$s = [Activator]::CreateInstance((T "Settings")); $s.Token = "x"; $s.TourDone = $true; $s.Hotkeys = $false
$lines = New-Object 'System.Collections.Generic.List[string]'
$w = (T "MainWindow").GetConstructors()[0].Invoke(@($s.psobject.BaseObject, $lines.psobject.BaseObject, [Action[bool]] { param($p) }, [Action[string]] { param($x) }, [Action] { }))
$w.CreateControl()
function PageTick($field, $label, $tab) {
    $p = $w.GetType().GetField($field).GetValue($w)
    $w.GetType().GetMethod("ShowPage").Invoke($w, @($p))
    if ($null -ne $tab) { $p.Tab = $tab }
    $p.Shown(); Start-Sleep -Milliseconds 1500; [Windows.Forms.Application]::DoEvents()
    $sw = [Diagnostics.Stopwatch]::StartNew(); $p.Tick(); $first = $sw.Elapsed.TotalMilliseconds
    Time ("Tick " + $label + (" (first {0:0} ms)" -f $first)) { $p.Tick() } 10
    $p.Hidden()
}
PageTick "Home" "Home" $null
foreach ($t in 0, 1, 2) { PageTick "Performance" ("Performance tab " + $t) $t }
PageTick "Network" "Network" $null
PageTick "GameModeP" "Game mode" $null
PageTick "Audio" "Audio" $null
$gp = $w.GetType().GetField("GameModeP").GetValue($w)
Time "GameModePage.Shown" { $gp.Shown() }
$ub = $w.GetType().GetMethod("UpdateBadges", $fl); Time "MainWindow.UpdateBadges" { $ub.Invoke($w, $null) }
$w.Dispose()
$PM.GetMethod("StopAll", $fl).Invoke($null, $null) | Out-Null
(T "NetCheck").GetMethod("StopAll", $fl).Invoke($null, $null) | Out-Null
