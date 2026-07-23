Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function New-Brush($hex) {
  return New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex))
}

function New-Pen($hex, $width = 1) {
  return New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($hex)), $width
}

function Draw-RoundedRectangle {
  param($graphics, $brush, [single]$x, [single]$y, [single]$width, [single]$height, [single]$radius)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  $graphics.FillPath($brush, $path)
  $path.Dispose()
}

function Draw-Label {
  param($graphics, [string]$text, $font, $brush, [single]$x, [single]$y, [single]$width, [single]$height, [string]$align = "Near")
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Enum]::Parse([System.Drawing.StringAlignment], $align)
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = [System.Drawing.RectangleF]::new($x, $y, $width, $height)
  $graphics.DrawString($text, $font, $brush, $rect, $format)
  $format.Dispose()
}

function Save-DispenseMenu() {
  $bitmap = New-Object System.Drawing.Bitmap 2500, 843
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#0F172A"))

  $bgBrush = New-Brush "#0F172A"
  $panelBrush = New-Brush "#123D3A"
  $accentBrush = New-Brush "#34D399"
  $whiteBrush = New-Brush "#F8FAFC"
  $mutedBrush = New-Brush "#B6C7D3"
  Draw-RoundedRectangle $graphics $panelBrush 90 90 2320 660 56
  Draw-RoundedRectangle $graphics $accentBrush 150 150 24 540 12

  $titleFont = New-Object System.Drawing.Font "Tahoma", 92, ([System.Drawing.FontStyle]::Bold)
  $subFont = New-Object System.Drawing.Font "Tahoma", 34, ([System.Drawing.FontStyle]::Regular)
  $metaFont = New-Object System.Drawing.Font "Tahoma", 28, ([System.Drawing.FontStyle]::Bold)
  Draw-Label $graphics "Quick Issue" $titleFont $whiteBrush 230 245 1500 120
  Draw-Label $graphics "Open dispense workflow from LINE" $subFont $mutedBrush 235 375 1500 70
  Draw-Label $graphics "LABSTOCK DISPENSE" $metaFont $accentBrush 235 185 1000 50
  Draw-Label $graphics "Tap to open" $metaFont $whiteBrush 1760 560 480 70 "Center"
  Draw-RoundedRectangle $graphics (New-Brush "#0B2727") 1780 225 350 260 36
  Draw-RoundedRectangle $graphics $accentBrush 1845 285 220 42 20
  Draw-RoundedRectangle $graphics $accentBrush 1845 370 220 42 20

  $bitmap.Save((Join-Path $scriptDir "line-rich-menu-dispense.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

function Save-PurchasingMenu() {
  $bitmap = New-Object System.Drawing.Bitmap 2500, 843
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#0B1220"))

  $leftBrush = New-Brush "#123D3A"
  $rightBrush = New-Brush "#172554"
  $lineBrush = New-Brush "#F59E0B"
  $whiteBrush = New-Brush "#F8FAFC"
  $mutedBrush = New-Brush "#C7D2FE"
  $greenBrush = New-Brush "#34D399"
  $smallFont = New-Object System.Drawing.Font "Tahoma", 27, ([System.Drawing.FontStyle]::Bold)
  $titleFont = New-Object System.Drawing.Font "Tahoma", 72, ([System.Drawing.FontStyle]::Bold)
  $subFont = New-Object System.Drawing.Font "Tahoma", 30, ([System.Drawing.FontStyle]::Regular)

  Draw-RoundedRectangle $graphics $leftBrush 76 82 1110 680 52
  Draw-RoundedRectangle $graphics $rightBrush 1314 82 1110 680 52
  Draw-RoundedRectangle $graphics $greenBrush 132 146 22 520 11
  Draw-RoundedRectangle $graphics $lineBrush 1370 146 22 520 11

  Draw-Label $graphics "QUICK ISSUE" $smallFont $greenBrush 190 165 640 50
  Draw-Label $graphics "Quick Issue" $titleFont $whiteBrush 190 278 820 105
  Draw-Label $graphics "Scan and confirm dispense" $subFont (New-Brush "#A7F3D0") 195 395 820 60
  Draw-Label $graphics "Open dispense workflow" $smallFont $whiteBrush 195 585 620 60

  Draw-Label $graphics "PURCHASE CONTROL" $smallFont $lineBrush 1430 165 720 50
  Draw-Label $graphics "Order Reagents" $titleFont $whiteBrush 1430 278 820 105
  Draw-Label $graphics "Low stock PO and vendor review" $subFont $mutedBrush 1435 395 840 60
  Draw-Label $graphics "Admin / Manager only" $smallFont $whiteBrush 1435 585 700 60

  Draw-RoundedRectangle $graphics (New-Brush "#0F172A") 1066 155 58 520 29
  Draw-RoundedRectangle $graphics $lineBrush 1083 295 24 240 12

  $bitmap.Save((Join-Path $scriptDir "line-rich-menu-purchasing.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

Save-DispenseMenu
Save-PurchasingMenu
Write-Host "Generated LINE rich menu assets in $scriptDir"
