[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$SkipLauncher
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $SkipInstall) {
  python -m pip install -r requirements.txt -r requirements-build.txt
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

python -m PyInstaller --noconfirm --clean --workpath build/pyinstaller --distpath dist HikariStudio.spec

$Executable = Join-Path $Root 'dist/HikariStudio/HikariStudio.exe'
if (-not (Test-Path $Executable)) { throw "Editor build did not produce $Executable" }
Write-Host "Hikari Studio desktop build: $Executable"
