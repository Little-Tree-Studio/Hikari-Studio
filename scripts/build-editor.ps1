[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$SkipLauncher,
  [string]$Python = 'python',
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $SkipInstall) {
  $UvCommand = Get-Command uv -ErrorAction Stop
  $SyncArgs = @('sync', '--extra', 'build')
  if ($PSBoundParameters.ContainsKey('Python')) {
    $PythonCommand = Get-Command $Python -ErrorAction Stop
    $SyncArgs += @('--python', $PythonCommand.Source)
  }
  & $UvCommand.Source @SyncArgs
  if ($LASTEXITCODE -ne 0) {
    throw "uv sync failed with exit code $LASTEXITCODE"
  }
}
$VenvPython = Join-Path $Root '.venv\Scripts\python.exe'
if (Test-Path $VenvPython) {
  # Nuitka must run inside the uv-managed project environment.
  $Python = $VenvPython
} elseif ($SkipInstall) {
  throw "The project virtual environment is missing. Run 'uv sync --extra build' first, or omit -SkipInstall."
} else {
  $PythonCommand = Get-Command $Python -ErrorAction Stop
  $Python = $PythonCommand.Source
}

$PythonVersion = (& $Python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')").Trim()
$PythonVersionParts = $PythonVersion.Split('.')
if ($LASTEXITCODE -ne 0 -or $PythonVersionParts.Count -ne 2) {
  throw "Unable to determine the build Python version from: $Python"
}
if ([int]$PythonVersionParts[0] -ne 3 -or [int]$PythonVersionParts[1] -ge 14) {
  throw "Nuitka desktop builds require Python 3.12 or 3.13; found Python $PythonVersion. Pass -Python with a supported interpreter."
}
Write-Host "Slide Studio build Python: $PythonVersion"

& $Python -c "import sys; raise SystemExit(0 if str(sys.base_prefix).isascii() else 86)"
$PythonPathCheck = $LASTEXITCODE
if ($PythonPathCheck -eq 86) {
  throw 'Nuitka Windows builds require the Python base installation to use an ASCII-only path. Pass -Python with an interpreter installed outside Unicode directories.'
}
if ($PythonPathCheck -ne 0) {
  throw "Unable to validate the build Python base path (exit code $PythonPathCheck)."
}

$AppVersion = (& $Python -c "from backend.version import APP_VERSION; print(APP_VERSION)").Trim()
if ($LASTEXITCODE -ne 0 -or $AppVersion -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-[^.]+\.(\d+))?$') {
  throw "Unable to derive a Windows file version from backend.version.APP_VERSION: $AppVersion"
}
$AppRevision = if ($Matches[4]) { $Matches[4] } else { '0' }
$NumericAppVersion = "$($Matches[1]).$($Matches[2]).$($Matches[3]).$AppRevision"

& (Join-Path $PSScriptRoot 'prepare-brand-assets.ps1')

if (-not $SkipInstall) {
  Push-Location frontend
  try { pnpm install --frozen-lockfile } finally { Pop-Location }
}

$FrontendRoot = Join-Path $Root 'frontend'
foreach ($FrontendOutput in @((Join-Path $FrontendRoot 'dist'), (Join-Path $FrontendRoot 'runtime-dist'))) {
  if (Test-Path $FrontendOutput) {
    $ResolvedOutput = (Resolve-Path $FrontendOutput).Path
    if (-not $ResolvedOutput.StartsWith($FrontendRoot + [IO.Path]::DirectorySeparatorChar)) {
      throw "Refusing to remove frontend output outside its workspace: $ResolvedOutput"
    }
    Remove-Item -LiteralPath $ResolvedOutput -Recurse -Force
  }
}

Push-Location frontend
try { pnpm run build } finally { Pop-Location }

cargo build --release --locked --package slide-asset-worker
if ($LASTEXITCODE -ne 0) {
  throw "Rust asset worker build failed with exit code $LASTEXITCODE"
}
$AssetWorker = Join-Path $Root 'target\release\slide-asset-worker.exe'
if (-not (Test-Path $AssetWorker)) {
  throw "Rust asset worker build completed without producing $AssetWorker"
}

