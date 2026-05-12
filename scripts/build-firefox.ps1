$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $root "dist\firefox"
$entries = @("assets", "icons", "lib", "popup", "src", "README.md")

if (Test-Path $dist) {
  Remove-Item -LiteralPath $dist -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null

foreach ($entry in $entries) {
  $source = Join-Path $root $entry
  $destination = Join-Path $dist $entry
  if (Test-Path $source -PathType Container) {
    Copy-Item -LiteralPath $source -Destination $destination -Recurse
  } else {
    Copy-Item -LiteralPath $source -Destination $destination
  }
}

Copy-Item -LiteralPath (Join-Path $root "manifest.firefox.json") -Destination (Join-Path $dist "manifest.json")

Write-Host "Firefox extension built at $dist"
