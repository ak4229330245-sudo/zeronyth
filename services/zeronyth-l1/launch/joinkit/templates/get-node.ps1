# Downloads the official Node.js 22 LTS (win-x64 zip) into .\runtime and checks its SHA-256 against nodejs.org SHASUMS256.txt.
$ErrorActionPreference = 'Stop'
$base = 'https://nodejs.org/dist/latest-v22.x/'
$kit = Split-Path -Parent $PSScriptRoot
$sums = (Invoke-WebRequest -UseBasicParsing ($base + 'SHASUMS256.txt')).Content -split "`n"
$line = $sums | Where-Object { $_ -match 'node-v[0-9.]+-win-x64\.zip$' } | Select-Object -First 1
$hash, $file = ($line -split '\s+')[0, 1]
$zip = Join-Path $env:TEMP $file
Invoke-WebRequest -UseBasicParsing ($base + $file) -OutFile $zip
if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $hash.ToLower()) { throw 'checksum mismatch' }
$tmp = Join-Path $env:TEMP 'znyt-node'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
Expand-Archive $zip -DestinationPath $tmp
New-Item -ItemType Directory -Force (Join-Path $kit 'runtime') | Out-Null
Copy-Item (Join-Path $tmp ($file -replace '\.zip$', '') | Join-Path -ChildPath 'node.exe') (Join-Path $kit 'runtime\node.exe')
Remove-Item -Force $zip; Remove-Item -Recurse -Force $tmp
