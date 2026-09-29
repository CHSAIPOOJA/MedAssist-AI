@echo off
setlocal
title MedAssist AI
cd /d "%~dp0backend"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org then run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing packages - this takes about a minute the first time...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

node scripts\setup-env.js
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Starting MedAssist AI at http://localhost:4000  (close this window to stop it)
start "" cmd /c "timeout /t 3 >nul & start http://localhost:4000"
call npm start
pause
