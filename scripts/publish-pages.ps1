# Build the GitHub Pages site and force-push it to the gh-pages branch of origin.
# Usage: .\scripts\publish-pages.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root ".venv\Scripts\python.exe"
$site = Join-Path $root "site"
& $py (Join-Path $root "scripts\build_pages.py") $site
$remote = git -C $root remote get-url origin
$rev = git -C $root rev-parse --short HEAD
$ErrorActionPreference = 'Continue' # git writes progress and warnings to stderr
Push-Location $site
try {
  git init -q -b gh-pages
  git config core.autocrlf false
  git add -A
  git -c user.name="Purv Kanani" -c user.email="pdkanani@icloud.com" commit -q -m "Pages build of $rev"
  git push -f $remote gh-pages 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "push failed" }
} finally { Pop-Location }
Write-Host "Published $rev to gh-pages" -ForegroundColor Green
