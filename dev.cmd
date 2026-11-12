@echo off
rem One command for backend + console in this window: "dev" (or double-click). Ctrl+C stops both.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