if (-not $SkipLauncher) {
  $LauncherDistRoot = Join-Path $Root 'launcher\dist\win-x64'
  if (Test-Path $LauncherDistRoot) {
    Remove-Item -LiteralPath $LauncherDistRoot -Recurse -Force
  }
  foreach ($BrowserMode in @('system', 'cefsharp')) {
    $LauncherOutput = "launcher/dist/win-x64/$BrowserMode"
    dotnet publish launcher/Slide.GameLauncher/Slide.GameLauncher.csproj `
      --configuration Release `
      --runtime win-x64 `
      --self-contained true `
      -p:DebugType=None `
      -p:DebugSymbols=false `
      -p:SlideBrowserMode=$BrowserMode `
      --output $LauncherOutput
    if ($LASTEXITCODE -ne 0) {
      throw "Windows $BrowserMode game launcher build failed with exit code $LASTEXITCODE"
    }
    if (-not (Test-Path (Join-Path $Root "$LauncherOutput\Slide.GameLauncher.exe"))) {
      throw "Windows $BrowserMode game launcher build completed without producing Slide.GameLauncher.exe"
    }
  }
}

$DistRoot = [IO.Path]::GetFullPath((Join-Path $Root 'dist'))
$EditorDist = if ($OutputDirectory) {
  if ([IO.Path]::IsPathRooted($OutputDirectory)) { [IO.Path]::GetFullPath($OutputDirectory) }
  else { [IO.Path]::GetFullPath((Join-Path $Root $OutputDirectory)) }
} else {
  Join-Path $DistRoot 'SlideStudio'
}
if (-not $EditorDist.StartsWith($DistRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Editor output must stay inside the repository dist directory: $EditorDist"
}
$StagingParent = if ($env:SLIDE_NUITKA_STAGING) { $env:SLIDE_NUITKA_STAGING } else { $env:TEMP }
if (-not $StagingParent -or $StagingParent -match '[^\x00-\x7F]') {
  throw 'Nuitka requires an ASCII staging path. Set SLIDE_NUITKA_STAGING to a writable ASCII-only directory.'
}
$StagingRoot = Join-Path $StagingParent 'SlideStudioNuitkaBuild'
$NuitkaCache = if ($env:SLIDE_NUITKA_CACHE) { $env:SLIDE_NUITKA_CACHE } else { Join-Path $env:LOCALAPPDATA 'SlideStudioNuitkaCache' }
if (-not $NuitkaCache -or $NuitkaCache -match '[^\x00-\x7F]') {
  throw 'Nuitka requires an ASCII cache path. Set SLIDE_NUITKA_CACHE to a writable ASCII-only directory.'
}
$NuitkaRoot = Join-Path $StagingRoot 'build\nuitka'
$NuitkaDist = Join-Path $NuitkaRoot 'run.dist'

foreach ($Path in @($StagingRoot, $EditorDist)) {
  if (Test-Path $Path) {
    $Resolved = (Resolve-Path $Path).Path
    $AllowedRoot = if ($Path -eq $StagingRoot) { $StagingParent } else { $DistRoot }
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
New-Item -ItemType Directory -Force -Path (Join-Path $StagingRoot 'native') | Out-Null
Copy-Item -LiteralPath $AssetWorker -Destination (Join-Path $StagingRoot 'native\slide-asset-worker.exe')
Copy-Item -LiteralPath (Join-Path $Root 'installer\SlideStudio.ico') -Destination (Join-Path $StagingRoot 'SlideStudio.ico')

# MSVC receives the Python import library as a bare filename from Nuitka. Let
# Python copy it into the ASCII-only staging tree without round-tripping a
# potentially Unicode base path through PowerShell's native-output decoder.
$StagedPythonLibraryDir = Join-Path $StagingRoot 'python-libs'
& $Python -c "import pathlib, shutil, sys, sysconfig; roots = [pathlib.Path(value) for value in (sysconfig.get_config_var('LIBDIR'), pathlib.Path(sys.base_prefix) / 'libs', sys.base_prefix) if value]; source = next((root for root in roots if list(root.glob('python*.lib'))), None); target = pathlib.Path(sys.argv[1]); target.mkdir(parents=True, exist_ok=True); libraries = list(source.glob('*.lib')) if source else []; [shutil.copy2(item, target / item.name) for item in libraries]; sys.exit(0 if libraries else 1)" $StagedPythonLibraryDir
if ($LASTEXITCODE -ne 0) {
  throw 'Unable to stage the Python import libraries for Nuitka.'
}
if (-not (Get-ChildItem -LiteralPath $StagedPythonLibraryDir -Filter 'python*.lib' -File)) {
  throw 'Python import libraries are missing from the Nuitka staging directory.'
}

$NuitkaArgs = @(
  '-m', 'nuitka', 'run.py',
  '--standalone',
  '--msvc=latest',
  '--assume-yes-for-downloads',
   '--windows-console-mode=disable',
   '--enable-plugin=pyside6',
   '--include-qt-plugins=all',
   '--windows-icon-from-ico=SlideStudio.ico',
  '--company-name=Slide Studio',
  '--product-name=Slide Studio',
  '--file-description=Slide Studio Visual Novel Editor',
  "--file-version=$NumericAppVersion",
  "--product-version=$NumericAppVersion",
  '--output-dir=build/nuitka',
  '--output-filename=SlideStudio.exe',
  '--include-package=pythonnet',
  '--include-package=clr_loader',
  '--include-data-dir=frontend/dist=frontend/dist',
  '--include-data-dir=frontend/runtime-dist=frontend/runtime-dist',
  '--include-data-dir=assets=assets',
  '--include-data-dir=native=native'
)
$PreviousNuitkaCache = $env:NUITKA_CACHE_DIR
$PreviousLib = $env:LIB
$env:NUITKA_CACHE_DIR = $NuitkaCache
$env:LIB = if ($PreviousLib) { "$StagedPythonLibraryDir;$PreviousLib" } else { $StagedPythonLibraryDir }
Push-Location $StagingRoot
try {
  & $Python @NuitkaArgs
} finally {
  Pop-Location
  $env:NUITKA_CACHE_DIR = $PreviousNuitkaCache
  $env:LIB = $PreviousLib
}
if ($LASTEXITCODE -ne 0) { throw "Nuitka failed with exit code $LASTEXITCODE" }
if (-not (Test-Path (Join-Path $NuitkaDist 'SlideStudio.exe'))) {
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

$Executable = Join-Path $EditorDist 'SlideStudio.exe'
if (-not (Test-Path $Executable)) { throw "Editor build did not produce $Executable" }
Write-Host "Slide Studio desktop build: $Executable"
