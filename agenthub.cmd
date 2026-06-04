@echo off
setlocal EnableExtensions
if not defined AGENTHUB_CALLER_CWD set "AGENTHUB_CALLER_CWD=%CD%"
pushd "%~dp0" >nul
call pnpm.cmd exec tsx apps/cli/src/index.ts %*
set "AGENTHUB_EXIT_CODE=%ERRORLEVEL%"
popd >nul
exit /b %AGENTHUB_EXIT_CODE%
