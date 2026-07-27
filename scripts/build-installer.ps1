[CmdletBinding()]
param(
  [string]$Version = '0.3.0',
  [switch]$SkipEditor,
  [string]$IsccPath
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $SkipEditor) {
  & (Join-Path $PSScriptRoot 'build-editor.ps1')
}

$Editor = Join-Path $Root 'dist\HikariStudio\HikariStudio.exe'
if (-not (Test-Path $Editor)) { throw "Editor build is missing: $Editor" }

$PrerequisiteDir = Join-Path $Root 'build\prerequisites'
$Bootstrapper = Join-Path $PrerequisiteDir 'MicrosoftEdgeWebview2Setup.exe'
New-Item -ItemType Directory -Force -Path $PrerequisiteDir | Out-Null
if (-not (Test-Path $Bootstrapper)) {
  Write-Host 'Downloading Microsoft Edge WebView2 Evergreen Bootstrapper...'
  Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $Bootstrapper
}
if ((Get-Item $Bootstrapper).Length -lt 100000) { throw 'Downloaded WebView2 bootstrapper is invalid.' }

if (-not $IsccPath) {
  $Command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($Command) { $IsccPath = $Command.Source }
}
if (-not $IsccPath) {
  $Candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 7\ISCC.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 7\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 7\ISCC.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
  )
  $IsccPath = $Candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $IsccPath -or -not (Test-Path $IsccPath)) {
  throw 'Inno Setup 6 or newer is required. Install it with: winget install JRSoftware.InnoSetup'
}

& $IsccPath "/DMyAppVersion=$Version" (Join-Path $Root 'installer\HikariStudio.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE" }

$Installer = Join-Path $Root "dist\installer\Hikari-Studio-Setup-$Version.exe"
if (-not (Test-Path $Installer)) { throw "Installer build did not produce $Installer" }
Write-Host "Hikari Studio installer: $Installer"
