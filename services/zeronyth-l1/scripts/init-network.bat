@echo off
setlocal
cd /d "%~dp0\.."
if exist "%ProgramFiles%\Git\bin\bash.exe" (
  "%ProgramFiles%\Git\bin\bash.exe" ./scripts/init-network.sh
  exit /b %errorlevel%
)
if exist "%LocalAppData%\Programs\Git\bin\bash.exe" (
  "%LocalAppData%\Programs\Git\bin\bash.exe" ./scripts/init-network.sh
  exit /b %errorlevel%
)
if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" (
  "%ProgramFiles(x86)%\Git\bin\bash.exe" ./scripts/init-network.sh
  exit /b %errorlevel%
)
where bash >nul 2>nul
if not errorlevel 1 (
  bash ./scripts/init-network.sh
  exit /b %errorlevel%
)
where wsl >nul 2>nul
if not errorlevel 1 (
  wsl bash -lc "cd \"$(wslpath -u '%CD%')\" && ./scripts/init-network.sh"
  exit /b %errorlevel%
)
echo ERROR: Git Bash or WSL is required.
exit /b 1
