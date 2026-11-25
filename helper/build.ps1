# Builds bridge-night-helper.exe with the C# compiler that ships with Windows (.NET Framework 4.8).
# No downloads, no packages. Usage (PowerShell, from the repo folder):  .\helper\build.ps1
# -Test builds bridge-night-helper-test.exe: a separate program with its own settings, for trying things out.
param([switch]$Test)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$fw = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319"
$csc = Join-Path $fw "csc.exe"
if (-not (Test-Path $csc)) { throw "C# compiler not found at $csc (.NET Framework 4.8 is part of Windows 10/11)" }

$out = Join-Path $here "dist"
New-Item -ItemType Directory -Force $out | Out-Null
$name = if ($Test) { "bridge-night-helper-test.exe" } else { "bridge-night-helper.exe" }
[string[]]$define = @(if ($Test) { "/define:TEST" })
$exe = Join-Path $out $name

$refs = "System.dll", "System.Core.dll", "System.Drawing.dll", "System.Windows.Forms.dll", "System.Management.dll",
        "System.Security.dll", "System.Web.Extensions.dll" | ForEach-Object { "/reference:" + (Join-Path $fw $_) }

& $csc /nologo /target:winexe /optimize+ /platform:anycpu @define "/out:$exe" @refs `
    "/win32icon:$(Join-Path $here 'app.ico')" "/win32manifest:$(Join-Path $here 'app.manifest')" (Get-ChildItem $here -Filter *.cs | ForEach-Object { $_.FullName })
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
Set-Content -Path "$exe.sha256" -Value "$hash  $name" -Encoding ASCII
Write-Host "Built $exe"
Write-Host "SHA-256: $hash"
