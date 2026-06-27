@echo off
REM AgentRoom - Windows double-click launcher.
REM Thin wrapper around the cross-platform `pnpm start`, which builds the app and starts
REM the web server + bridge, waits until http://localhost:3000 is ready, and opens your
REM browser. No port-killing or cache-clearing needed - the built app starts clean.
cd /d "%~dp0"
call pnpm start
pause
