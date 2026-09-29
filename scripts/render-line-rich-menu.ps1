$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$edge = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw "msedge.exe not found" }

$dir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "line-rich-menu"
$maxBytes = 1MB

foreach ($name in @("general", "no-receive", "purchasing")) {
  $html = Join-Path $dir "$name.html"
  $png = Join-Path $dir "$name.png"
  $url = ([System.Uri]$html).AbsoluteUri
  if (Test-Path $png) { Remove-Item $png }

  & $edge --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 `
    --window-size=2500,843 --virtual-time-budget=15000 "--screenshot=$png" $url | Out-Null

  $img = [System.Drawing.Image]::FromFile($png)
  $w = $img.Width; $h = $img.Height; $img.Dispose()
  $size = (Get-Item $png).Length
  Write-Host ("{0}: {1}x{2}, {3:N0} bytes" -f $name, $w, $h, $size)
  if ($w -ne 2500 -or $h -ne 843) { throw "$name.png must be 2500x843" }
  if ($size -gt $maxBytes) { throw "$name.png exceeds the 1 MB LINE limit" }
}
