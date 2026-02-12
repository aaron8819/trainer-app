$ErrorActionPreference = "Stop"

$workdir = "c:\Users\aabloch\claude\vibe-coding\Trainer\trainer-app"
$stdout = Join-Path $workdir "tmp-qa-server.out.txt"
$stderr = Join-Path $workdir "tmp-qa-server.err.txt"

if (Test-Path $stdout) { Remove-Item $stdout -Force }
if (Test-Path $stderr) { Remove-Item $stderr -Force }

$proc = Start-Process -FilePath "npm.cmd" `
  -ArgumentList "run", "start", "--", "-p", "3000" `
  -WorkingDirectory $workdir `
  -PassThru `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr

try {
  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3000" -TimeoutSec 2
      if ($resp.StatusCode -ge 200) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }

  if (-not $ready) {
    throw "Server did not become ready on http://127.0.0.1:3000"
  }

  Set-Location $workdir
  node scripts/capture-mobile-qa-screenshots.mjs
}
finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
  Start-Sleep -Milliseconds 300
}
