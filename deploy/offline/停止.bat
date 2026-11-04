@echo off
chcp 65001 >nul
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" -Action Stop
set "RESULT=%ERRORLEVEL%"
if not defined REDNOTE_NO_PAUSE pause
exit /b %RESULT%
