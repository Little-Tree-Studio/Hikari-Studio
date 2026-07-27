[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$SkipLauncher,
  [string]$Python = 'python'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $SkipInstall) {
  & $Python -m pip install -r requirements.txt -r requirements-build.txt
  Push-Location frontend
  try { pnpm install --frozen-lockfile } finally { Pop-Location }
}

Push-Location frontend
try { pnpm run build } finally { Pop-Location }

if (-not $SkipLauncher) {
  dotnet publish launcher/Hikari.GameLauncher/Hikari.GameLauncher.csproj `
    --configuration Release `
    --runtime win-x64 `
    --self-contained true `
    -p:DebugType=None `
    -p:DebugSymbols=false `
    --output launcher/dist/win-x64
}

$EditorDist = Join-Path $Root 'dist\HikariStudio'
$StagingParent = if ($env:HIKARI_NUITKA_STAGING) { $env:HIKARI_NUITKA_STAGING } else { $env:TEMP }
if (-not $StagingParent -or $StagingParent -match '[^\x00-\x7F]') {
  throw 'Nuitka requires an ASCII staging path. Set HIKARI_NUITKA_STAGING to a writable ASCII-only directory.'
}
$StagingRoot = Join-Path $StagingParent 'HikariStudioNuitkaBuild'
$NuitkaCache = if ($env:HIKARI_NUITKA_CACHE) { $env:HIKARI_NUITKA_CACHE } else { Join-Path $env:LOCALAPPDATA 'HikariStudioNuitkaCache' }
if (-not $NuitkaCache -or $NuitkaCache -match '[^\x00-\x7F]') {
  throw 'Nuitka requires an ASCII cache path. Set HIKARI_NUITKA_CACHE to a writable ASCII-only directory.'
}
$NuitkaRoot = Join-Path $StagingRoot 'build\nuitka'
$NuitkaDist = Join-Path $NuitkaRoot 'run.dist'

foreach ($Path in @($StagingRoot, $EditorDist)) {
  if (Test-Path $Path) {
    $Resolved = (Resolve-Path $Path).Path
    $AllowedRoot = if ($Path -eq $StagingRoot) { $StagingParent } else { $Root }
    if (-not $Resolved.StartsWith($AllowedRoot + [IO.Path]::DirectorySeparatorChar)) {
      throw "Refusing to remove build output outside workspace: $Resolved"
    }
    Remove-Item -LiteralPath $Resolved -Recurse -Force
  }
}

New-Item -ItemType Directory -Force -Path $StagingRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $Root 'run.py') -Destination $StagingRoot
Copy-Item -LiteralPath (Join-Path $Root 'backend') -Destination (Join-Path $StagingRoot 'backend') -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $StagingRoot 'frontend') | Out-Null
Copy-Item -LiteralPath (Join-Path $Root 'frontend\dist') -Destination (Join-Path $StagingRoot 'frontend\dist') -Recurse
Copy-Item -LiteralPath (Join-Path $Root 'frontend\runtime-dist') -Destination (Join-Path $StagingRoot 'frontend\runtime-dist') -Recurse
Copy-Item -LiteralPath (Join-Path $Root 'assets') -Destination (Join-Path $StagingRoot 'assets') -Recurse

$NuitkaArgs = @(
  '-m', 'nuitka', 'run.py',
  '--standalone',
  '--msvc=latest',
  '--assume-yes-for-downloads',
  '--windows-console-mode=disable',
  '--output-dir=build/nuitka',
  '--output-filename=HikariStudio.exe',
  '--include-package=pythonnet',
  '--include-package=clr_loader',
  '--include-data-dir=frontend/dist=frontend/dist',
  '--include-data-dir=frontend/runtime-dist=frontend/runtime-dist',
  '--include-data-dir=assets=assets'
)
$env:NUITKA_CACHE_DIR = $NuitkaCache
Push-Location $StagingRoot
try { & $Python @NuitkaArgs } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "Nuitka failed with exit code $LASTEXITCODE" }
if (-not (Test-Path (Join-Path $NuitkaDist 'HikariStudio.exe'))) {
  throw "Nuitka standalone build is missing: $NuitkaDist"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $EditorDist) | Out-Null
Move-Item -LiteralPath $NuitkaDist -Destination $EditorDist
if (Test-Path (Join-Path $Root 'launcher\dist\win-x64')) {
  $LauncherTarget = Join-Path $EditorDist 'launcher\dist'
  New-Item -ItemType Directory -Force -Path $LauncherTarget | Out-Null
  Copy-Item -LiteralPath (Join-Path $Root 'launcher\dist\win-x64') -Destination (Join-Path $LauncherTarget 'win-x64') -Recurse
}
try { Remove-Item -LiteralPath $StagingRoot -Recurse -Force } catch { Write-Warning "Unable to remove Nuitka staging directory: $_" }

$Executable = Join-Path $Root 'dist/HikariStudio/HikariStudio.exe'
if (-not (Test-Path $Executable)) { throw "Editor build did not produce $Executable" }
Write-Host "Hikari Studio desktop build: $Executable"
