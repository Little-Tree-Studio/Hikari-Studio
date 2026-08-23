[CmdletBinding()]
param(
  [string]$Version = '0.4.0-beta.1',
  [switch]$SkipEditor,
  [string]$EditorDirectory,
  [string]$IsccPath
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $SkipEditor) {
  $EditorArgs = @{}
  if ($EditorDirectory) { $EditorArgs.OutputDirectory = $EditorDirectory }
  & (Join-Path $PSScriptRoot 'build-editor.ps1') @EditorArgs
}

$DistRoot = [IO.Path]::GetFullPath((Join-Path $Root 'dist'))
$EditorDirectory = if ($EditorDirectory) {
  if ([IO.Path]::IsPathRooted($EditorDirectory)) { [IO.Path]::GetFullPath($EditorDirectory) }
  else { [IO.Path]::GetFullPath((Join-Path $Root $EditorDirectory)) }
} else {
  Join-Path $DistRoot 'HikariStudio'
}
if (-not $EditorDirectory.StartsWith($DistRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Editor input must stay inside the repository dist directory: $EditorDirectory"
}
$Editor = Join-Path $EditorDirectory 'HikariStudio.exe'
if (-not (Test-Path $Editor)) { throw "Editor build is missing: $Editor" }

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

if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-[^.]+\.(\d+))?$') {
  throw "Version must use SemVer, for example 0.4.0 or 0.4.0-beta.1: $Version"
}
$Revision = if ($Matches[4]) { $Matches[4] } else { '0' }
$NumericVersion = "$($Matches[1]).$($Matches[2]).$($Matches[3]).$Revision"
& $IsccPath "/DMyAppVersion=$Version" "/DMyAppNumericVersion=$NumericVersion" "/DMyAppSourceDir=$EditorDirectory" (Join-Path $Root 'installer\HikariStudio.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE" }

$Installer = Join-Path $Root "dist\installer\Hikari-Studio-Setup-$Version.exe"
if (-not (Test-Path $Installer)) { throw "Installer build did not produce $Installer" }
Write-Host "Hikari Studio installer: $Installer"
