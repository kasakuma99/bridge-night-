# Draws helper/app.ico (16, 32, 48 and 256 px) with the BN mark: dark violet rounded square,
# sunset rim, "BN" in the pink-to-orange gradient. Same drawing as Theme.DrawMark in UiTheme.cs: keep them in step.
# Plain System.Drawing, nothing is compiled. Usage (PowerShell, from the repo folder):  .\helper\tools\make-icon.ps1
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$out = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "app.ico"

$pink = [Drawing.Color]::FromArgb(0xff, 0x3e, 0x8f); $coral = [Drawing.Color]::FromArgb(0xff, 0x6b, 0x5b)
$orange = [Drawing.Color]::FromArgb(0xff, 0x9f, 0x45)

function New-Sunset([Drawing.RectangleF]$r) {
    $b = New-Object Drawing.Drawing2D.LinearGradientBrush $r, $pink, $orange, 45.0
    $blend = New-Object Drawing.Drawing2D.ColorBlend
    $blend.Colors = [Drawing.Color[]]($pink, $coral, $orange)
    $blend.Positions = [single[]](0, .5, 1)
    $b.InterpolationColors = $blend
    $b
}

function New-Round([Drawing.RectangleF]$r, [single]$radius) {
    $d = [Math]::Min($radius * 2, [Math]::Min($r.Width, $r.Height))
    $p = New-Object Drawing.Drawing2D.GraphicsPath
    $p.AddArc($r.X, $r.Y, $d, $d, 180, 90); $p.AddArc($r.Right - $d, $r.Y, $d, $d, 270, 90)
    $p.AddArc($r.Right - $d, $r.Bottom - $d, $d, $d, 0, 90); $p.AddArc($r.X, $r.Bottom - $d, $d, $d, 90, 90)
    $p.CloseFigure(); $p
}

function New-Mark([int]$s) {
    $bmp = New-Object Drawing.Bitmap $s, $s, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = "AntiAlias"; $g.PixelOffsetMode = "HighQuality"
    $full = New-Object Drawing.RectangleF 0, 0, $s, $s
    $rim = if ($s -ge 24) { [Math]::Max(1.0, $s / 22.0) } else { 0.0 }
    $box = New-Object Drawing.RectangleF ($rim / 2), ($rim / 2), ($s - $rim), ($s - $rim)
    $path = New-Round $box ($s * .24)
    $bg = New-Object Drawing.Drawing2D.LinearGradientBrush $full, ([Drawing.Color]::FromArgb(0x2d, 0x0f, 0x4a)), ([Drawing.Color]::FromArgb(0x12, 0x08, 0x21)), 90.0
    $g.FillPath($bg, $path)
    if ($rim -gt 0) { $pen = New-Object Drawing.Pen (New-Sunset $full), $rim; $g.DrawPath($pen, $path) }

    $style = if ($s -ge 32) { [int]([Drawing.FontStyle]::Bold -bor [Drawing.FontStyle]::Italic) } else { [int][Drawing.FontStyle]::Bold }
    $text = New-Object Drawing.Drawing2D.GraphicsPath
    $text.AddString("BN", (New-Object Drawing.FontFamily "Segoe UI"), $style, 100.0, (New-Object Drawing.PointF 0, 0), [Drawing.StringFormat]::GenericTypographic)
    $b = $text.GetBounds()
    $wf = if ($s -le 16) { .9 } else { .62 }; $hf = if ($s -le 16) { .62 } else { .46 }
    $k = [Math]::Min($s * $wf / $b.Width, $s * $hf / $b.Height)
    $m = New-Object Drawing.Drawing2D.Matrix
    $m.Translate($s / 2, $s / 2); $m.Scale($k, $k); $m.Translate(-($b.X + $b.Width / 2), -($b.Y + $b.Height / 2))
    $text.Transform($m)
    $g.FillPath((New-Sunset $text.GetBounds()), $text)
    $g.Dispose()
    $bmp
}

# 32-bit DIB entry (BITMAPINFOHEADER, bottom-up BGRA, empty AND mask): what small icon sizes expect.
function Get-Dib([Drawing.Bitmap]$bmp) {
    $w = $bmp.Width; $h = $bmp.Height
    $data = $bmp.LockBits((New-Object Drawing.Rectangle 0, 0, $w, $h), "ReadOnly", ([Drawing.Imaging.PixelFormat]::Format32bppArgb))
    $px = New-Object byte[] ($data.Stride * $h)
    [Runtime.InteropServices.Marshal]::Copy($data.Scan0, $px, 0, $px.Length)
    $bmp.UnlockBits($data)
    $maskRow = [int][Math]::Ceiling($w / 32.0) * 4
    $ms = New-Object IO.MemoryStream; $bw = New-Object IO.BinaryWriter $ms
    $bw.Write([int]40); $bw.Write([int]$w); $bw.Write([int]($h * 2)); $bw.Write([int16]1); $bw.Write([int16]32)
    $bw.Write([int]0); $bw.Write([int]($w * $h * 4 + $maskRow * $h)); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0)
    for ($y = $h - 1; $y -ge 0; $y--) { $bw.Write($px, $y * $data.Stride, $w * 4) }
    $bw.Write((New-Object byte[] ($maskRow * $h)))
    $bw.Flush(); , $ms.ToArray()
}

$sizes = 16, 32, 48, 256
$images = @()
foreach ($s in $sizes) {
    $bmp = New-Mark $s
    if ($s -eq 256) { $ms = New-Object IO.MemoryStream; $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $images += , $ms.ToArray() }
    else { $images += , (Get-Dib $bmp) }
    $bmp.Dispose()
}

$ms = New-Object IO.MemoryStream; $bw = New-Object IO.BinaryWriter $ms
$bw.Write([int16]0); $bw.Write([int16]1); $bw.Write([int16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([int16]1); $bw.Write([int16]32); $bw.Write([int]$images[$i].Length); $bw.Write([int]$offset)
    $offset += $images[$i].Length
}
foreach ($img in $images) { $bw.Write($img) }
$bw.Flush()
[IO.File]::WriteAllBytes($out, $ms.ToArray())

# Self-check: every size reads back (.NET's Icon class skips PNG frames, so 256 is decoded as PNG).
$png = [Drawing.Image]::FromStream((New-Object IO.MemoryStream (, $images[3])))
if ($png.Width -ne 256) { throw "app.ico: 256 px frame is broken" }
$png.Dispose()
foreach ($s in 16, 32, 48) {
    $ico = New-Object Drawing.Icon $out, $s, $s
    if ($ico.Width -ne $s) { throw "app.ico: size $s missing (got $($ico.Width))" }
    $ico.Dispose()
}
Write-Host "Wrote $out ($($sizes -join ', ') px)"
