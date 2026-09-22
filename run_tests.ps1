# Runs both test suites. No dependencies required.
#
#   .\run_tests.ps1
#
# Exits non-zero if either suite fails.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$failed = $false

Write-Host "== rules, undo and persistence ==" -ForegroundColor Cyan
& node (Join-Path $root "tests/test_game.js") $root
if ($LASTEXITCODE -ne 0) { $failed = $true }

Write-Host ""
Write-Host "== animations (headless Chrome) ==" -ForegroundColor Cyan

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) {
  Write-Host "No Chrome or Edge found; skipping the animation suite." -ForegroundColor Yellow
} else {
  $page = "file:///" + ((Join-Path $root "tests/browser_check.html") -replace '\\', '/')
  $tmp = [IO.Path]::GetTempPath()
  $profile = Join-Path $tmp ("2048undo-profile-" + [guid]::NewGuid().ToString("N"))
  $dom = Join-Path $tmp ("2048undo-dom-" + [guid]::NewGuid().ToString("N") + ".html")
  $err = "$dom.err"

  $proc = Start-Process -FilePath $chrome -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $dom -RedirectStandardError $err -ArgumentList @(
      "--headless=new", "--no-sandbox", "--disable-gpu",
      "--user-data-dir=$profile", "--virtual-time-budget=15000",
      "--dump-dom", $page
    )
  $proc.WaitForExit()

  $log = $null
  if (Test-Path $dom) {
    $html = Get-Content -Raw $dom
    $start = $html.IndexOf('<pre id="log">')
    $end = $html.IndexOf('</pre>')
    if ($start -ge 0 -and $end -gt $start) {
      $log = $html.Substring($start + 15, $end - $start - 15)
    }
  }

  if ($log) {
    Write-Host $log
    if ($log -notmatch '(?m)0 failed') { $failed = $true }
  } else {
    Write-Host "Could not read the results out of the dumped DOM." -ForegroundColor Red
    if (Test-Path $err) { Get-Content $err | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" } }
    $failed = $true
  }

  Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $dom, $err -Force -ErrorAction SilentlyContinue
}

Write-Host ""
if ($failed) { Write-Host "FAILED" -ForegroundColor Red; exit 1 }
Write-Host "All suites passed." -ForegroundColor Green