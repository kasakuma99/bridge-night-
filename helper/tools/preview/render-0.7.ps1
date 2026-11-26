# Renders every screen of the 0.7 window to PNG files, offscreen (nothing opens on screen, nothing is sent).
# Default: builds a preview library with sample data (FakePcServices.cs instead of PcServices.cs and the Pc*.cs features) into helper\dist.
# -Empty: uses the real test build (helper\build.ps1 -Test) instead, to check the empty / "Measuring…" states.
# Usage (PowerShell, from the repo folder):  .\helper\tools\preview\render-0.7.ps1 [-Out folder] [-Empty]
param([string]$Out = "", [switch]$Empty)
$ErrorActionPreference = "Stop"
$preview = Split-Path -Parent $MyInvocation.MyCommand.Path
$helper = Resolve-Path (Join-Path $preview "..\..")
if ($Out -eq "") { $Out = Join-Path $preview "0.7" }
New-Item -ItemType Directory -Force $Out | Out-Null
# Never the real settings: a throwaway folder for anything the window saves (TEST builds read BN_HELPER_DIR).
$env:BN_HELPER_DIR = Join-Path $env:TEMP "bn-helper-preview-settings"
New-Item -ItemType Directory -Force $env:BN_HELPER_DIR | Out-Null

if ($Empty) {
    $dll = Join-Path $helper "dist\bridge-night-helper-test.exe"
    if (-not (Test-Path $dll)) { throw "Build it first: .\helper\build.ps1 -Test" }
} else {
    $fw = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319"
    $dll = Join-Path $helper "dist\bridge-night-helper-preview.dll"
    $refs = "System.dll", "System.Core.dll", "System.Drawing.dll", "System.Windows.Forms.dll", "System.Management.dll",
            "System.Security.dll", "System.Web.Extensions.dll" | ForEach-Object { "/reference:" + (Join-Path $fw $_) }
    [string[]]$res = @(Get-ChildItem (Join-Path $helper "res") -File | ForEach-Object { "/resource:$($_.FullName),$($_.Name)" }) + "/resource:$(Join-Path $helper 'app.ico'),app.ico"
    # Built as TEST (own settings folder), but the pictures show the normal title, as in the released app.
    $logic = Join-Path $env:TEMP "bn-helper-preview-BridgeNightHelper.cs"
    [IO.File]::WriteAllText($logic, ([IO.File]::ReadAllText((Join-Path $helper "BridgeNightHelper.cs")) -replace 'Title = "Bridge Night Helper TEST"', 'Title = "Bridge Night Helper"'))
    $src = @(Get-ChildItem $helper -Filter *.cs | Where-Object { $_.Name -notlike "Pc*.cs" -and $_.Name -ne "BridgeNightHelper.cs" } | ForEach-Object { $_.FullName }) + $logic + (Join-Path $preview "FakePcServices.cs")
    & (Join-Path $fw "csc.exe") /nologo /nowarn:649,169,67 /target:library /define:TEST "/out:$dll" @refs @res $src
    if ($LASTEXITCODE -ne 0) { throw "Preview build failed" }
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$asm = [Reflection.Assembly]::LoadFile($dll)
function T($name) { $asm.GetType("BridgeNight.$name", $true) }
function Call($obj, $name, $argz) { $obj.GetType().GetMethod($name).Invoke($obj, $argz) }
function Static($type, $name, $argz) { (T $type).GetMethod($name).Invoke($null, $argz) }
# Creates the window handles of all children too, so DrawToBitmap paints them without showing anything on screen.
$createAll = [Windows.Forms.Control].GetMethod("CreateControl", [Reflection.BindingFlags]"NonPublic,Instance", $null, [Type[]]@([bool]), $null)
function Snap($ctl, $name) {
    $createAll.Invoke($ctl, @($true)) | Out-Null
    $bmp = New-Object Drawing.Bitmap $ctl.Width, $ctl.Height
    $ctl.DrawToBitmap($bmp, (New-Object Drawing.Rectangle 0, 0, $ctl.Width, $ctl.Height))
    $file = Join-Path $Out "$name.png"
    $bmp.Save($file, [Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Wrote $file"
}

$settings = [Activator]::CreateInstance((T "Settings"))
$settings.GetType().GetField("Token").SetValue($settings, "preview")
$settings.GetType().GetField("TourDone").SetValue($settings, $true)
Static "HelperStatus" "SetLeague" @($true, "Lobby", $false)
Static "HelperStatus" "SetSent" @($true, "Game over, everything sent")
$lines = New-Object 'System.Collections.Generic.List[string]'
foreach ($l in "20:49:30  Sent: loading screen", "21:13:51  Game over, waiting for the final details", "21:14:08  Game over, everything sent") { $lines.Add($l) }

function NewWindow {
    $ctor = (T "MainWindow").GetConstructors()[0]
    $w = $ctor.Invoke(@($settings.psobject.BaseObject, $lines.psobject.BaseObject, [Action[bool]] { param($p) }, [Action[string]] { param($s) }, [Action] { }))
    $w.CreateControl()
    $w
}
function Page($w, $field, $name) {
    $p = $w.GetType().GetField($field).GetValue($w)
    Call $w "ShowPage" @($p)
    Call $p "Shown" $null
    Call $p "Tick" $null
    # Background results (nav badge, app lists) arrive a moment later: let them in, then draw.
    Start-Sleep -Milliseconds 300; [Windows.Forms.Application]::DoEvents()
    Call $p "Tick" $null
    Snap $w $name
    Call $p "Hidden" $null
}
# DrawToBitmap paints child windows in reverse order, so an overlay (tour, Settings) is painted on top by hand.
function SnapOverlay($w, $overlay, $name) {
    $createAll.Invoke($w, @($true)) | Out-Null
    $bmp = New-Object Drawing.Bitmap $w.Width, $w.Height
    $w.DrawToBitmap($bmp, (New-Object Drawing.Rectangle 0, 0, $w.Width, $w.Height))
    $overlay.DrawToBitmap($bmp, (New-Object Drawing.Rectangle $overlay.Left, $overlay.Top, $overlay.Width, $overlay.Height))
    $file = Join-Path $Out "$name.png"
    $bmp.Save($file, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    Write-Host "Wrote $file"
}
function SettingsShots($w, $sections, $prefix) {
    Call $w "ShowPage" @($w.GetType().GetField("Home").GetValue($w))
    Call $w "OpenSettings" @($sections[0][0])
    $pop = $w.GetType().GetField("settingsPopup", [Reflection.BindingFlags]"NonPublic,Instance").GetValue($w)
    foreach ($s in $sections) {
        Call $pop "ShowSection" @([string]$s[0])
        Call $pop "Tick" $null
        SnapOverlay $w $pop ($prefix + $s[1])
    }
    Call $w "CloseSettings" $null
}

$w = NewWindow
Page $w "Home" "01-home"
$perf = $w.GetType().GetField("Performance").GetValue($w)
foreach ($tab in 0, 1, 2) {
    $perf.GetType().GetProperty("Tab").SetValue($perf, $tab)
    Page $w "Performance" ("02-performance-" + @("live", "last-game", "apps")[$tab])
}
# A sample game for the Live page (fake names), set the way the Watcher sets it.
$sample = '{"gameData":{"gameTime":1265.4},"allPlayers":[' +
  '{"championName":"Ahri","riotIdGameName":"Player One","team":"ORDER","level":14,"isDead":false,"scores":{"kills":7,"deaths":2,"assists":9,"creepScore":182},"items":[{"displayName":"Luden' + "'" + 's Companion"},{"displayName":"Sorcerer' + "'" + 's Shoes"},{"displayName":"Shadowflame"},{"displayName":"Dark Seal"}]},' +
  '{"championName":"Garen","riotIdGameName":"Player Two","team":"ORDER","level":13,"isDead":true,"scores":{"kills":3,"deaths":4,"assists":5,"creepScore":160},"items":[{"displayName":"Stridebreaker"},{"displayName":"Plated Steelcaps"},{"displayName":"Sterak' + "'" + 's Gage"}]},' +
  '{"championName":"Jinx","riotIdGameName":"Player Three","team":"ORDER","level":12,"isDead":false,"scores":{"kills":5,"deaths":3,"assists":6,"creepScore":201},"items":[{"displayName":"Kraken Slayer"},{"displayName":"Berserker' + "'" + 's Greaves"},{"displayName":"Infinity Edge"}]},' +
  '{"championName":"Lux","riotIdGameName":"Player Four","team":"CHAOS","level":13,"isDead":false,"scores":{"kills":4,"deaths":5,"assists":8,"creepScore":150},"items":[{"displayName":"Malignance"},{"displayName":"Sorcerer' + "'" + 's Shoes"},{"displayName":"Horizon Focus"}]},' +
  '{"championName":"Darius","riotIdGameName":"Player Five","team":"CHAOS","level":14,"isDead":false,"scores":{"kills":6,"deaths":6,"assists":2,"creepScore":175},"items":[{"displayName":"Trinity Force"},{"displayName":"Plated Steelcaps"},{"displayName":"Dead Man' + "'" + 's Plate"}]},' +
  '{"championName":"Thresh","riotIdGameName":"Player Six","team":"CHAOS","level":11,"isDead":false,"scores":{"kills":1,"deaths":4,"assists":12,"creepScore":38},"items":[{"displayName":"Celestial Opposition"},{"displayName":"Mobility Boots"}]}],' +
  '"events":{"Events":[{"EventName":"GameStart","EventTime":0.5},{"EventName":"FirstBlood","EventTime":212.3,"Recipient":"Player One"},{"EventName":"ChampionKill","EventTime":212.3,"KillerName":"Player One","VictimName":"Player Four"},{"EventName":"DragonKill","EventTime":540.1,"KillerName":"Player Three","DragonType":"Fire"},{"EventName":"TurretKilled","EventTime":810.9,"KillerName":"Player Five"},{"EventName":"Multikill","EventTime":1102.2,"KillerName":"Player One","KillStreak":2},{"EventName":"ChampionKill","EventTime":1240.7,"KillerName":"Player Five","VictimName":"Player Two"}]}}'
$game = (T "Json").GetMethod("Parse").Invoke($null, @($sample))
Static "HelperStatus" "SetGame" @($game)
Page $w "Live" "02a-live"
Static "HelperStatus" "SetGame" @($null)
Page $w "Live" "02b-live-empty"
Page $w "Network" "03-network"
Page $w "GameModeP" "04-game-mode"
Page $w "Audio" "05-audio"
SettingsShots $w @(@("Connection", "1-connection"), @("Startup & alerts", "2-startup"), @("Performance", "3-performance"),
    @("Game mode", "4-game-mode"), @("Audio", "5-audio"), @("Updates", "6-updates")) "06-settings-"
Call $w "OpenHelp" @("What it may change on your PC")
Page $w "Help" "07-help"
Call $w "ShowPage" @($w.GetType().GetField("Home").GetValue($w))
Call $w "ShowTour" $null
$tour = $w.GetType().GetField("tour", [Reflection.BindingFlags]"NonPublic,Instance").GetValue($w)
SnapOverlay $w $tour "08-tour"
$w.Dispose()

$env:BN_FAKE_GAME = "1"; $env:BN_FAKE_MUTED = "1"; $env:BN_FAKE_UPDATE = "0.7.1"
Static "HelperStatus" "SetLeague" @($true, "InProgress", $true)
$w = NewWindow
Page $w "Home" "09-home-in-game"
Page $w "GameModeP" "09b-game-mode-in-game"
SettingsShots $w @(, @("Updates", "update")) "10-settings-"
$w.Dispose()

$mini = (T "MiniWindow").GetConstructors()[0].Invoke(@($settings, [Action] { }))
Call $mini "RefreshNow" $null
Snap $mini "11-mini-in-game"
$mini.Dispose()
$env:BN_FAKE_GAME = ""; $env:BN_FAKE_MUTED = ""
Static "HelperStatus" "SetLeague" @($true, "Lobby", $false)
$mini = (T "MiniWindow").GetConstructors()[0].Invoke(@($settings, [Action] { }))
Call $mini "RefreshNow" $null
Snap $mini "12-mini"
$mini.Dispose()

$fly = (T "TrayFlyout").GetConstructors()[0].Invoke(@($settings, [Action] { }, [Action] { }, [Action[bool]] { param($p) }, [Action] { }))
Call $fly "RefreshNow" $null
Snap $fly "13-tray-flyout"
$fly.Dispose()

$toast = [Activator]::CreateInstance((T "Toast"))
Call $toast "Fill" @([string][char]0xE930, (T "Theme").GetField("Good").GetValue($null), "Result saved", "Your custom game is on the site.")
Snap $toast "14-toast"
$toast.Dispose()

$badge = [Activator]::CreateInstance((T "MutedBadge"))
Snap $badge "15-muted-badge"
$badge.Dispose()
