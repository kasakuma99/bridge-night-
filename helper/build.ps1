# Builds bridge-night-helper.exe with the C# compiler that ships with Windows (.NET Framework 4.8).
# No downloads, no packages. Usage (PowerShell, from the repo folder):  .\helper\build.ps1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$fw = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319"
$csc = Join-Path $fw "csc.exe"
if (-not (Test-Path $csc)) { throw "C# compiler not found at $csc (.NET Framework 4.8 is part of Windows 10/11)" }

$out = Join-Path $here "dist"
New-Item -ItemType Directory -Force $out | Out-Null
$exe = Join-Path $out "bridge-night-helper.exe"

$refs = "System.dll", "System.Core.dll", "System.Drawing.dll", "System.Windows.Forms.dll", "System.Management.dll",
        "System.Security.dll", "System.Web.Extensions.dll" | ForEach-Object { "/reference:" + (Join-Path $fw $_) }

& $csc /nologo /target:winexe /optimize+ /platform:anycpu "/out:$exe" @refs (Join-Path $here "BridgeNightHelper.cs")
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
Set-Content -Path "$exe.sha256" -Value "$hash  bridge-night-helper.exe" -Encoding ASCII
Write-Host "Built $exe"
Write-Host "SHA-256: $hash"
