@echo off
setlocal
cd /d "%~dp0"
where uv >nul 2>nul
if %errorlevel%==0 (
  uv run run.py
  goto :end
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 run.py
) else (
  python run.py
)
:end
