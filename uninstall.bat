@echo off
title Zouwu Forge - uninstall
echo Removing Zouwu Forge panel from After Effects...
rmdir /s /q "%APPDATA%\Adobe\CEP\extensions\ZouwuForge" 2>nul
rmdir /s /q "%APPDATA%\Adobe\CEP\extensions\LTXPost" 2>nul
echo Done. The engine and models stay in D:\ZouwuForge (or D:\LTXPost / %LOCALAPPDATA%\ZouwuForge) - delete that folder manually to free space.
echo Settings: %APPDATA%\ZouwuForge
pause
