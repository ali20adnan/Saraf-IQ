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

set "TOKENS=%~dp0..\web-jump-baly-master\tokens.env"
if exist "%TOKENS%" (
  echo Loading SWITCH Token 1 / Token 2 from tokens.env
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%TOKENS%") do (
    if not "%%A"=="" set "%%A=%%B"
  )
  echo  app_tokenactive = %app_tokenactive%
  if defined apptokenurl1 echo  Token 1 JWT = set
  if defined apptokenurl2 echo  Token 2 JWT = set
  if defined apptokenrefresh1 echo  Token 1 refresh = set
  if defined apptokenrefresh2 echo  Token 2 refresh = set
) else (
  echo WARNING: tokens.env not found — SWITCH Token 1/2 will be empty
)

echo Starting Saraf on http://localhost:3000
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "http://localhost:3000"
call npm run dev
pause
