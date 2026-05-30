@echo off
setlocal EnableExtensions
pushd "%~dp0" >nul
call pnpm.cmd exec tsx apps/cli/src/index.ts %*
set "AGENTHUB_EXIT_CODE=%ERRORLEVEL%"
popd >nul
exit /b %AGENTHUB_EXIT_CODE%
