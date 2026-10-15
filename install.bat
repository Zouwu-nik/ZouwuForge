@echo off
setlocal
title Zouwu Forge - install
echo.
echo  ===============================================
echo   Zouwu Forge for After Effects - installer
echo  ===============================================
echo.
set "SRC=%~dp0ZouwuForge"
set "CEP=%APPDATA%\Adobe\CEP\extensions"
set "DST=%CEP%\ZouwuForge"
if not exist "%SRC%\CSXS\manifest.xml" goto :nosrc

rem Everything (engine, models, DLSS, LLM) is installed into THIS folder - next to install.bat
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
echo "%ROOT%" | find /i "\AppData\Local\Temp" >nul && goto :intemp
set "ZFDIR=%APPDATA%\ZouwuForge"
if not exist "%ZFDIR%" mkdir "%ZFDIR%"
set "ZF_ROOT=%ROOT%"
set "ZF_FILE=%ZFDIR%\install_root.txt"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText($env:ZF_FILE, $env:ZF_ROOT)" >nul 2>nul
if errorlevel 1 (>"%ZF_FILE%" echo %ROOT%)
if exist "%ZFDIR%\dlss_path.txt" del /q "%ZFDIR%\dlss_path.txt"
echo Engine, models, DLSS and assistant will be installed into:
echo   %ROOT%
echo   (about 60 GB of free space is needed on this drive)
echo.

echo Installing the panel into After Effects...
if not exist "%CEP%" mkdir "%CEP%"
if exist "%DST%" rmdir /s /q "%DST%"
rem old name of this plugin (LTX Post) - remove so the menu has no duplicates
if exist "%CEP%\LTXPost" rmdir /s /q "%CEP%\LTXPost"
xcopy "%SRC%" "%DST%\" /E /I /Y /Q >nul
if errorlevel 1 goto :copyfail
for %%v in (9 10 11 12 13 14 15 16) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>nul
echo   OK: %DST%
echo.
echo  NEXT STEPS:
echo   1. Restart After Effects.
echo   2. Window ^> Extensions ^> "Zouwu Forge - Nastroyki" (settings).
echo   3. Tab "Modeli": pick a preset for your GPU, paste a Hugging Face token,
echo      press "Ustanovit" - the engine and models download in the background.
echo   4. Work in Window ^> Extensions ^> "Zouwu Forge - Instrumenty".
echo.
pause
exit /b 0

:intemp
echo ERROR: install.bat is running from a temporary folder inside the zip.
echo Extract the whole archive to the folder where you want Zouwu Forge to live
echo (for example E:\ZouwuForge) and run install.bat from there.
pause
exit /b 1

:nosrc
echo ERROR: folder ZouwuForge not found next to install.bat. Unzip the whole archive first.
pause
exit /b 1

:copyfail
echo ERROR: could not copy the panel to %DST%. Close After Effects and try again.
pause
exit /b 1
