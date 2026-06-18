$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $root "dist\chrome"
$entries = @("assets", "icons", "lib", "popup", "src", "README.md", "manifest.json")

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

Write-Host "Chrome extension built at $dist"
