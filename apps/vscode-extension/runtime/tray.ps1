param(
  [Parameter(Mandatory = $true)][string]$DataDirectory,
  [Parameter(Mandatory = $true)][string]$DashboardUrl,
  [Parameter(Mandatory = $true)][string]$ShutdownUrl,
  [Parameter(Mandatory = $true)][string]$Origin,
  [Parameter(Mandatory = $true)][int]$ServerPid,
  [Parameter(Mandatory = $true)][string]$IconPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$trayStatePath = Join-Path $DataDirectory 'tray.json'
$stoppedMarkerPath = Join-Path $DataDirectory 'server.stopped'
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$timer = New-Object System.Windows.Forms.Timer
$bitmap = $null
$icon = $null

try {
  $bitmap = New-Object System.Drawing.Bitmap($IconPath)
  $iconHandle = $bitmap.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($iconHandle).Clone()
  $notifyIcon.Icon = $icon
  $notifyIcon.Text = 'Teloverge LLM Usage Monitor'

  $openItem = $menu.Items.Add('Open Dashboard')
  $exitItem = $menu.Items.Add('Exit')
  $openDashboard = {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $DashboardUrl
    $startInfo.UseShellExecute = $true
    [void][System.Diagnostics.Process]::Start($startInfo)
  }
  $openItem.add_Click($openDashboard)
  $notifyIcon.add_DoubleClick($openDashboard)
  $exitItem.add_Click({
    [System.IO.File]::WriteAllText($stoppedMarkerPath, [DateTimeOffset]::UtcNow.ToString('O'))
    try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri $ShutdownUrl -Headers @{ Origin = $Origin } -TimeoutSec 3 | Out-Null }
    catch { Stop-Process -Id $ServerPid -Force -ErrorAction SilentlyContinue }
    [System.Windows.Forms.Application]::Exit()
  })
  $timer.Interval = 2000
  $timer.add_Tick({
    if (-not (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)) { [System.Windows.Forms.Application]::Exit() }
  })
  $notifyIcon.ContextMenuStrip = $menu
  $notifyIcon.Visible = $true
  $timer.Start()
  [System.IO.File]::WriteAllText($trayStatePath, (@{ pid = $PID; serverPid = $ServerPid } | ConvertTo-Json))
  [System.Windows.Forms.Application]::Run()
}
finally {
  $timer.Stop()
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  $menu.Dispose()
  $timer.Dispose()
  if ($icon) { $icon.Dispose() }
  if ($bitmap) { $bitmap.Dispose() }
  Remove-Item -LiteralPath $trayStatePath -Force -ErrorAction SilentlyContinue
}
