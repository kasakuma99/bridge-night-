# Self-test of the PC features (PcServices.cs and the Pc*.cs files) WITHOUT starting the helper.
# Loads the TEST build, calls only read-only functions and checks the pure logic. It never mutes the mic,
# switches the output, changes the power plan, monitor, mouse, Sticky Keys or app volumes, closes apps,
# keeps hotkeys registered, or downloads/installs an update. Its files go to a temp folder (BN_HELPER_DIR),
# never to %APPDATA%\BridgeNightHelper.
#
# Usage (PowerShell, from the repo folder):
#   .\helper\build.ps1 -Test
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\helper\tools\selftest.ps1
param([string]$Exe = (Join-Path $PSScriptRoot "..\dist\bridge-night-helper-test.exe"), [switch]$Quick)
$ErrorActionPreference = "Stop"

if ((Split-Path -Leaf $Exe) -ne "bridge-night-helper-test.exe") { throw "Only the TEST build may be loaded: $Exe" }
$Exe = (Resolve-Path $Exe).Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) ("bn-selftest-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force $scratch | Out-Null
$env:BN_HELPER_DIR = $scratch

$asm = [Reflection.Assembly]::LoadFile($Exe)
$flags = [Reflection.BindingFlags]"Public,NonPublic,Static"
function T([string]$name) { $asm.GetType("BridgeNight.$name", $true) }
function Invoke-Pc([string]$type, [string]$name, [object[]]$a = @()) {
    for ($i = 0; $i -lt $a.Length; $i++) { if ($a[$i] -is [psobject]) { $a[$i] = $a[$i].PSObject.BaseObject } } # PowerShell wrappers off
    (T $type).GetMethod($name, $flags).Invoke($null, $a)
}
function Get-Pc([string]$type, [string]$name) { (T $type).GetProperty($name, $flags).GetValue($null, $null) }
function Get-PcField([string]$type, [string]$name) { (T $type).GetField($name, $flags).GetValue($null) }
function New-Pc([string]$name) { [Activator]::CreateInstance((T $name)) }
function New-List([string]$name) { ,[Activator]::CreateInstance([Collections.Generic.List`1].MakeGenericType((T $name))) }

if ((T "Program").GetField("Id").GetRawConstantValue() -ne "BridgeNightHelperTest") { throw "This is not the TEST build" }
$dirNow = (T "Settings").GetProperty("Dir").GetValue($null, $null)
if ($dirNow -ne $scratch) { throw "Settings.Dir is $dirNow, expected the scratch folder" }

$script:fails = 0
function Check([string]$what, [bool]$ok) {
    if ($ok) { Write-Host ("  ok    " + $what) } else { Write-Host ("  FAIL  " + $what) -ForegroundColor Red; $script:fails++ }
}
function Show([string]$label, $value) { Write-Host ("  " + $label.PadRight(22) + " " + $value) }

# Start with everything that could change the PC switched off (no hotkeys, no auto update, no game mode).
$logQ = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
$logged = New-Object 'System.Collections.Generic.List[string]'
$log = [Delegate]::CreateDelegate([Action[string]], $logQ, "Enqueue")
$settings = New-Pc "Settings"
$settings.Hotkeys = $false; $settings.AutoUpdate = $false; $settings.GameModeAuto = $false
$settings.MusicQuieter = $false; $settings.RecordLastGame = $false
if ($settings.PSObject.Properties["PowerPlanInGame"]) { $settings.PowerPlanInGame = $false } # gone in 0.7
Invoke-Pc "PcServices" "Start" @($settings, $log) | Out-Null

try {
    Write-Host "`n== Pure logic"
    Check "version 0.7.1 > 0.7.0" ((Invoke-Pc Updater CompareVersions @("0.7.1", "0.7.0")) -gt 0)
    Check "version 0.7.0 = 0.7.0" ((Invoke-Pc Updater CompareVersions @("0.7.0", "0.7.0")) -eq 0)
    Check "version 0.10.0 > 0.9.9" ((Invoke-Pc Updater CompareVersions @("0.10.0", "0.9.9")) -gt 0)
    Check "version 0.7 = 0.7.0" ((Invoke-Pc Updater CompareVersions @("0.7", "0.7.0")) -eq 0)
    Check "junk version is older" ((Invoke-Pc Updater CompareVersions @("abc", "0.7.0")) -lt 0)
    Check "0.6.9 < 0.7.0" ((Invoke-Pc Updater CompareVersions @("0.6.9", "0.7.0")) -lt 0)

    $hex = "AB" * 32
    Check "sha file: first token, lower case" ((Invoke-Pc Updater ParseSha @("$hex  bridge-night-helper.exe`r`n")) -eq $hex.ToLower())
    Check "sha file: BOM and star" ((Invoke-Pc Updater ParseSha @(([char]0xFEFF) + "$hex *bridge-night-helper.exe")) -eq $hex.ToLower())
    Check "sha file: too short is refused" ($null -eq (Invoke-Pc Updater ParseSha @("abc123  x.exe")))
    Check "sha file: empty is refused" ($null -eq (Invoke-Pc Updater ParseSha @("")))
    $shaFile = Get-Content "$Exe.sha256" -Raw
    Check "sha file from build.ps1 matches the exe" ((Invoke-Pc Updater ParseSha @($shaFile)) -eq (Get-FileHash $Exe -Algorithm SHA256).Hash.ToLower())

    $good = "https://github.com/kasakuma99/bridge-night-/releases/download/helper-v0.7.1/bridge-night-helper.exe"
    Check "url: own release download allowed" (Invoke-Pc Updater AllowedUrl @($good))
    Check "url: http refused" (-not (Invoke-Pc Updater AllowedUrl @($good.Replace("https:", "http:"))))
    Check "url: other repo refused" (-not (Invoke-Pc Updater AllowedUrl @("https://github.com/kasakuma99/bridge-night-x/releases/download/a/b.exe")))
    Check "url: other host refused" (-not (Invoke-Pc Updater AllowedUrl @("https://evil.example/kasakuma99/bridge-night-/releases/download/a.exe")))
    Check "url: .. refused" (-not (Invoke-Pc Updater AllowedUrl @("https://github.com/kasakuma99/bridge-night-/releases/download/../../x/y.exe")))
    Check "url: null refused" (-not (Invoke-Pc Updater AllowedUrl @($null)))
    Check "notes: markdown marks dropped" ((Invoke-Pc Updater PlainNotes @("## New`n- **Faster** [site](https://x)")) -eq ("New`n" + [char]0x2022 + " Faster site"))
    Check "ago: minutes" ((Invoke-Pc Updater Ago @([TimeSpan]::FromMinutes(2))) -eq "2 min ago")

    $home_ = [Environment]::GetFolderPath("UserProfile")
    $dirty = "Access to the path '$home_\AppData\x.exe' is denied. " + [Environment]::UserName + " on " + [Environment]::MachineName + " via 192.168.1.1, mail a.b@example.com"
    $clean = Invoke-Pc PcServices Scrub @($dirty)
    Show "scrubbed" $clean
    Check "scrub: no user folder" ($clean.IndexOf($home_, [StringComparison]::OrdinalIgnoreCase) -lt 0)
    Check "scrub: no user or PC name" ($clean -notmatch ("\b(" + [Regex]::Escape([Environment]::UserName) + "|" + [Regex]::Escape([Environment]::MachineName) + ")\b"))
    Check "scrub: no IP or email" ($clean -notmatch '\d{1,3}(\.\d{1,3}){3}' -and $clean -notmatch '@')
    Check "scrub: version numbers stay" ((Invoke-Pc PcServices Scrub @("Helper is up to date (0.7.0)")) -eq "Helper is up to date (0.7.0)")

    function Sample($cpu, $gpu, $mem, $total, [float[]]$threads = @()) {
        $s = New-Pc "PerfSample"; $s.At = [DateTime]::Now
        if ($null -ne $cpu) { $s.Cpu = [float]$cpu }; if ($null -ne $gpu) { $s.Gpu = [float]$gpu }
        $s.MemUsedGb = $mem; $s.MemTotalGb = $total; $s.CpuThreads = $threads; $s
    }
    $big = New-List "PerfSample"; for ($i = 0; $i -lt 1000; $i++) { $x = Sample $i 10 4 16; $big.Add($x) }
    $thin = Invoke-Pc PerfMon Thin @($big, 300)
    Check "thin: 1000 -> 300" ($thin.Count -eq 300)
    Check "thin: keeps first and last" ($thin[0].Cpu -eq 0 -and $thin[299].Cpu -eq 999)
    $small = New-List "PerfSample"; for ($i = 0; $i -lt 50; $i++) { $small.Add((Sample 5 5 4 16)) }
    Check "thin: 50 stays 50" ((Invoke-Pc PerfMon Thin @($small, 300)).Count -eq 50)

    $cpuB = New-List "PerfSample"; for ($i = 0; $i -lt 20; $i++) { $cpuB.Add((Sample 60 50 6 16 @([float]20, [float]99))) }
    $gpuB = New-List "PerfSample"; for ($i = 0; $i -lt 20; $i++) { $gpuB.Add((Sample 40 99 6 16)) }
    $memB = New-List "PerfSample"; for ($i = 0; $i -lt 20; $i++) { $memB.Add((Sample 40 40 15.5 16)) }
    $fine = New-List "PerfSample"; for ($i = 0; $i -lt 20; $i++) { $fine.Add((Sample 30 40 6 16)) }
    Check "limit: one busy thread = CPU-bound" ((Invoke-Pc PerfMon LimitText @($cpuB, [float]16)).StartsWith("CPU-bound"))
    Check "limit: GPU-bound" ((Invoke-Pc PerfMon LimitText @($gpuB, [float]16)).StartsWith("GPU-bound"))
    Check "limit: memory full" ((Invoke-Pc PerfMon LimitText @($memB, [float]16)).StartsWith("Memory full"))
    Check "limit: nothing" ((Invoke-Pc PerfMon LimitText @($fine, [float]16)).StartsWith("Nothing"))

    $tipMem = Invoke-Pc PerfMon TipText @((Sample 20 20 15 16), "chrome", [float]2.14)
    Check "tip: memory names the biggest app" ($tipMem -eq "Memory is almost full: chrome holds 2.1 GB")
    Check "tip: CPU at the limit" ((Invoke-Pc PerfMon TipText @((Sample 95 20 4 16), $null, [float]0)).StartsWith("The processor"))
    Check "tip: nothing to say" ($null -eq (Invoke-Pc PerfMon TipText @((Sample 20 20 4 16), $null, [float]0)))

    $start = [DateTime]::Now.AddMinutes(-30)
    $report = Invoke-Pc PerfMon BuildReport @($gpuB, $start, [DateTime]::Now)
    Check "report: averages and peaks" ($report.CpuAvg -eq 40 -and $report.GpuPeak -eq 99 -and $report.MemPeakGb -eq 6)
    Invoke-Pc PerfMon SaveReport @($report) | Out-Null
    $games = Invoke-Pc PerfMon LastGames
    Check "games.json: saved and read back" ($games.Count -eq 1 -and $games[0].Limit -eq $report.Limit -and $games[0].Samples.Count -eq 20)
    Check "games.json: in the scratch folder" (Test-Path (Join-Path $scratch "games.json"))

    $ok = $false
    $v = (T "NetCheck").GetMethod("Verdict", $flags)
    function Verdict($n, $ping, $jit, $loss, $wifi) { $a = [object[]]@($n, $ping, $jit, [float]$loss, $wifi, $null); $t = $v.Invoke($null, $a); @($t, $a[5]) }
    $r = Verdict 60 25 3 0 $false; Check "verdict: all good" ($r[0] -eq "All good" -and $r[1])
    $r = Verdict 60 25 3 5 $true;  Check "verdict: Wi-Fi drops packets" ($r[0].StartsWith("Your Wi-Fi is dropping packets") -and -not $r[1])
    $r = Verdict 60 140 3 0 $false; Check "verdict: high ping" ($r[0].StartsWith("High ping") -and -not $r[1])
    $r = Verdict 60 30 25 0 $false; Check "verdict: jitter" ($r[0].StartsWith("Your ping jumps") -and -not $r[1])
    $r = Verdict 10 $null $null 100 $false; Check "verdict: no answer" ($r[0].StartsWith("No answer"))
    $kv = [Collections.Generic.KeyValuePair[DateTime, Nullable[int]]]
    $pl = New-Object -TypeName "System.Collections.Generic.List[System.Collections.Generic.KeyValuePair[DateTime, Nullable[int]]]"
    foreach ($p in @(20, 30, $null, 20)) { $pl.Add((New-Object $kv ([DateTime]::Now), $p)) }
    $rep = Invoke-Pc NetCheck Report @($pl, 20, $false)
    Check "net report: jitter = mean abs diff (10)" ($rep.JitterMs -eq 10)
    Check "net report: loss 25 %" ($rep.LossPercent -eq 25)
    Check "private: 192.168.1.1" (Invoke-Pc NetCheck IsPrivate @([Net.IPAddress]::Parse("192.168.1.1")))
    Check "private: 100.64.0.1 (CGNAT)" (Invoke-Pc NetCheck IsPrivate @([Net.IPAddress]::Parse("100.64.0.1")))
    Check "public: 104.160.141.3" (-not (Invoke-Pc NetCheck IsPrivate @([Net.IPAddress]::Parse("104.160.141.3"))))

    Write-Host "`n== Performance (live, read-only)"
    (T "PerfMon").GetProperty("IntervalSeconds").SetValue($null, 1, $null)
    Invoke-Pc PerfMon Start @("selftest") | Out-Null
    Invoke-Pc PerfMon Start @("selftest2") | Out-Null
    Invoke-Pc NetCheck Start @("selftest") | Out-Null
    $apps1 = Invoke-Pc PerfMon TopApps @(8) # first call: CPU per app needs a second one
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 20 -and (Invoke-Pc PerfMon History @(60)).Count -lt 3) { Start-Sleep -Milliseconds 200 }
    Show "3 samples after" ("{0:0.0} s" -f $sw.Elapsed.TotalSeconds)
    $s = Get-Pc PerfMon Latest
    if ($null -eq $s) { Check "a sample arrived" $false } else {
        Show "CPU %" $s.Cpu; Show "GPU %" $s.Gpu; Show "GPU temp C (AMD)" $s.GpuTempC
        Show "memory GB" ("{0:0.0} of {1:0.0} (cached {2:0.0}, free {3:0.0})" -f $s.MemUsedGb, $s.MemTotalGb, $s.MemCachedGb, $s.MemFreeGb)
        Show "VRAM GB" ("{0} of {1}" -f $s.VramUsedGb, $s.VramTotalGb)
        Show "CPU threads" (($s.CpuThreads | ForEach-Object { [int]$_ }) -join " ")
        Show "disk MB/s" ("read {0:0.00} write {1:0.00}" -f $s.DiskReadMBs, $s.DiskWriteMBs)
        Show "network MB/s" ("down {0:0.000} up {1:0.000}" -f $s.NetDownMBs, $s.NetUpMBs)
        Check "CPU measured" ($null -ne $s.Cpu)
        Check "memory measured" ($s.MemTotalGb -gt 0)
        Check "per-thread CPU measured" ($s.CpuThreads.Length -eq [Environment]::ProcessorCount)
    }
    Show "history (60 s)" (Invoke-Pc PerfMon History @(60)).Count
    Show "tip" (Invoke-Pc PerfMon Tip)
    $apps = Invoke-Pc PerfMon TopApps @(8)
    foreach ($a in $apps) { Show ("app " + $a.Name) ("{0:0.00} GB  cpu {1:0.0} %  close={2}" -f $a.MemGb, $a.CpuPercent, $a.CanClose) }
    Check "top apps listed" ($apps.Count -gt 0)
    Check "Windows Explorer never offered Close" (-not ($apps | Where-Object { $_.Name -eq "explorer" -and $_.CanClose }))
    $startup = Invoke-Pc PerfMon StartupApps
    foreach ($a in $startup) { Show "starts with Windows" ($a.Name + " (" + $a.Where + ")") }
    foreach ($d in (Invoke-Pc PerfMon Drives)) { Show ("drive " + $d.Name) ("{0:0} GB free of {1:0}" -f $d.FreeGb, $d.TotalGb) }
    Show "uptime" (Get-Pc PerfMon Uptime)
    Show "restart pending" (Get-Pc PerfMon RestartPending)

    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 10 -and $null -eq (Get-Pc PerfMon OpenApps)) { Start-Sleep -Milliseconds 200 }
    $open = Get-Pc PerfMon OpenApps
    $skip = "ApplicationFrameHost", "TextInputHost", "ShellExperienceHost", "StartMenuExperienceHost", "SearchHost", "explorer"
    $byNet = @{} # the slow way, Process.MainWindowHandle per process, to compare
    foreach ($pr in [Diagnostics.Process]::GetProcesses()) { try { if ($pr.MainWindowHandle -ne [IntPtr]::Zero -and $pr.MainWindowTitle -ne "" -and $skip -notcontains $pr.ProcessName) { $byNet[$pr.ProcessName] = 1 } } catch {}; $pr.Dispose() }
    Show "open apps" ("{0} (MainWindowHandle way: {1})" -f $open, $byNet.Count)
    Check "open apps counted" ($null -ne $open -and $open -ge 0)
    Check "open apps match the MainWindowHandle way (+-1)" ($null -ne $open -and [Math]::Abs($open - $byNet.Count) -le 1)

    # The window calls these on its UI thread: after the first call they must return at once from the cache.
    $fast = [ordered]@{
        "TopApps"     = { Invoke-Pc PerfMon TopApps @(6) }
        "OpenApps"    = { Get-Pc PerfMon OpenApps }
        "LastGames"   = { Invoke-Pc PerfMon LastGames }
        "StartupApps" = { Invoke-Pc PerfMon StartupApps }
        "Drives"      = { Invoke-Pc PerfMon Drives }
        "Tip"         = { Invoke-Pc PerfMon Tip }
    }
    foreach ($k in $fast.Keys) {
        & $fast[$k] | Out-Null
        $sw = [Diagnostics.Stopwatch]::StartNew(); & $fast[$k] | Out-Null; $ms = $sw.Elapsed.TotalMilliseconds
        Check ("{0} second call is fast ({1:0.00} ms < 5)" -f $k, $ms) ($ms -lt 5)
    }

    Invoke-Pc PerfMon Stop @("selftest") | Out-Null
    Start-Sleep -Milliseconds 1500
    Check "sampler keeps running while one caller is left" ($null -ne (Get-PcField PerfMon sampler))
    Invoke-Pc PerfMon Stop @("selftest2") | Out-Null
    Start-Sleep -Milliseconds 2500
    Check "sampler stops after the last caller" ($null -eq (Get-PcField PerfMon sampler))

    Write-Host "`n== Network (pings only)"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 20 -and $null -eq (Get-Pc NetCheck Current).PingMs) { Start-Sleep -Milliseconds 300 }
    Start-Sleep -Seconds 3
    $n = Get-Pc NetCheck Current
    Show "pinging" (Get-Pc NetCheck TargetName)
    Show "ping / jitter / loss" ("{0} ms / {1} ms / {2:0} %" -f $n.PingMs, $n.JitterMs, $n.LossPercent)
    Show "verdict" ("{0} (ok={1})" -f $n.Verdict, $n.Ok)
    Check "EUW answers pings" ($null -ne $n.PingMs)
    if (-not $Quick) {
        Invoke-Pc NetCheck TraceNow | Out-Null
        $until = (Get-Date).AddSeconds(60)
        Start-Sleep -Milliseconds 300
        while ((Get-Pc NetCheck Tracing) -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 500 }
        foreach ($h in (Get-Pc NetCheck Hops)) { Show ("hop " + $h.Name) ("{0} ms, loss {1:0} %" -f $h.Ms, $h.LossPercent) }
        Check "trace has 4 hops" ((Get-Pc NetCheck Hops).Count -eq 4)
    }
    Invoke-Pc NetCheck Stop @("selftest") | Out-Null
    Start-Sleep -Milliseconds 1500
    Check "pinger stops after the last caller" ($null -eq (Get-PcField NetCheck pinger))

    Write-Host "`n== Game mode (checks only, no fixes applied)"
    Invoke-Pc GameMode BeforeNight | Out-Null
    Start-Sleep -Seconds 3 # the League version is read in the background
    foreach ($c in (Invoke-Pc GameMode BeforeNight)) { Show ("before " + $c.Id) ("{0} | {1} | problem={2}" -f $c.Title, $c.Detail, $c.Problem) }
    foreach ($c in (Invoke-Pc GameMode Fixes)) { Show ("fix " + $c.Id) ("{0} | {1} | button '{2}'" -f $c.Title, $c.Detail, $c.FixLabel) }
    Check "three gamer checks" ((Invoke-Pc GameMode Fixes).Count -eq 3)
    Check "game mode not active" (-not (Get-Pc GameMode Active))

    Write-Host "`n== Audio (read-only)"
    Show "mic" (Get-Pc AudioCtl MicName)
    Show "mic muted" (Get-Pc AudioCtl MicMuted)
    Show "mic level" (Get-Pc AudioCtl MicLevel)
    foreach ($o in (Invoke-Pc AudioCtl Outputs)) { Show "output" ("{0}{1}" -f $o.Name, $(if ($o.IsDefault) { "  (default)" } else { "" })) }
    Show "output now" (Get-Pc AudioCtl OutputName)
    Show "music sessions" ((Invoke-Pc AudioSessions MusicSessions | ForEach-Object { $_.App }) -join ", ")
    Check "an output device is found" ((Invoke-Pc AudioCtl Outputs).Count -gt 0)

    Write-Host "`n== Updates (check only)"
    Invoke-Pc Updater CheckNow | Out-Null
    $until = (Get-Date).AddSeconds(30)
    Start-Sleep -Milliseconds 300
    while ((Get-Pc Updater State) -eq "Checking" -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 300 }
    Show "new version" ("'" + (Get-Pc Updater NewVersion) + "'")
    Show "state" (Get-Pc Updater State)
    $a = [object[]]@($null)
    $r = (T "Updater").GetMethod("InstallNow").Invoke($null, $a)
    Check "test build refuses to install" (-not $r -and $a[0] -eq "Test build: updates are off")
    Check "no new exe downloaded" (-not (Test-Path "$Exe.new"))
    Check "whats new empty (not after an update)" ((Get-Pc Updater WhatsNew) -eq "")

    Write-Host "`n== Privacy of what the helper wrote"
    $line = $null
    while ($logQ.TryDequeue([ref]$line)) { $logged.Add($line) }
    $all = ($logged -join "`n") + "`n" + (Get-Pc Updater State)
    foreach ($f in (Get-ChildItem $scratch -File)) { $all += "`n" + (Get-Content $f.FullName -Raw) } # games.json, update.json
    Show "log lines" $logged.Count
    Check "no IPv4 address (trace hops, router, ping target)" ($all -notmatch '(?<![\d.])\d{1,3}(\.\d{1,3}){3}(?![\d.])')
    Check "no user folder" ($all.IndexOf([Environment]::GetFolderPath("UserProfile"), [StringComparison]::OrdinalIgnoreCase) -lt 0)
    Check "no Windows user or PC name" ($all -notmatch ("\b(" + [Regex]::Escape([Environment]::UserName) + "|" + [Regex]::Escape([Environment]::MachineName) + ")\b"))
    Check "no email address" ($all -notmatch '[\w.+-]+@[\w-]+\.[\w.-]+')
}
finally {
    Invoke-Pc PcServices Stop | Out-Null
    Write-Host "`n== Log"
    $line = $null
    while ($logQ.TryDequeue([ref]$line)) { $logged.Add($line) }
    foreach ($line in $logged) { Write-Host ("  " + $line) }
    Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
}
Write-Host ""
if ($script:fails -gt 0) { Write-Host "$($script:fails) check(s) FAILED" -ForegroundColor Red; exit 1 }
Write-Host "All checks passed" -ForegroundColor Green
