# Screenshots every page of window.html (the helper window mockup) with headless Chrome.
# Usage (PowerShell):  .\helper\tools\preview\render.ps1 -Out C:\some\folder
param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = "Stop"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { throw "Chrome not found at $chrome" }
New-Item -ItemType Directory -Force $Out | Out-Null
$html = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "window.html")).Path
$url = "file:///" + ($html -replace "\\", "/")
$chromeProfile = Join-Path $env:TEMP "bn-helper-preview-chrome"  # throwaway profile, never the user's own
foreach ($page in "status", "setup", "settings", "log", "about") {
    $png = Join-Path $Out "$page.png"
    Remove-Item $png -ErrorAction SilentlyContinue
    $chromeArgs = "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--user-data-dir=`"$chromeProfile`"",
            "--screenshot=`"$png`"", "--window-size=960,620", "`"$url#$page`""
    Start-Process $chrome -ArgumentList $chromeArgs -Wait -WindowStyle Hidden  # Chrome logs harmless noise to stderr
    if (-not (Test-Path $png)) { throw "No screenshot for $page" }
    Write-Host "Wrote $png"
}
