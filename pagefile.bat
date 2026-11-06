@echo off
rem Zouwu Forge - sets a 32-64 GB paging file (fixes "paging file is too small", os error 1455)
net session >nul 2>&1
if errorlevel 1 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title Zouwu Forge - paging file
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ZouwuForge\py\pagefile.ps1"
if %errorlevel%==10 (
  echo.
  echo  Done. RESTART THE COMPUTER so the new paging file is used.
) else if %errorlevel%==3 (
  echo.
  echo  Not enough free space on the fastest drive - see the message above.
) else if %errorlevel%==0 (
  echo.
  echo  Paging file is already large enough - nothing to do.
) else (
  echo.
  echo  Could not change the paging file - see the message above.
)
echo.
pause
