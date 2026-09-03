@echo off
title Saraf in Chrome
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not in PATH. Trying default install path...
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing npm packages...
  call npm install
)

echo Starting Saraf on http://localhost:3000
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "http://localhost:3000"
call npm run dev
pause
