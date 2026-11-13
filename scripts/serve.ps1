# Run Kshetralekha on this PC. Phones on the same Wi-Fi open https://<this PC's IP>:8788
# Camera and GPS in a browser need HTTPS (except on localhost), so this script makes a self-signed certificate once.
# Usage:  .\scripts\serve.ps1            (HTTPS on 0.0.0.0:8788)
#         .\scripts\serve.ps1 -Http      (plain HTTP on 127.0.0.1:8788 for local testing)
param([switch]$Http, [int]$Port = 8788)
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Host "Create the venv first: uv venv .venv; uv pip install -r backend/requirements.txt" -ForegroundColor Yellow; exit 1 }
if ($Http) {
  & $py -m uvicorn app:app --app-dir (Join-Path $root "backend") --host 127.0.0.1 --port $Port
  exit
}
$certDir = Join-Path $root "data\cert"
New-Item -ItemType Directory -Force $certDir | Out-Null
$key = Join-Path $certDir "key.pem"; $crt = Join-Path $certDir "cert.pem"
if (-not (Test-Path $crt)) {
  $openssl = "D:\PersonalBooks\tools\git\usr\bin\openssl.exe"
  if (-not (Test-Path $openssl)) { $openssl = "openssl" }
  $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.*" } | Select-Object -First 1).IPAddress
  & $openssl req -x509 -newkey rsa:2048 -nodes -keyout $key -out $crt -days 825 -subj "/CN=Kshetralekha" -addext "subjectAltName=IP:$ip,DNS:localhost,IP:127.0.0.1" 2>$null
  Write-Host "Made a self-signed certificate for $ip. On the phone, accept the certificate warning once." -ForegroundColor Green
}
$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.*" }).IPAddress
Write-Host "Open on the phone: " -NoNewline; $ips | ForEach-Object { Write-Host "https://$($_):$Port  " -NoNewline -ForegroundColor Cyan }; Write-Host ""
& $py -m uvicorn app:app --app-dir (Join-Path $root "backend") --host 0.0.0.0 --port $Port --ssl-keyfile $key --ssl-certfile $crt
