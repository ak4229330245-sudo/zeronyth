@echo off
setlocal
cd /d "%~dp0"

if exist "%ProgramFiles%\Git\bin\bash.exe" goto gitbash_pf
if exist "%LocalAppData%\Programs\Git\bin\bash.exe" goto gitbash_local
if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" goto gitbash_x86

where bash >nul 2>nul
if not errorlevel 1 (
  bash ./scripts/start.sh
  if errorlevel 1 exit /b 1
  start "" http://127.0.0.1:8080
  exit /b 0
)

where wsl >nul 2>nul
if not errorlevel 1 (
  wsl bash -lc "cd \"$(wslpath -u '%CD%')\" && ./scripts/start.sh"
  if errorlevel 1 exit /b 1
  start "" http://127.0.0.1:8080
  exit /b 0
)

echo ERROR: Git Bash or WSL is required for START.bat.
echo Install Git for Windows or enable WSL, then run this file again.
exit /b 1

:gitbash_pf
"%ProgramFiles%\Git\bin\bash.exe" ./scripts/start.sh
if errorlevel 1 exit /b 1
start "" http://127.0.0.1:8080
exit /b 0

:gitbash_local
"%LocalAppData%\Programs\Git\bin\bash.exe" ./scripts/start.sh
if errorlevel 1 exit /b 1
start "" http://127.0.0.1:8080
exit /b 0

:gitbash_x86
"%ProgramFiles(x86)%\Git\bin\bash.exe" ./scripts/start.sh
if errorlevel 1 exit /b 1
start "" http://127.0.0.1:8080
exit /b 0
