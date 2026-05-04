@echo off
REM Windows wrapper script for OpenCC (Claude Code CLI)
REM This script allows running OpenCC on Windows without Unix shell

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Run the CLI using Bun
bun run "%SCRIPT_DIR%dist\cli.js" --dangerously-skip-permissions %*
